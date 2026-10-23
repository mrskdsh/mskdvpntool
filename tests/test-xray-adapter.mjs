// Сквозная проверка адаптера Xray на настоящем xray: сервер, клиенты, трафик, блокировка, перезапуск
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";

const SP = process.argv[2];
const { db } = await import(process.env.ROOT + "/src/db.js");
const { getProtocol } = await import(process.env.ROOT + "/src/protocols/index.js");
const P = getProtocol("vless-reality");

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log("FAIL", name, extra); } };
const sh = (c) => execSync(c, { encoding: "utf-8", shell: "/bin/bash" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const prov = Object.fromEntries(fs.readFileSync(`${SP}/prov-xr.env`, "utf-8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
db.prepare(`INSERT INTO servers (id,name,endpoint,container,config_path,interface,public_key,preshared_key,subnet_prefix,protocol,extra_params)
  VALUES ('srv1','XR','127.0.0.1:39443','t-xr','/opt/skdsh-panel/xray-t-xr/config.json','-',?, '-','-','vless-reality',?)`)
  .run(prov.PUBLIC_KEY, JSON.stringify({ sni: prov.SNI, shortId: prov.SHORT_ID, port: 39443, apiPort: 39085 }));
const server = db.prepare("SELECT * FROM servers WHERE id='srv1'").get();

const readCfg = () => JSON.parse(fs.readFileSync(server.config_path, "utf-8"));
const clientsInCfg = () => readCfg().inbounds.find((i) => i.tag === "vless-reality").settings.clients.map((c) => c.id);

// два клиента
const a = await P.generateClient(server), b = await P.generateClient(server);
check("UUID клиента", /^[0-9a-f-]{36}$/.test(a.publicKey) && a.publicKey !== b.publicKey);
check("адрес у Xray-клиента не нужен", P.nextAddress(server, []) === "-");

await P.syncClients([{ publicKey: a.publicKey, blocked: false }, { publicKey: b.publicKey, blocked: false }], server);
check("оба клиента записаны в config.json", clientsInCfg().length === 2 && clientsInCfg().includes(a.publicKey));
const modeStat = fs.statSync(server.config_path).mode & 0o777;
check("права config.json остались 600", modeStat === 0o600, modeStat.toString(8));

// клиентский конфиг строится из ссылки
function startClient(peer, port) {
  const link = P.buildAppLink({ privateKey: peer.privateKey, name: "тест клиент" }, server);
  const u = new URL(link);
  const q = u.searchParams;
  const cfg = {
    log: { loglevel: "warning" },
    inbounds: [{ listen: "127.0.0.1", port, protocol: "socks", settings: { udp: false } }],
    outbounds: [{
      protocol: "vless",
      settings: { vnext: [{ address: u.hostname, port: Number(u.port), users: [{ id: decodeURIComponent(u.username), encryption: q.get("encryption"), flow: q.get("flow") }] }] },
      streamSettings: { network: q.get("type"), security: q.get("security"), realitySettings: { serverName: q.get("sni"), fingerprint: q.get("fp"), publicKey: q.get("pbk"), shortId: q.get("sid") } },
    }],
  };
  fs.writeFileSync(`${SP}/xr-client-${port}.json`, JSON.stringify(cfg));
  const p = spawn(process.env.XRAY_BIN, ["run", "-c", `${SP}/xr-client-${port}.json`], { stdio: "ignore", detached: true });
  return { link, p };
}
const download = (port, mb = 1) => {
  try {
    return Number(sh(`curl -s -m 15 --noproxy "" --socks5-hostname 127.0.0.1:${port} -o /dev/null -w '%{size_download}' http://127.0.0.1:39999/f${mb}m`));
  } catch { return -1; }
};

const ca = startClient({ privateKey: a.privateKey }, 41081);
const cb = startClient({ privateKey: b.privateKey }, 41082);
await sleep(1200);
const link = ca.link;
check("ссылка vless:// собрана правильно", link.startsWith(`vless://${a.privateKey}@127.0.0.1:39443?`) && link.includes("security=reality") && link.includes(`pbk=${prov.PUBLIC_KEY}`) && link.includes(`sid=${prov.SHORT_ID}`) && link.includes("flow=xtls-rprx-vision") && link.includes(`sni=${prov.SNI}`) && link.endsWith("#" + encodeURIComponent("XR-тест клиент")), link);

const MB = 1024 * 1024;
check("клиент A ходит через туннель (3 МБ)", download(41081, 3) === 3 * MB);
check("клиент B ходит через туннель (1 МБ)", download(41082, 1) === 1 * MB);

let stats = await P.getClientStats(server);
const sA = stats.find((s) => s.publicKey === a.publicKey), sB = stats.find((s) => s.publicKey === b.publicKey);
check("статистика A ≥ 3 МБ", sA && sA.rxBytes + sA.txBytes >= 3 * MB && sA.rxBytes >= 3 * MB, JSON.stringify(sA));
check("статистика B ≥ 1 МБ и меньше A", sB && sB.rxBytes >= 1 * MB && sB.rxBytes < sA.rxBytes, JSON.stringify(sB));
check("lastHandshake — свежее время", sA.lastHandshake > Date.now() / 1000 - 60);

// повторный опрос не удваивает (сброс счётчиков в Xray)
const again = (await P.getClientStats(server)).find((s) => s.publicKey === a.publicKey);
check("повторный опрос не дублирует трафик", again.rxBytes === sA.rxBytes && again.txBytes === sA.txBytes, `${again.rxBytes} vs ${sA.rxBytes}`);

// блокировка B на лету: соединения A не рвутся
const longA = spawn("curl", ["-s", "-m", "20", "--noproxy", "", "--limit-rate", "400k", "--socks5-hostname", "127.0.0.1:41081", "-o", "/dev/null", "-w", "%{size_download}", "http://127.0.0.1:39999/f3m"], { stdio: ["ignore", "pipe", "ignore"] });
let longOut = ""; longA.stdout.on("data", (d) => (longOut += d));
await sleep(1000);
await P.syncClients([{ publicKey: a.publicKey, blocked: false }, { publicKey: b.publicKey, blocked: true }], server);
check("B убран из config.json", clientsInCfg().length === 1 && clientsInCfg()[0] === a.publicKey);
await sleep(300);
cb.p.kill(); const cb2 = startClient({ privateKey: b.privateKey }, 41083); await sleep(1000);
check("заблокированный B больше не проходит", download(41083, 1) !== 1 * MB);
await new Promise((r) => longA.on("close", r));
check("долгая загрузка A не прервалась блокировкой B (без перезапуска)", Number(longOut) === 3 * MB, longOut);

// разблокировка B
await P.syncClients([{ publicKey: a.publicKey, blocked: false }, { publicKey: b.publicKey, blocked: false }], server);
cb2.p.kill(); const cb3 = startClient({ privateKey: b.privateKey }, 41084); await sleep(1000);
check("разблокированный B снова проходит", download(41084, 1) === 1 * MB);

// перезапуск Xray: клиенты на месте, накопленный трафик не потерян
const before = (await P.getClientStats(server)).find((s) => s.publicKey === a.publicKey);
sh(`PATH=${SP}/fake3/bin:$PATH FAKE_LOG=${SP}/fake3.log FAKE_STATE=/tmp/fake3-state docker restart t-xr`);
await sleep(1200);
ca.p.kill(); const ca2 = startClient({ privateKey: a.privateKey }, 41085); await sleep(1000);
check("после перезапуска клиент A работает (клиенты в config.json)", download(41085, 1) === 1 * MB);
const after = (await P.getClientStats(server)).find((s) => s.publicKey === a.publicKey);
check("после перезапуска накопленный трафик сохранился и вырос", after.rxBytes >= before.rxBytes + 1 * MB, `${before.rxBytes} -> ${after.rxBytes}`);

// идемпотентность
await P.syncClients([{ publicKey: a.publicKey, blocked: false }, { publicKey: b.publicKey, blocked: false }], server);
check("повторная синхронизация ничего не ломает", clientsInCfg().length === 2);

// сломанный API: запасной путь — перезапуск контейнера
db.prepare("UPDATE servers SET extra_params=? WHERE id='srv1'").run(JSON.stringify({ sni: prov.SNI, shortId: prov.SHORT_ID, port: 39443, apiPort: 1 }));
const badServer = db.prepare("SELECT * FROM servers WHERE id='srv1'").get();
await P.syncClients([{ publicKey: a.publicKey, blocked: false }, { publicKey: b.publicKey, blocked: true }], badServer);
await sleep(1200);
check("при сбое API: конфиг обновлён, контейнер перезапущен", clientsInCfg().length === 1);
ca2.p.kill(); cb3.p.kill();
for (const p of [ca, cb, cb2, cb3, ca2]) { try { process.kill(-p.p.pid); } catch {} }
console.log(`ИТОГ: прошло ${pass}, провалов ${fail}`);
process.exit(fail ? 1 : 0);
