// Сквозная проверка адаптера Hysteria2 на настоящем xray
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
const SP = process.argv[2];
const { db } = await import(process.env.ROOT + "/src/db.js");
const { getProtocol } = await import(process.env.ROOT + "/src/protocols/index.js");
const P = getProtocol("shadowsocks");
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) pass++; else { fail++; console.log("FAIL", n, x); } };
const sh = (c) => execSync(c, { encoding: "utf-8", shell: "/bin/bash" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;
const prov = Object.fromEntries(fs.readFileSync(`${SP}/prov-ss.env`, "utf-8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));

db.prepare(`INSERT INTO servers (id,name,endpoint,container,config_path,interface,public_key,preshared_key,subnet_prefix,protocol,extra_params)
  VALUES ('srv1','SS','127.0.0.1:39565','t-ss','/opt/skdsh-panel/xray-t-ss/config.json','-',?, '-','-','shadowsocks',?)`)
  .run(prov.KEY, JSON.stringify({ port: 39565, apiPort: 39087 }));
const server = db.prepare("SELECT * FROM servers WHERE id='srv1'").get();
const clientsInCfg = () => JSON.parse(fs.readFileSync(server.config_path, "utf-8")).inbounds.find((i) => i.tag === "shadowsocks").settings.clients.map((c) => c.password);

const A = await P.generateClient(server), B = await P.generateClient(server);
await P.syncClients([{ publicKey: A.publicKey, blocked: false }, { publicKey: B.publicKey, blocked: false }], server);
check("оба клиента в config.json (auth = UUID)", clientsInCfg().length === 2 && clientsInCfg().includes(A.publicKey));
await sleep(1500);

const procs = [];
function startClient(c, port) {
  const link = P.buildAppLink({ privateKey: c.privateKey, name: "тест" }, server);
  const cfg = { log: { loglevel: "warning" }, inbounds: [{ listen: "127.0.0.1", port, protocol: "socks", settings: { udp: false } }],
    outbounds: [{ protocol: "shadowsocks", settings: { servers: [{ address: "127.0.0.1", port: 39565, method: "2022-blake3-aes-128-gcm", password: prov.KEY + ":" + c.privateKey }] } }] };
  fs.writeFileSync(`${SP}/xr-ss-${port}.json`, JSON.stringify(cfg));
  const p = spawn(process.env.XRAY_BIN, ["run", "-c", `${SP}/xr-ss-${port}.json`], { stdio: "ignore", detached: true });
  procs.push(p);
  return { link, p };
}
const dl = (port, f) => { try { return Number(sh(`curl -s -m 12 --noproxy "" --socks5-hostname 127.0.0.1:${port} -o /dev/null -w '%{size_download}' http://127.0.0.1:39999/${f}`)); } catch { return -1; } };

const ca = startClient(A, 41301); const cb = startClient(B, 41302); await sleep(1000);
const link = ca.link;
const um = /^ss:\/\/([^:]+):([^@]+)@127\.0\.0\.1:39565#(.*)$/.exec(link);
check("ссылка ss:// собрана правильно (метод, ключи, метка)", um && um[1] === "2022-blake3-aes-128-gcm" && decodeURIComponent(um[2]) === prov.KEY + ":" + A.publicKey && um[3] === encodeURIComponent("SS-тест"), link);
check("ключ клиента — 16 байт base64", Buffer.from(A.publicKey, "base64").length === 16);
check("A ходит через Shadowsocks (3 МБ)", dl(41301, "f3m") === 3 * MB);
check("B ходит через Shadowsocks (1 МБ)", dl(41302, "f1m") === 1 * MB);
let stats = await P.getClientStats(server);
const sA = stats.find((s) => s.publicKey === A.publicKey), sB = stats.find((s) => s.publicKey === B.publicKey);
check("статистика A ≥ 3 МБ, B ≥ 1 МБ", sA && sB && sA.rxBytes >= 3 * MB && sB.rxBytes >= 1 * MB, JSON.stringify([sA, sB]));
const again = (await P.getClientStats(server)).find((s) => s.publicKey === A.publicKey);
check("повторный опрос не дублирует трафик", again.rxBytes === sA.rxBytes);

// блокировка B на лету (без перезапуска): долгая загрузка A не рвётся
const longA = spawn("curl", ["-s", "-m", "20", "--noproxy", "", "--limit-rate", "400k", "--socks5-hostname", "127.0.0.1:41301", "-o", "/dev/null", "-w", "%{size_download}", "http://127.0.0.1:39999/f3m"], { stdio: ["ignore", "pipe", "ignore"] });
let longOut = ""; longA.stdout.on("data", (d) => (longOut += d));
await sleep(1000);
await P.syncClients([{ publicKey: A.publicKey, blocked: false }, { publicKey: B.publicKey, blocked: true }], server);
check("B убран из config.json", clientsInCfg().length === 1 && clientsInCfg()[0] === A.publicKey);
await sleep(300);
cb.p.kill(); const cb2 = startClient(B, 41303); await sleep(1000);
check("заблокированный B не проходит", dl(41303, "f1m") !== 1 * MB);
await new Promise((r) => longA.on("close", r));
check("загрузка A не прервалась блокировкой B", Number(longOut) === 3 * MB, longOut);

// разблокировка = добавление на лету (без перезапуска); накопленный трафик цел
const beforeRestart = (await P.getClientStats(server)).find((s) => s.publicKey === A.publicKey);
await P.syncClients([{ publicKey: A.publicKey, blocked: false }, { publicKey: B.publicKey, blocked: false }], server);
await sleep(1500);
check("после разблокировки оба клиента в конфиге", clientsInCfg().length === 2);
ca.p.kill(); cb2.p.kill(); const ca2 = startClient(A, 41304); const cb3 = startClient(B, 41305); await sleep(1000);
check("после разблокировки A ходит", dl(41304, "f1m") === 1 * MB);
check("после разблокировки разблокированный B ходит", dl(41305, "f1m") === 1 * MB);
const afterRestart = (await P.getClientStats(server)).find((s) => s.publicKey === A.publicKey);
check("накопленный трафик A сохранился и вырос", afterRestart.rxBytes >= beforeRestart.rxBytes + 1 * MB, `${beforeRestart.rxBytes} -> ${afterRestart.rxBytes}`);

// сломанный API при удалении: запасной путь — перезапуск
db.prepare("UPDATE servers SET extra_params=? WHERE id='srv1'").run(JSON.stringify({ sni: prov.SNI, port: 39555, apiPort: 1 }));
await P.syncClients([{ publicKey: A.publicKey, blocked: false }, { publicKey: B.publicKey, blocked: true }], db.prepare("SELECT * FROM servers WHERE id='srv1'").get());
await sleep(1500);
check("при сбое API конфиг обновлён", clientsInCfg().length === 1);
for (const p of procs) { try { process.kill(-p.pid); } catch {} }
console.log(`ИТОГ: прошло ${pass}, провалов ${fail}`);
process.exit(fail ? 1 : 0);
