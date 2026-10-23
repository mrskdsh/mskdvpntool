import { randomUUID, randomBytes } from "node:crypto";
import { db } from "../db.js";
import { runOnHost, shellQuote } from "../hostExec.js";

// Адаптер Xray: VLESS + REALITY и Hysteria2 (один движок, разные входящие подключения). Как хранятся данные:
//   сервер:  public_key — публичный ключ REALITY (у Hysteria2 — отпечаток SHA-256 сертификата, у Shadowsocks — ключ сервера),
//            config_path — путь к config.json на сервере,
//            extra_params — JSON { sni, shortId, port, apiPort }; приватные ключи панель не хранит;
//   клиент:  public_key и private_key — UUID клиента (по нему же ведётся статистика), адреса нет.
//            У VLESS UUID — это id клиента, у Hysteria2 — пароль (auth).
// Отличие Hysteria2 и Shadowsocks: Xray не умеет добавлять их клиентов на лету, поэтому при добавлении клиента контейнер
// перезапускается (удаление и блокировка по-прежнему мгновенные).
// Список клиентов правится в config.json (чтобы пережил перезапуск) и сразу применяется через
// API Xray без перезапуска, поэтому у остальных клиентов соединения не рвутся.
// Счётчики трафика в самом Xray обнуляются при перезапуске, поэтому панель забирает их с обнулением
// и копит итог у себя в базе (таблица traffic_totals).

export const INBOUND_TAG = "vless-reality";
const FLOW = "xtls-rprx-vision";
const SS_METHOD = "2022-blake3-aes-128-gcm";

const KINDS = {
  "vless-reality": {
    tag: "vless-reality",
    liveAdd: true,
    client: (id) => ({ id, flow: FLOW, email: id }),
    clientId: (c) => c.id,
    addInbound: (clients) => ({ protocol: "vless", port: 443, settings: { clients, decryption: "none" } }),
  },
  hysteria2: {
    tag: "hysteria2",
    liveAdd: false,
    client: (id) => ({ auth: id, email: id }),
    clientId: (c) => c.auth,
  },
  // Shadowsocks-2022 с несколькими пользователями: ключ клиента (16 байт в base64) — и пароль, и имя в статистике
  shadowsocks: {
    tag: "shadowsocks",
    liveAdd: false, // Xray не добавляет клиентов Shadowsocks-2022 на лету: при добавлении контейнер перезапускается
    client: (key) => ({ password: key, email: key }),
    clientId: (c) => c.password,
  },
};

function kindOf(server) {
  const k = KINDS[server.protocol || "vless-reality"];
  if (!k) throw new Error(`Неизвестный тип сервера Xray: ${server.protocol}`);
  return k;
}
const XRAY_BIN = "/usr/local/bin/xray";
const FINGERPRINT = "chrome";

function extra(server) {
  try {
    return JSON.parse(server.extra_params || "{}") || {};
  } catch {
    return {};
  }
}

function apiAddr(server) {
  const port = Number(extra(server).apiPort || 10085);
  return `127.0.0.1:${port}`;
}

function xrayExec(server, args, { stdinCmd = "" } = {}) {
  return `${stdinCmd}docker exec ${stdinCmd ? "-i " : ""}${shellQuote(server.container)} ${XRAY_BIN} ${args}`;
}

async function readConfig(server) {
  const raw = await runOnHost(server, `cat ${shellQuote(server.config_path)}`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Не удалось прочитать конфиг Xray на сервере");
  }
}

async function writeConfig(server, cfg) {
  const b64 = Buffer.from(JSON.stringify(cfg, null, 2) + "\n", "utf-8").toString("base64");
  const target = shellQuote(server.config_path);
  const tmp = shellQuote(`${server.config_path}.tmp`);
  await runOnHost(server, `umask 077; echo ${b64} | base64 -d > ${tmp} && mv ${tmp} ${target}`);
}

export async function generateClient(server) {
  const id = server?.protocol === "shadowsocks" ? randomBytes(16).toString("base64") : randomUUID();
  return { privateKey: id, publicKey: id };
}

export function nextAddress() {
  return "-"; // у Xray-клиентов нет адреса в подсети
}

// Забирает счётчики из Xray (с обнулением) и прибавляет к итогам в базе.
// Если Xray недоступен, отдаёт накопленные итоги (без новых данных).
async function collectStats(server) {
  try {
    const out = await runOnHost(
      server,
      xrayExec(server, `api statsquery --server=${apiAddr(server)} -pattern ${shellQuote("user>>>")} -reset`)
    );
    const stats = (JSON.parse(out || "{}").stat || []).filter((s) => Number(s.value) > 0);
    const delta = new Map();
    for (const s of stats) {
      const [, key, , direction] = String(s.name).split(">>>");
      if (!key) continue;
      const d = delta.get(key) || { rx: 0, tx: 0 };
      if (direction === "downlink") d.rx += Number(s.value);
      else if (direction === "uplink") d.tx += Number(s.value);
      delta.set(key, d);
    }
    if (delta.size > 0) {
      const now = Math.floor(Date.now() / 1000);
      const upsert = db.prepare(
        `INSERT INTO traffic_totals (server_id, client_key, rx, tx, last_active)
         VALUES (@serverId, @key, @rx, @tx, @now)
         ON CONFLICT(server_id, client_key) DO UPDATE SET
           rx = rx + excluded.rx, tx = tx + excluded.tx, last_active = excluded.last_active`
      );
      db.transaction(() => {
        for (const [key, d] of delta) upsert.run({ serverId: server.id, key, rx: d.rx, tx: d.tx, now });
      })();
    }
  } catch (e) {
    console.warn(`[xray] не удалось получить статистику с «${server.name}»: ${e.message}`);
  }
}

export async function getClientStats(server) {
  await collectStats(server);
  return db
    .prepare("SELECT client_key, rx, tx, last_active FROM traffic_totals WHERE server_id = ?")
    .all(server.id)
    .map((r) => ({
      publicKey: r.client_key,
      allowedIps: "-",
      lastHandshake: r.last_active || 0,
      rxBytes: r.rx,
      txBytes: r.tx,
    }));
}

// Команды api adu/rmu возвращают код 0 даже при ошибке, поэтому смотрим на «Added N / Removed N» в ответе.
function assertCount(out, word, expected) {
  const m = String(out).match(new RegExp(`${word} (\\d+) user`));
  if (!m || Number(m[1]) !== expected) {
    throw new Error(`Xray ответил: ${String(out).split("\n").slice(-3).join(" / ").trim() || "пусто"}`);
  }
}

async function applyLive(server, add, remove) {
  const kind = kindOf(server);
  const api = apiAddr(server);
  if (remove.length > 0) {
    const out = await runOnHost(
      server,
      xrayExec(server, `api rmu --server=${api} -tag=${kind.tag} ${remove.map(shellQuote).join(" ")}`)
    );
    assertCount(out, "Removed", remove.length);
  }
  if (add.length > 0) {
    // port нужен только для разбора конфига командой adu, на настоящий порт сервера он не влияет
    const payload = {
      inbounds: [{ tag: kind.tag, ...kind.addInbound(add.map(kind.client)) }],
    };
    const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
    const file = "/tmp/skdsh-adu.json";
    const out = await runOnHost(
      server,
      `echo ${b64} | base64 -d | docker exec -i ${shellQuote(server.container)} sh -c ${shellQuote(`cat > ${file}`)} && ` +
        xrayExec(server, `api adu --server=${api} ${file}`)
    );
    assertCount(out, "Added", add.length);
  }
}

// clients: [{ publicKey (UUID), blocked }]. Заблокированные из Xray убираются.
export async function syncClients(clients, server) {
  const kind = kindOf(server);
  const desired = clients.filter((c) => !c.blocked).map((c) => c.publicKey);
  const cfg = await readConfig(server);
  const inbound = (cfg.inbounds || []).find((i) => i.tag === kind.tag);
  if (!inbound) throw new Error("В конфиге Xray нет входящего подключения нужного протокола");

  const current = (inbound.settings.clients || []).map(kind.clientId);
  const add = desired.filter((id) => !current.includes(id));
  const remove = current.filter((id) => !desired.includes(id));
  if (add.length === 0 && remove.length === 0) return;

  // Перед изменением забираем накопленный трафик, чтобы ничего не потерять
  await collectStats(server);

  inbound.settings.clients = desired.map(kind.client);
  await writeConfig(server, cfg);

  const restart = async () => {
    await collectStats(server);
    await runOnHost(server, `docker restart ${shellQuote(server.container)}`);
  };
  // Протоколу без добавления на лету (Hysteria2) нужен перезапуск, как только появляется новый клиент
  if (add.length > 0 && !kind.liveAdd) {
    await restart();
    return;
  }
  try {
    await applyLive(server, add, remove);
  } catch (e) {
    console.warn(`[xray] применить на лету не вышло (${e.message}), перезапускаю контейнер`);
    await restart();
  }
}

function hostAndPort(server) {
  const e = extra(server);
  const m = String(server.endpoint).match(/^(.*):(\d+)$/);
  const host = m ? m[1] : server.endpoint;
  return { host: host.replace(/^\[|\]$/g, ""), port: e.port || (m ? m[2] : 443) };
}

function linkLabel(peer, server) {
  return encodeURIComponent(peer.name ? `${server.name}-${peer.name}` : server.name);
}

// Ссылка vless:// — её понимают Happ, v2rayN, v2rayNG, Streisand, Hiddify и др.
function buildVlessLink(peer, server) {
  const e = extra(server);
  const { host, port } = hostAndPort(server);
  const hostPart = host.includes(":") ? `[${host}]` : host;
  const q = {
    encryption: "none",
    flow: FLOW,
    security: "reality",
    sni: e.sni,
    fp: FINGERPRINT,
    pbk: server.public_key,
    sid: e.shortId,
    type: "tcp",
    headerType: "none",
  };
  const query = Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `vless://${peer.privateKey}@${hostPart}:${port}?${query}#${linkLabel(peer, server)}`;
}

// Ссылка hysteria2://. Сертификат самоподписанный, поэтому в ссылке его отпечаток (pinSHA256), а insecure=1
// нужен клиентам, которые без него не принимают такой сертификат.
function buildHysteria2Link(peer, server) {
  const e = extra(server);
  const { host, port } = hostAndPort(server);
  const hostPart = host.includes(":") ? `[${host}]` : host;
  return (
    `hysteria2://${peer.privateKey}@${hostPart}:${port}/` +
    `?sni=${encodeURIComponent(e.sni)}&insecure=1&pinSHA256=${server.public_key}#${linkLabel(peer, server)}`
  );
}

// Ссылка ss:// (SIP002/SIP022): пароль — «ключ сервера:ключ клиента», в ссылке закодирован в процентах
function buildShadowsocksLink(peer, server) {
  const { host, port } = hostAndPort(server);
  const hostPart = host.includes(":") ? `[${host}]` : host;
  const userinfo = `${SS_METHOD}:${encodeURIComponent(`${server.public_key}:${peer.privateKey}`)}`;
  return `ss://${userinfo}@${hostPart}:${port}#${linkLabel(peer, server)}`;
}

export function buildAppLink(peer, server) {
  if (server.protocol === "hysteria2") return buildHysteria2Link(peer, server);
  if (server.protocol === "shadowsocks") return buildShadowsocksLink(peer, server);
  return buildVlessLink(peer, server);
}

// У Xray нет файла конфигурации, как у WireGuard: «конфиг» — это та же ссылка
export const buildClientConfig = buildAppLink;
