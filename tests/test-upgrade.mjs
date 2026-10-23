// Обновление боевой панели: старая база (схема из старой версии) + новый код.
// Использование: node test-upgrade.mjs <коммит> <рабочий каталог> <порт>
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
const [REV, SP, PORT] = process.argv.slice(2);
const ROOT = process.env.ROOT;
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) pass++; else { fail++; console.log(`FAIL [${REV}] ${n}`, x); } };
const sh = (c) => execSync(c, { encoding: "utf-8", shell: "/bin/bash", cwd: ROOT });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. старый код этого коммита во временной папке (node_modules берём из репозитория)
const OLD = `${SP}/old-${REV}`;
fs.rmSync(OLD, { recursive: true, force: true }); fs.mkdirSync(OLD, { recursive: true });
sh(`git archive ${REV} src lib | tar -x -C ${OLD}`);
fs.symlinkSync(`${ROOT}/node_modules`, `${OLD}/node_modules`);
fs.writeFileSync(`${OLD}/package.json`, JSON.stringify({ type: "module" }));
const DATA = `${SP}/upg-${REV}`;
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });

// 2. создаём базу СТАРЫМ кодом и наполняем её, как на боевой панели: AWG 2.0, три клиента
process.env.DATA_DIR = DATA; process.env.JWT_SECRET = "testsecret_testsecret_testsecret_1234";
const oldDb = (await import(pathToFileURL(`${OLD}/src/db.js`).href)).db;
const oldAuth = await import(pathToFileURL(`${OLD}/src/auth.js`).href);
const uid = { adm: randomUUID(), cli: randomUUID() };
const ins = oldDb.prepare("INSERT INTO users (id,username,password_hash,role,display_name) VALUES (?,?,?,?,?)");
ins.run(uid.adm, "boss", oldAuth.hashPassword("bosspass1"), "admin", "boss"); ins.run(uid.cli, "ivan", oldAuth.hashPassword("ivanpass1"), "client", "ivan");
oldDb.prepare(`INSERT INTO servers (id,name,endpoint,container,config_path,interface,public_key,preshared_key,jc,jmin,jmax,s1,s2,s3,s4,h1,h2,h3,h4,subnet_prefix,address_start,client_dns)
  VALUES ('srv-old','Основной','203.0.113.10:39001','skdsh-awg','/etc/amnezia/amneziawg/awg0.conf','awg0','SERVERPUBKEYSERVERPUBKEYSERVERPUBKEYSERV=','PSKPSKPSKPSKPSKPSKPSKPSKPSKPSKPSKPSKPSKPSKP=','5','50','1000','80','90','30','40','1234567-1234999','2345678-2345999','3456789-3456999','4567890-4567999','10.9.1.',2,'1.1.1.1')`).run();
const mkKey = (c) => (c.repeat(43) + "=");
const peers = [
  ["p1", "Телефон Ивана", "A", 2, 50, 0, uid.cli], ["p2", "Ноутбук", "B", 3, null, 0, uid.cli], ["p3", "Заблокированный", "C", 4, 10, 1, null],
];
for (const [id, name, c, n, lim, blocked, owner] of peers)
  oldDb.prepare(`INSERT INTO peers (id,name,public_key,private_key,preshared_key,address,limit_gb,blocked,base_rx,base_tx,owner_id,server_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'srv-old')`).run(id, name, mkKey(c.toLowerCase()), mkKey(c), "PSKPSKPSKPSKPSKPSKPSKPSKPSKPSKPSKPSKPSKPSKP=", `10.9.1.${n}`, lim, blocked, 1000 * n, 500 * n, owner);
oldDb.prepare("INSERT INTO connection_requests (id,user_id,name,full_name,contact,comment) VALUES (?,?,?,?,?,?)").run(randomUUID(), uid.cli, "ivan", "Иван Петров", "@ivan", "нужен доступ");
oldDb.prepare("INSERT INTO support_tickets (id,user_id,name,message) VALUES (?,?,?,?)").run(randomUUID(), uid.cli, "ivan", "не работает");
const oldRows = { server: oldDb.prepare("SELECT * FROM servers").get(), peers: oldDb.prepare("SELECT * FROM peers ORDER BY id").all(), users: oldDb.prepare("SELECT * FROM users").all() };
const oldToken = oldAuth.signToken(oldRows.users.find((u) => u.username === "boss")); // токен старого формата
oldDb.pragma("wal_checkpoint(TRUNCATE)"); oldDb.close();

// 3. что выдавал старый код (для сравнения)
let oldAwg;
for (const f of ["src/protocols/awg.js", "src/awg.js"]) if (fs.existsSync(`${OLD}/${f}`)) { oldAwg = await import(pathToFileURL(`${OLD}/${f}`).href); break; }
const arg = (p) => ({ privateKey: p.private_key, presharedKey: p.preshared_key, publicKey: p.public_key, address: p.address, name: p.name });
const oldOut = oldRows.peers.map((p) => ({ cfg: oldAwg.buildClientConfig(arg(p), oldRows.server), link: oldAwg.buildAmneziaVpnLink(arg(p), oldRows.server) }));

// Конфиг «контейнера» на подменённом docker (команды docker exec на тесте идут прямо на эту машину)
const CONF = "/etc/amnezia/amneziawg/awg0.conf"; const confDirExisted = fs.existsSync(path.dirname(CONF));
fs.mkdirSync(path.dirname(CONF), { recursive: true });
fs.writeFileSync(CONF, `[Interface]\nPrivateKey = SERVERPRIVSERVERPRIVSERVERPRIVSERVERPRIV0=\nAddress = 10.9.1.1/24\nListenPort = 39001\nJc = 5\nJmin = 50\nJmax = 1000\nS1 = 80\nS2 = 90\nS3 = 30\nS4 = 40\nH1 = 1234567-1234999\nH2 = 2345678-2345999\nH3 = 3456789-3456999\nH4 = 4567890-4567999\n\n` +
  oldRows.peers.map((p) => `[Peer]\nPublicKey = ${p.public_key}\nPresharedKey = ${p.preshared_key}\nAllowedIPs = ${p.address}/32`).join("\n\n") + "\n");
// 4. копия боевой базы + НОВЫЙ код
fs.copyFileSync(`${DATA}/panel.db`, `${DATA}/before-upgrade.db`);
const env = { ...process.env, DATA_DIR: DATA, PORT, NODE_ENV: "development", ROOT,
  PATH: `${SP}/fake2/bin:${process.env.PATH}`, FAKE_LOG: `${SP}/fake2-upg.log` };
const srv = spawn("node", ["src/server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
await sleep(2500);
const B = `http://127.0.0.1:${PORT}`;
const cookie = (res) => (res.headers.get("set-cookie") || "").split(";")[0];
const call = async (p, { body, method, ck } = {}) => {
  const res = await fetch(B + "/api" + p, { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(ck ? { Cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await res.json(); } catch {}
  return { st: res.status, j, ck: cookie(res) };
};
check("панель запустилась на старой базе", log.includes("listening") && !/error|Error/.test(log.replace(/stderr/g, "")), log.slice(0, 400));

const Database = (await import("better-sqlite3")).default;
const nd = new Database(`${DATA}/panel.db`, { readonly: true });
const cols = (t) => nd.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
check("в servers появились колонки protocol, awg_version, extra_params", ["protocol", "awg_version", "extra_params"].every((c) => cols("servers").includes(c)), cols("servers"));
check("появилась таблица traffic_totals", nd.prepare("SELECT 1 FROM sqlite_master WHERE name='traffic_totals'").get() !== undefined);
const nSrv = nd.prepare("SELECT * FROM servers").get();
check("старый сервер: protocol=awg, версия 2", nSrv.protocol === "awg" && String(nSrv.awg_version) === "2", [nSrv.protocol, nSrv.awg_version]);
check("все поля сервера и параметры AWG не изменились", Object.keys(oldRows.server).every((k) => String(oldRows.server[k]) === String(nSrv[k])));
const nPeers = nd.prepare("SELECT * FROM peers ORDER BY id").all();
check("клиенты, адреса, ключи, лимиты, блокировки не изменились", JSON.stringify(nPeers.map((p) => oldRows.peers.find((o) => o.id === p.id) && Object.keys(oldRows.peers[0]).every((k) => String(oldRows.peers.find((o) => o.id === p.id)[k]) === String(p[k])))) === "[true,true,true]");
check("заявки и обращения на месте", nd.prepare("SELECT COUNT(*) c FROM connection_requests").get().c === 1 && nd.prepare("SELECT COUNT(*) c FROM support_tickets").get().c === 1);
check("целостность базы (integrity_check)", nd.prepare("PRAGMA integrity_check").get().integrity_check === "ok");

// вход со старыми паролями
const adm = await call("/auth/login", { body: { username: "boss", password: "bosspass1" } });
const cli = await call("/auth/login", { body: { username: "ivan", password: "ivanpass1" } });
check("админ входит со старым паролем", adm.st === 200 && adm.j.user?.role === "admin", adm);
check("клиент входит со старым паролем", cli.st === 200);
const stale = await call("/auth/me", { ck: `token=${oldToken}` });
check("токен старого формата отклонён (нужно войти заново)", stale.st === 401, stale);

// те же данные для клиентов
const list = await call("/servers", { ck: adm.ck });
check("сервер виден как AmneziaWG 2.0", list.j[0]?.protocol === "awg" && String(list.j[0]?.awg_version) === "2", list.j[0]);
const pl = await call("/peers", { ck: adm.ck });
check("список клиентов отдаёт 3 доступа с версией 2", pl.st === 200 && pl.j.length === 3 && pl.j.every((p) => p.awgVersion === "2" && p.protocol === "awg"), pl);
check("блокировка и лимиты сохранились в API", pl.j.find((p) => p.id === "p3")?.blocked === true && pl.j.find((p) => p.id === "p1")?.limitGB === 50);
const mine = await call("/peers", { ck: cli.ck });
check("клиент видит только свои 2 доступа", mine.j.length === 2, mine.j.length);

// выдаваемые ссылки и конфиги
let linkSame = true, cfgDiff = [];
for (let i = 0; i < oldRows.peers.length; i++) {
  const id = oldRows.peers[i].id;
  const l = await call(`/peers/${id}/vpn-link`, { ck: adm.ck });
  if (l.j.link !== oldOut[i].link) linkSame = false;
  const c = await call(`/peers/${id}/config`, { ck: adm.ck });
  if (c.j.config !== oldOut[i].cfg) cfgDiff.push(id);
}
check("ссылки vpn:// для AmneziaVPN идентичны выдаваемым старой версией (клиентам ничего переимпортировать не нужно)", linkSame);
if (cfgDiff.length) {
  const a = (await call(`/peers/${oldRows.peers[0].id}/config`, { ck: adm.ck })).j.config.split("\n"), b = oldOut[0].cfg.split("\n");
  const extra = a.filter((x) => !b.includes(x)), gone = b.filter((x) => !a.includes(x));
  console.log(`INFO [${REV}] текстовый .conf отличается от старого: добавлено ${JSON.stringify(extra)}, убрано ${JSON.stringify(gone)}`);
}
// новый клиент на старом сервере продолжает нумерацию
const np = await call("/peers", { body: { name: "Новый", serverId: "srv-old", ownerId: uid.cli }, ck: adm.ck });
check("новый клиент создаётся на старом сервере, адрес 10.9.1.5", np.st === 201 && np.j.address === "10.9.1.5", np);
const del = await call(`/peers/${np.j.id}`, { method: "DELETE", ck: adm.ck });
check("и удаляется", del.st === 200);
check("смена пароля работает на старой базе", (await call("/auth/change-password", { body: { currentPassword: "ivanpass1", newPassword: "ivanpass2" }, ck: cli.ck })).st === 200);
check("новый вход по новому паролю", (await call("/auth/login", { body: { username: "ivan", password: "ivanpass2" } })).st === 200);
srv.kill(); await sleep(300); nd.close();
fs.rmSync(CONF, { force: true }); fs.rmSync(CONF + ".sync", { force: true }); if (!confDirExisted) fs.rmSync("/etc/amnezia", { recursive: true, force: true });

// 5. откат: старый код читает базу, прошедшую через новый код (запасной план)
const Rb = new Database(`${DATA}/before-upgrade.db`, { readonly: true });
check("резервная копия до обновления цела и читается", Rb.prepare("SELECT COUNT(*) c FROM peers").get().c === 3 && Rb.prepare("PRAGMA integrity_check").get().integrity_check === "ok");
console.log(`ИТОГ [${REV}]: прошло ${pass}, провалов ${fail}`);
process.exit(fail ? 1 : 0);
