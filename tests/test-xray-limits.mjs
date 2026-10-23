// Лимиты трафика и ежемесячный сброс на настоящем Xray
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
const SP = process.argv[2];
const { db } = await import(process.env.ROOT + "/src/db.js");
const { getProtocol } = await import(process.env.ROOT + "/src/protocols/index.js");
const { enforce } = await import(process.env.ROOT + "/src/limitEnforcer.js");
const { resetAll } = await import(process.env.ROOT + "/src/monthlyReset.js");
const P = getProtocol("vless-reality");
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) pass++; else { fail++; console.log("FAIL", n, x); } };
const sh = (c) => execSync(c, { encoding: "utf-8", shell: "/bin/bash" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

const prov = Object.fromEntries(fs.readFileSync(`${SP}/prov-xr.env`, "utf-8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
db.prepare(`INSERT INTO servers (id,name,endpoint,container,config_path,interface,public_key,preshared_key,subnet_prefix,protocol,extra_params)
  VALUES ('srv1','XR','127.0.0.1:39443','t-xr','/opt/skdsh-panel/xray-t-xr/config.json','-',?, '-','-','vless-reality',?)`)
  .run(prov.PUBLIC_KEY, JSON.stringify({ sni: prov.SNI, shortId: prov.SHORT_ID, port: 39443, apiPort: 39085 }));
const server = db.prepare("SELECT * FROM servers WHERE id='srv1'").get();
const clientsInCfg = () => JSON.parse(fs.readFileSync(server.config_path, "utf-8")).inbounds.find((i) => i.tag === "vless-reality").settings.clients.map((c) => c.id);

const mk = async (name, limit) => {
  const c = await P.generateClient(server);
  db.prepare("INSERT INTO peers (id,name,public_key,private_key,preshared_key,address,limit_gb,server_id) VALUES (?,?,?,?,?,?,?,'srv1')")
    .run(name, name, c.publicKey, c.privateKey, null, "-", limit);
  return c;
};
const sync = () => P.syncClients(db.prepare("SELECT * FROM peers WHERE server_id='srv1'").all().map((p) => ({ publicKey: p.public_key, blocked: !!p.blocked })), server);
const peer = (id) => db.prepare("SELECT * FROM peers WHERE id=?").get(id);

const A = await mk("A", 0.002);   // лимит ≈ 2 МБ
const B = await mk("B", null);    // без лимита
await sync();

function startClient(c, port) {
  const u = new URL(P.buildAppLink({ privateKey: c.privateKey, name: "x" }, server)); const q = u.searchParams;
  const cfg = { log: { loglevel: "warning" }, inbounds: [{ listen: "127.0.0.1", port, protocol: "socks", settings: { udp: false } }],
    outbounds: [{ protocol: "vless", settings: { vnext: [{ address: u.hostname, port: Number(u.port), users: [{ id: decodeURIComponent(u.username), encryption: "none", flow: q.get("flow") }] }] },
      streamSettings: { network: "tcp", security: "reality", realitySettings: { serverName: q.get("sni"), fingerprint: q.get("fp"), publicKey: q.get("pbk"), shortId: q.get("sid") } } }] };
  fs.writeFileSync(`${SP}/xr-lim-${port}.json`, JSON.stringify(cfg));
  const p = spawn(process.env.XRAY_BIN, ["run", "-c", `${SP}/xr-lim-${port}.json`], { stdio: "ignore", detached: true });
  return p;
}
const dl = (port, f) => { try { return Number(sh(`curl -s -m 12 --noproxy "" --socks5-hostname 127.0.0.1:${port} -o /dev/null -w '%{size_download}' http://127.0.0.1:39999/${f}`)); } catch { return -1; } };
const procs = [];
const fresh = async (c, port) => { const p = startClient(c, port); procs.push(p); await sleep(1000); return p; };

let pa = await fresh(A, 41101); const pb = await fresh(B, 41102);
check("A скачивает 1 МБ", dl(41101, "f1m") === 1 * MB);
await enforce();
check("до лимита A не заблокирован", peer("A").blocked === 0);

check("A скачивает ещё 3 МБ", dl(41101, "f3m") === 3 * MB);
check("B скачивает 3 МБ (без лимита)", dl(41102, "f3m") === 3 * MB);
await enforce();
check("после превышения лимита A заблокирован в базе", peer("A").blocked === 1);
check("A убран из config.json, B остался", !clientsInCfg().includes(A.publicKey) && clientsInCfg().includes(B.publicKey), clientsInCfg().join());
pa.kill(); pa = await fresh(A, 41103);
check("заблокированный A больше не ходит", dl(41103, "f1m") !== 1 * MB);
check("B продолжает ходить", dl(41102, "f1m") === 1 * MB);
check("B не заблокирован", peer("B").blocked === 0);

// админ сбрасывает расход (как маршрут reset-usage) и снимает блокировку
const stats = await P.getClientStats(server); const sA = stats.find((s) => s.publicKey === A.publicKey);
check("накопленный трафик A ≥ 4 МБ", sA.rxBytes >= 4 * MB, JSON.stringify(sA));
db.prepare("UPDATE peers SET base_rx=?, base_tx=?, blocked=0 WHERE id='A'").run(sA.rxBytes, sA.txBytes);
await sync();
await enforce();
check("после сброса расхода и снятия блока лимит не срабатывает снова", peer("A").blocked === 0);
pa.kill(); pa = await fresh(A, 41104);
check("A снова ходит", dl(41104, "f1m") === 1 * MB);

// ежемесячный сброс: базы приравниваются к накопленному
await resetAll();
const after = await P.getClientStats(server);
const rows = db.prepare("SELECT * FROM peers").all();
for (const r of rows) {
  const s = after.find((x) => x.publicKey === r.public_key);
  check(`ежемесячный сброс: ${r.id} база = накопленному`, s && r.base_rx === s.rxBytes && r.base_tx === s.txBytes, `${r.base_rx} vs ${s?.rxBytes}`);
}
for (const p of procs) { try { process.kill(-p.pid); } catch {} }
console.log(`ИТОГ: прошло ${pass}, провалов ${fail}`);
process.exit(fail ? 1 : 0);
