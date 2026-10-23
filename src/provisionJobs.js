import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { badRequest, createServerRecord } from "./servers-core.js";
import { listProtocols } from "./protocols/index.js";
import { createPanelKey, installKeyWithPassword, verifyKeyLogin } from "./sshKey.js";

// Развёртывание нового AmneziaWG-сервера прямо из панели.
// Ввод проверяется здесь строгими шаблонами и передаётся скрипту lib/provision-cli.sh
// только через переменные окружения — в команду оболочки ничего не подставляется.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_SCRIPT = path.resolve(__dirname, "../lib/provision-cli.sh");

const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const JOB_KEEP_MS = 60 * 60 * 1000;
const MAX_LOG_LINES = 200;

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const SSH_USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const KEY_PATH = /^\/[A-Za-z0-9_./-]{1,200}$/;

const jobs = new Map();
let activeJobId = null;

function isHost(value) {
  // Строка из одних цифр и точек должна быть настоящим IPv4, а не «доменом» вроде 1.2.3.999
  if (/^[\d.]+$/.test(value)) return IPV4.test(value);
  return HOSTNAME.test(value);
}

function sanitizeInput(raw, { secureTransport = false } = {}) {
  const body = raw || {};
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 60) throw badRequest("Название обязательно (до 60 символов)");

  const protocol = String(body.protocol ?? "awg");
  if (!listProtocols().some((p) => p.id === protocol)) throw badRequest("Неизвестный протокол");

  const awgVersion = String(body.awgVersion ?? "2");
  if (protocol === "awg" && !["2", "3.1"].includes(awgVersion)) {
    throw badRequest("Версия AmneziaWG должна быть 2 или 3.1");
  }

  const location = body.location === "ssh" ? "ssh" : "local";
  const input = { name, protocol, awgVersion: protocol === "awg" ? awgVersion : "2", location };

  if (protocol === "vless-reality" || protocol === "hysteria2") {
    // Под какой сайт маскируется REALITY (у Hysteria2 это имя в сертификате): только имя домена
    const sni = String(body.xraySni ?? "").trim() || "www.microsoft.com";
    if (!HOSTNAME.test(sni) || /^[\d.]+$/.test(sni)) throw badRequest("Сайт для маскировки: укажите домен, например www.microsoft.com");
    input.xraySni = sni;
  }

  if (location === "ssh") {
    const sshHost = String(body.sshHost ?? "").trim();
    if (!isHost(sshHost)) throw badRequest("Укажите IP или домен удалённого сервера");
    const sshUser = String(body.sshUser ?? "root").trim() || "root";
    if (!SSH_USER.test(sshUser)) throw badRequest("Недопустимое имя SSH-пользователя");
    Object.assign(input, { sshHost, sshUser });
    if (body.sshAuth === "password") {
      // Ключ создаёт сама панель: пароль нужен один раз и нигде не сохраняется
      const sshPassword = typeof body.sshPassword === "string" ? body.sshPassword : "";
      if (!sshPassword || sshPassword.length > 256 || /[\r\n\0]/.test(sshPassword)) {
        throw badRequest("Введите пароль от сервера (до 256 символов, без переводов строки)");
      }
      if (!secureTransport) {
        throw badRequest(
          "Пароль нельзя передавать по незащищённому соединению. Откройте панель по HTTPS (через домен) или через SSH-туннель на localhost"
        );
      }
      input.sshAuth = "password";
      input.sshPassword = sshPassword;
    } else {
      const sshKeyPath = String(body.sshKeyPath ?? "").trim();
      if (!KEY_PATH.test(sshKeyPath) || sshKeyPath.includes("..")) {
        throw badRequest("Укажите полный путь к приватному SSH-ключу, например /root/.ssh/id_ed25519");
      }
      let stat;
      try {
        stat = fs.statSync(sshKeyPath);
      } catch {
        throw badRequest(`Файл ключа не найден на этой машине: ${sshKeyPath}`);
      }
      if (!stat.isFile()) throw badRequest("Путь к ключу должен указывать на файл");
      input.sshAuth = "key";
      input.sshKeyPath = sshKeyPath;
    }
    const publicHost = String(body.serverIp ?? "").trim() || sshHost;
    if (!isHost(publicHost)) throw badRequest("Недопустимый публичный адрес сервера");
    input.serverIp = publicHost;
  } else {
    const serverIp = String(body.serverIp ?? "").trim();
    if (!isHost(serverIp)) throw badRequest("Укажите публичный IP или домен этого сервера");
    input.serverIp = serverIp;
  }

  if (body.wgPort !== undefined && body.wgPort !== null && body.wgPort !== "") {
    const port = Number(body.wgPort);
    const minPort = protocol === "awg" ? 1024 : 1;
    if (!Number.isInteger(port) || port < minPort || port > 65535) {
      throw badRequest(`Порт должен быть числом от ${minPort} до 65535`);
    }
    input.wgPort = port;
  }
  return input;
}

// Свободный порт: не занят уже зарегистрированными серверами на том же адресе
function pickPort(serverIp) {
  const used = new Set(
    db
      .prepare("SELECT endpoint FROM servers")
      .all()
      .filter((s) => s.endpoint.split(":")[0] === serverIp)
      .map((s) => Number(s.endpoint.split(":")[1]))
  );
  let port = 39001;
  while (used.has(port)) port += 1;
  return port;
}

// Порт Xray: по умолчанию 443 (так REALITY выглядит как обычный HTTPS), дальше 8443, 2053...
function pickXrayPort(serverIp, protocol) {
  // REALITY занимает TCP, Hysteria2 — UDP, Shadowsocks — оба; пересекающиеся протоколы не должны делить порт
  const conflicts = {
    "vless-reality": ["vless-reality", "shadowsocks"],
    hysteria2: ["hysteria2", "shadowsocks"],
    shadowsocks: ["vless-reality", "hysteria2", "shadowsocks"],
  }[protocol];
  const used = new Set(
    db
      .prepare(`SELECT endpoint FROM servers WHERE protocol IN (${conflicts.map(() => "?").join(",")})`)
      .all(...conflicts)
      .filter((s) => s.endpoint.split(":")[0] === serverIp)
      .map((s) => Number(s.endpoint.split(":")[1]))
  );
  const free = [443, 8443, 2053, 2083, 2087, 2096].filter((port) => !used.has(port));
  if (free.length === 0) throw badRequest("Не удалось подобрать свободный порт — укажите его вручную");
  return free; // из них скрипт на самой машине возьмёт первый, который реально свободен
}

// API статистики Xray слушает только 127.0.0.1; у каждого Xray-контейнера на машине свой порт
function pickXrayApiPort() {
  const used = new Set(
    db
      .prepare("SELECT extra_params FROM servers WHERE protocol != 'awg'")
      .all()
      .map((s) => {
        try {
          return Number(JSON.parse(s.extra_params || "{}").apiPort);
        } catch {
          return 0;
        }
      })
  );
  let port = 10085;
  while (used.has(port)) port += 1;
  return port;
}

// Свободная подсеть вида 10.N.1: не пересекается с уже зарегистрированными серверами
function pickSubnet() {
  const used = new Set(db.prepare("SELECT subnet_prefix FROM servers").all().map((s) => s.subnet_prefix));
  for (let n = 20; n < 250; n += 1) {
    if (!used.has(`10.${n}.1.`)) return `10.${n}.1`;
  }
  throw badRequest("Закончились свободные подсети");
}

function pickContainer() {
  const used = new Set(db.prepare("SELECT container FROM servers").all().map((s) => s.container));
  for (let i = 0; i < 10; i += 1) {
    const candidate = `skdsh-${randomBytes(4).toString("hex")}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Не удалось подобрать имя контейнера");
}

function pushLog(job, text) {
  let line = String(text).trim();
  if (job.secret) line = line.split(job.secret).join("•••");
  if (!line) return;
  job.log.push(line);
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
}

function publicView(job) {
  return {
    id: job.id,
    status: job.status,
    log: job.log,
    serverId: job.serverId || null,
    error: job.error || null,
    warnings: job.warnings,
  };
}

function registerXray(job, params, result) {
  // У REALITY «публичный ключ» — ключ сервера, у Hysteria2 — отпечаток сертификата
  const publicKey = params.protocol === "hysteria2" ? result.PIN_SHA256 : result.PUBLIC_KEY; // у Shadowsocks — ключ сервера
  job.serverId = createServerRecord({
    protocol: params.protocol,
    name: params.name,
    endpoint: `${params.serverIp}:${Number(result.PORT)}`, // порт мог смениться, если выбранный оказался занят
    container: params.container,
    configPath: `/opt/skdsh-panel/xray-${params.container}/config.json`,
    publicKey,
    extraParams: {
      sni: result.SNI,
      shortId: result.SHORT_ID,
      port: Number(result.PORT),
      apiPort: Number(result.API_PORT),
    },
    ...(params.location === "ssh"
      ? { sshHost: params.sshHost, sshUser: params.sshUser, sshKeyPath: params.sshKeyPath }
      : {}),
  });
}

function registerServer(job, params, result) {
  if (params.protocol !== "awg") return registerXray(job, params, result);
  const body = {
    name: params.name,
    endpoint: `${params.serverIp}:${params.wgPort}`,
    container: params.container,
    interface: result.IFACE_NAME,
    configPath: `/etc/amnezia/amneziawg/${result.IFACE_NAME}.conf`,
    publicKey: result.PUBLIC_KEY,
    presharedKey: result.PRESHARED_KEY,
    subnetPrefix: `${params.subnet}.`,
    jc: result.JC, jmin: result.JMIN, jmax: result.JMAX,
    s1: result.S1, s2: result.S2, s3: result.S3, s4: result.S4,
    h1: result.H1, h2: result.H2, h3: result.H3, h4: result.H4,
    awgVersion: params.awgVersion,
  };
  if (params.location === "ssh") {
    Object.assign(body, {
      sshHost: params.sshHost,
      sshUser: params.sshUser,
      sshKeyPath: params.sshKeyPath,
    });
  }
  if (params.awgVersion === "3.1") {
    body.extraParams = {
      headerProtectionKey: result.HPK,
      contentPaddingAddition: "0-64",
      randomTrailers: "on",
      disableCookies: "off",
    };
  }
  job.serverId = createServerRecord(body);
}

function finish(job, status, error) {
  job.status = status;
  if (error) job.error = error;
  job.finishedAt = Date.now();
  if (activeJobId === job.id) activeJobId = null;
  setTimeout(() => jobs.delete(job.id), JOB_KEEP_MS).unref();
}

export function startProvision(raw, ctx = {}) {
  const input = sanitizeInput(raw, ctx);
  if (activeJobId && jobs.get(activeJobId)?.status === "running") {
    throw Object.assign(new Error("Уже идёт развёртывание другого сервера — дождитесь его завершения"), {
      status: 409,
    });
  }

  // Пароль держим только в этой переменной и обнуляем сразу после установки ключа
  let secret = input.sshPassword || null;
  delete input.sshPassword;

  const isAwg = input.protocol === "awg";
  const params = {
    ...input,
    wgPort: input.wgPort ?? (isAwg ? pickPort(input.serverIp) : null),
    xrayPorts: isAwg ? null : input.wgPort ? [input.wgPort] : pickXrayPort(input.serverIp, input.protocol),
    subnet: isAwg ? pickSubnet() : null,
    xrayApiPort: isAwg ? null : pickXrayApiPort(),
    container: pickContainer(),
  };

  const job = {
    id: randomBytes(8).toString("hex"),
    status: "running",
    log: [],
    warnings: [],
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  activeJobId = job.id;

  job.secret = secret;

  const launch = () => {
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME || "/root",
      LANG: process.env.LANG || "C.UTF-8",
      PROTOCOL: params.protocol,
      AWG_VERSION: params.awgVersion,
      CONTAINER_NAME: params.container,
      WG_PORT: String(params.wgPort ?? params.xrayPorts[0]),
      IS_REMOTE: params.location === "ssh" ? "true" : "false",
    };
    if (params.protocol === "awg") {
      env.SUBNET_BASE = params.subnet;
    } else {
      env.XRAY_PORT = String(params.xrayPorts[0]);
      env.XRAY_PORT_CANDIDATES = params.xrayPorts.join(" ");
      env.XRAY_API_PORT = String(params.xrayApiPort);
      if (params.xraySni) env.XRAY_SNI = params.xraySni;
    }
    if (process.env.FAKE_LOG) env.FAKE_LOG = process.env.FAKE_LOG;
    if (params.location === "ssh") {
      env.SSH_HOST = params.sshHost;
      env.SSH_USER = params.sshUser;
      env.SSH_KEY = params.sshKeyPath;
    }

    if (params.protocol === "awg") {
      pushLog(job, `Версия AmneziaWG ${params.awgVersion === "3.1" ? "3.1" : "2.0"}, порт ${params.wgPort}, подсеть ${params.subnet}.0/24`);
    } else if (params.protocol === "shadowsocks") {
      pushLog(job, `Shadowsocks-2022 (порт TCP и UDP)`);
    } else if (params.protocol === "hysteria2") {
      pushLog(job, `Hysteria2 (порт UDP), самоподписанный сертификат`);
    } else {
      pushLog(job, `VLESS + REALITY (порт TCP), маскировка под ${params.xraySni}`);
    }

    const result = {};
    const child = spawn("bash", [CLI_SCRIPT], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });

    const timer = setTimeout(() => {
      pushLog(job, "✗ Превышено время ожидания (10 минут), останавливаю");
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, JOB_TIMEOUT_MS);

    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf-8");
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    };
    const handleLine = (line) => {
      const m = /^PANEL_RESULT ([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m) {
        result[m[1]] = m[2].trim();
        return;
      }
      if (line.startsWith("STAGE ")) {
        pushLog(job, `→ ${line.slice(6)}`);
        return;
      }
      if (line.startsWith("⚠")) job.warnings.push(line.replace(/^⚠\s*/, ""));
      pushLog(job, line);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("error", (e) => {
      clearTimeout(timer);
      pushLog(job, `✗ Не удалось запустить скрипт: ${e.message}`);
      finish(job, "error", "Не удалось запустить развёртывание");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffer) handleLine(buffer);
      const hasKey = params.protocol === "hysteria2" ? result.PIN_SHA256 : result.PUBLIC_KEY;
      if (code !== 0 || !hasKey) {
        finish(job, "error", "Развёртывание не удалось — подробности в журнале");
        return;
      }
      try {
        registerServer(job, params, result);
        pushLog(job, "✓ Сервер добавлен в панель");
        finish(job, "done");
      } catch (e) {
        pushLog(job, `✗ Сервер поднят, но не добавился в панель: ${e.message}`);
        finish(job, "error", `Сервер поднят, но не добавился в панель: ${e.message}`);
      }
    });

  };

  if (params.sshAuth === "password") {
    (async () => {
      let createdKeyPath = null;
      let keyReady = false;
      try {
        pushLog(job, "→ Создаю SSH-ключ и устанавливаю его на сервер (пароль нигде не сохраняется)");
        const { keyPath, pub } = await createPanelKey(params.sshHost);
        createdKeyPath = keyPath;
        params.sshKeyPath = keyPath;
        await installKeyWithPassword({
          host: params.sshHost,
          user: params.sshUser,
          password: secret,
          pub,
        });
        secret = null;
        job.secret = null;
        if (!(await verifyKeyLogin({ host: params.sshHost, user: params.sshUser, keyPath }))) {
          throw new Error("Ключ установлен, но вход по нему не сработал");
        }
        keyReady = true;
        pushLog(job, "✓ SSH-ключ установлен, дальше панель заходит без пароля");
        launch();
      } catch (e) {
        secret = null;
        job.secret = null;
        if (createdKeyPath && !keyReady) {
          // Ключ не пригодился — не оставляем его на диске
          fs.rmSync(createdKeyPath, { force: true });
          fs.rmSync(`${createdKeyPath}.pub`, { force: true });
        }
        pushLog(job, `✗ ${e.message}`);
        finish(job, "error", e.message);
      }
    })();
  } else {
    launch();
  }

  return publicView(job);
}

export function getProvisionJob(id) {
  const job = jobs.get(id);
  return job ? publicView(job) : null;
}
