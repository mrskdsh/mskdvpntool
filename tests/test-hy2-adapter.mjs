// Сквозная проверка адаптера Hysteria2 на настоящем xray
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
const SP = process.argv[2];
const { db } = await import(process.env.ROOT + "/src/db.js");
const { getProtocol } = await import(process.env.ROOT + "/src/protocols/index.js");
const P = getProtocol("hysteria2");
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) pass++; else { fail++; console.log("FAIL", n, x); } };
const sh = (c) => execSync(c, { encoding: "utf-8", shell: "/bin/bash" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;
const prov = Object.fromEntries(fs.readFileSync(`${SP}/prov-hy.env`, "utf-8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));

db.prepare(`INSERT INTO servers (id,name,endpoint,container,config_path,interface,public_key,preshared_key,subnet_prefix,protocol,extra_params)
  VALUES ('srv1','HY','127.0.0.1:39555','t-hy','/opt/skdsh-panel/xray-t-hy/config.json','-',?, '-','-','hysteria2',?)`)
  .run(prov.PIN_SHA256, JSON.stringify({ sni: prov.SNI, port: 39555, apiPort: 39086 }));
const server = db.prepare("SELECT * FROM servers WHERE id='srv1'").get();
const clientsInCfg = () => JSON.parse(fs.readFileSync(server.config_path, "utf-8")).inbounds.find((i) => i.tag === "hysteria2").settings.clients.map((c) => c.auth);

const A = await P.generateClient(server), B = await P.generateClient(server);
await P.syncClients([{ publicKey: A.publicKey, blocked: false }, { publicKey: B.publicKey, blocked: false }], server);
check("оба клиента в config.json (auth = UUID)", clientsInCfg().length === 2 && clientsInCfg().includes(A.publicKey));
await sleep(1500);

const procs = [];
function startClient(c, port) {
  const link = P.buildAppLink({ privateKey: c.privateKey, name: "тест" }, server);
  const u = new URL(link); const q = u.searchParams;
  const cfg = { log: { loglevel: "warning" }, inbounds: [{ listen: "127.0.0.1", port, protocol: "socks", settings: { udp: false } }],
    outbounds: [{ protocol: "hysteria", settings: { version: 2, address: u.hostname, port: Number(u.port) },
      streamSettings: { network: "hysteria", security: "tls",
        tlsSettings: { serverName: q.get("sni"), alpn: ["h3"], pinnedPeerCertSha256: q.get("pinSHA256").replace(/:/g, "").toLowerCase() },
        hysteriaSettings: { version: 2, auth: decodeURIComponent(u.username) } } }] };
  fs.writeFileSync(`${SP}/xr-hy-${port}.json`, JSON.stringify(cfg));
  const p = spawn(process.env.XRAY_BIN, ["run", "-c", `${SP}/xr-hy-${port}.json`], { stdio: "ignore", detached: true });
  procs.push(p);
  return { link, p };
}
const dl = (port, f) => { try { return Number(sh(`curl -s -m 12 --noproxy "" --socks5-hostname 127.0.0.1:${port} -o /dev/null -w '%{size_download}' http://127.0.0.1:39999/${f}`)); } catch { return -1; } };

const ca = startClient(A, 41301); const cb = startClient(B, 41302); await sleep(1000);
const link = ca.link;
check("ссылка hysteria2:// собрана правильно", link.startsWith(`hysteria2://${A.publicKey}@127.0.0.1:39555/?sni=${prov.SNI}&insecure=1&pinSHA256=${prov.PIN_SHA256}#`) && link.endsWith("#" + encodeURIComponent("HY-тест")), link);
check("A ходит через Hysteria2 (3 МБ)", dl(41301, "f3m") === 3 * MB);
check("B ходит через Hysteria2 (1 МБ)", dl(41302, "f1m") === 1 * MB);
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

// разблокировка = добавление = перезапуск; накопленный трафик цел
const beforeRestart = (await P.getClientStats(server)).find((s) => s.publicKey === A.publicKey);
await P.syncClients([{ publicKey: A.publicKey, blocked: false }, { publicKey: B.publicKey, blocked: false }], server);
await sleep(1500);
check("после разблокировки оба клиента в конфиге", clientsInCfg().length === 2);
ca.p.kill(); cb2.p.kill(); const ca2 = startClient(A, 41304); const cb3 = startClient(B, 41305); await sleep(1000);
check("после перезапуска A ходит", dl(41304, "f1m") === 1 * MB);
check("после перезапуска разблокированный B ходит", dl(41305, "f1m") === 1 * MB);
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
