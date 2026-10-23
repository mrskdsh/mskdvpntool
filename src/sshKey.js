import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Создание SSH-ключа для панели и установка его на удалённый сервер по ОДНОРАЗОВОМУ паролю.
// Пароль живёт только в памяти на время запроса: он не пишется ни в базу, ни в журнал, ни в файл,
// а до ssh доходит через переменную окружения и временный askpass-скрипт, который удаляется сразу после.
// Все команды запускаются массивом аргументов — через оболочку ничего не проходит.

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
export const SSH_KEY_DIR = path.join(DATA_DIR, "ssh");

const PUBKEY_LINE = /^ssh-ed25519 [A-Za-z0-9+/=]+ mr-skdsh-vpn-panel$/;
const KEY_OPTIONS = "no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty";

function run(cmd, args, { env, timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    // detached: у процесса нет управляющего терминала, поэтому ssh берёт пароль только из askpass
    const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString("utf-8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf-8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function baseEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME || "/root",
    LANG: process.env.LANG || "C.UTF-8",
  };
}

// Создаёт новую пару ключей в папке данных панели (доступ только владельцу)
export async function createPanelKey(host) {
  fs.mkdirSync(SSH_KEY_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(SSH_KEY_DIR, 0o700);

  const safeHost = host.replace(/[^A-Za-z0-9]/g, "_").slice(0, 40);
  const keyPath = path.join(SSH_KEY_DIR, `skdsh_${safeHost}_${randomBytes(3).toString("hex")}`);

  const gen = await run(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-C", "mr-skdsh-vpn-panel", "-f", keyPath],
    { env: baseEnv() }
  );
  if (gen.code !== 0) {
    throw new Error("Не удалось создать SSH-ключ (установлен ли openssh-client?)");
  }
  fs.chmodSync(keyPath, 0o600);

  const pub = fs.readFileSync(`${keyPath}.pub`, "utf-8").trim();
  if (!PUBKEY_LINE.test(pub)) {
    throw new Error("Создан ключ неожиданного формата");
  }
  return { keyPath, pub };
}

// Устанавливает публичный ключ на сервер, войдя по паролю (один раз)
export async function installKeyWithPassword({ host, user, password, pub }) {
  if (!PUBKEY_LINE.test(pub)) throw new Error("Недопустимый публичный ключ");
  const blob = pub.split(" ")[1];

  const askDir = fs.mkdtempSync(path.join(os.tmpdir(), "skdsh-askpass-"));
  const askScript = path.join(askDir, "askpass.sh");
  try {
    fs.writeFileSync(askScript, '#!/bin/sh\nprintf \'%s\\n\' "$SKDSH_SSH_PASSWORD"\n', { mode: 0o700 });

    const remote =
      `umask 077; mkdir -p ~/.ssh; grep -qF '${blob}' ~/.ssh/authorized_keys 2>/dev/null || ` +
      `echo '${KEY_OPTIONS} ${pub}' >> ~/.ssh/authorized_keys`;

    const res = await run(
      "ssh",
      [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=10",
        "-o", "PubkeyAuthentication=no",
        "-o", "PreferredAuthentications=password,keyboard-interactive",
        "-o", "NumberOfPasswordPrompts=1",
        `${user}@${host}`,
        remote,
      ],
      {
        env: {
          ...baseEnv(),
          SSH_ASKPASS: askScript,
          SSH_ASKPASS_REQUIRE: "force",
          DISPLAY: process.env.DISPLAY || ":0",
          SKDSH_SSH_PASSWORD: password,
        },
        timeoutMs: 40000,
      }
    );

    if (res.code !== 0) {
      if (/Permission denied/i.test(res.stderr)) {
        throw new Error(
          "Сервер не принял пароль: он неверный, либо вход по паролю на сервере отключён (для root часто запрещён)"
        );
      }
      if (/timed out|No route|Could not resolve|refused/i.test(res.stderr)) {
        throw new Error("Не удалось подключиться к серверу по SSH (порт 22): проверьте адрес и доступность");
      }
      throw new Error("Не удалось установить ключ на сервер по SSH");
    }
  } finally {
    fs.rmSync(askDir, { recursive: true, force: true });
  }
}

// Проверяет вход по ключу без пароля
export async function verifyKeyLogin({ host, user, keyPath }) {
  const res = await run(
    "ssh",
    [
      "-n",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=10",
      "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes",
      "-i", keyPath,
      `${user}@${host}`,
      "echo ok",
    ],
    { env: baseEnv(), timeoutMs: 20000 }
  );
  return res.code === 0 && res.stdout.trim() === "ok";
}
