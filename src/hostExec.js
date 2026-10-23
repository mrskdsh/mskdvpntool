import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const run = promisify(exec);

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Папка для общих SSH-соединений: следующие команды к тому же серверу идут по уже
// открытому каналу (быстрее в разы при синхронизации многих клиентов).
const SSH_MUX_DIR = path.join(os.tmpdir(), "skdsh-ssh");
try {
  fs.mkdirSync(SSH_MUX_DIR, { recursive: true, mode: 0o700 });
} catch (e) {
  console.warn("[hostExec] не удалось создать папку для SSH-соединений:", e.message);
}

export function sshCommand(server) {
  const opts = [
    "-o StrictHostKeyChecking=accept-new",
    "-o ConnectTimeout=10",
    "-o BatchMode=yes",
    "-o IdentitiesOnly=yes",
    "-o ServerAliveInterval=15",
    "-o ControlMaster=auto",
    `-o ControlPath=${shellQuote(path.join(SSH_MUX_DIR, "%C"))}`,
    "-o ControlPersist=120",
  ];
  return (
    `ssh ${opts.join(" ")} -i ${shellQuote(server.ssh_key_path)} ` +
    `${shellQuote(server.ssh_user || "root")}@${shellQuote(server.ssh_host)}`
  );
}

// Выполняет команду оболочки на сервере: локально или по SSH (если у сервера задан ssh_host).
// Команда передаётся в base64, поэтому кавычки и спецсимволы внутри ничего не ломают.
export async function runOnHost(server, shellCmd) {
  const b64 = Buffer.from(shellCmd, "utf-8").toString("base64");
  const wrapped = `echo ${b64} | base64 -d | sh`;
  const fullCmd = server.ssh_host ? `${sshCommand(server)} "${wrapped}"` : wrapped;
  let result;
  try {
    result = await run(fullCmd, { maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    // без самой команды в тексте: в ней может быть длинный base64
    throw new Error(String(e.stderr || e.stdout || e.message).trim().split("\n").slice(-3).join(" / "));
  }
  const { stdout, stderr } = result;
  if (stderr && stderr.trim()) {
    console.warn("[host] stderr:", stderr.trim());
  }
  return stdout.trim();
}
