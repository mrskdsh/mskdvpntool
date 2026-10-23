import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "panel.db"));
db.pragma("journal_mode = WAL");

// В базе лежат ключи клиентов: доступ только владельцу (root)
try {
  fs.chmodSync(DATA_DIR, 0o700);
  for (const f of ["panel.db", "panel.db-wal", "panel.db-shm"]) {
    const full = path.join(DATA_DIR, f);
    if (fs.existsSync(full)) fs.chmodSync(full, 0o600);
  }
} catch (e) {
  console.warn("[db] не удалось ограничить права на каталог данных:", e.message);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client' CHECK(role IN ('admin','client')),
    display_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    container TEXT NOT NULL,
    config_path TEXT NOT NULL,
    interface TEXT NOT NULL DEFAULT 'awg0',
    public_key TEXT NOT NULL,
    preshared_key TEXT NOT NULL,
    jc TEXT, jmin TEXT, jmax TEXT,
    s1 TEXT, s2 TEXT, s3 TEXT, s4 TEXT,
    h1 TEXT, h2 TEXT, h3 TEXT, h4 TEXT,
    subnet_prefix TEXT NOT NULL,
    address_start INTEGER NOT NULL DEFAULT 2,
    client_dns TEXT DEFAULT '1.1.1.1',
    ssh_host TEXT,
    ssh_user TEXT DEFAULT 'root',
    ssh_key_path TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS peers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    public_key TEXT UNIQUE NOT NULL,
    private_key TEXT,
    preshared_key TEXT,
    address TEXT NOT NULL,
    limit_gb REAL,
    blocked INTEGER NOT NULL DEFAULT 0,
    base_rx INTEGER NOT NULL DEFAULT 0,
    base_tx INTEGER NOT NULL DEFAULT 0,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS traffic_totals (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    client_key TEXT NOT NULL,
    rx INTEGER NOT NULL DEFAULT 0,
    tx INTEGER NOT NULL DEFAULT 0,
    last_active INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (server_id, client_key)
  );

  CREATE TABLE IF NOT EXISTS connection_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    full_name TEXT,
    contact TEXT,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    response TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

try {
  db.exec("ALTER TABLE peers ADD COLUMN server_id TEXT REFERENCES servers(id) ON DELETE CASCADE");
} catch {
}
try {
  db.exec("ALTER TABLE servers ADD COLUMN ssh_host TEXT");
  db.exec("ALTER TABLE servers ADD COLUMN ssh_user TEXT DEFAULT 'root'");
  db.exec("ALTER TABLE servers ADD COLUMN ssh_key_path TEXT");
} catch {
}
try {
  db.exec("ALTER TABLE connection_requests ADD COLUMN full_name TEXT");
  db.exec("ALTER TABLE connection_requests ADD COLUMN contact TEXT");
} catch {
}

for (const ddl of [
  "ALTER TABLE servers ADD COLUMN awg_version TEXT NOT NULL DEFAULT '2'",
  "ALTER TABLE servers ADD COLUMN extra_params TEXT",
  "ALTER TABLE servers ADD COLUMN protocol TEXT NOT NULL DEFAULT 'awg'",
]) {
  try {
    db.exec(ddl);
  } catch {
  }
}

const serverCount = db.prepare("SELECT COUNT(*) as c FROM servers").get().c;
if (serverCount === 0 && process.env.AWG_CONTAINER) {
  const legacyId = "legacy-default";
  db.prepare(
    `INSERT INTO servers
     (id, name, endpoint, container, config_path, interface, public_key, preshared_key,
      jc, jmin, jmax, s1, s2, s3, s4, h1, h2, h3, h4, subnet_prefix, address_start, client_dns)
     VALUES (@id, @name, @endpoint, @container, @config_path, @interface, @public_key, @preshared_key,
      @jc, @jmin, @jmax, @s1, @s2, @s3, @s4, @h1, @h2, @h3, @h4, @subnet_prefix, @address_start, @client_dns)`
  ).run({
    id: legacyId,
    name: process.env.SERVER_DISPLAY_NAME || "Основной сервер",
    endpoint: process.env.SERVER_ENDPOINT,
    container: process.env.AWG_CONTAINER,
    config_path: process.env.AWG_CONFIG_PATH,
    interface: process.env.AWG_INTERFACE || "awg0",
    public_key: process.env.SERVER_PUBLIC_KEY,
    preshared_key: process.env.SERVER_PRESHARED_KEY,
    jc: process.env.AWG_JC,
    jmin: process.env.AWG_JMIN,
    jmax: process.env.AWG_JMAX,
    s1: process.env.AWG_S1,
    s2: process.env.AWG_S2,
    s3: process.env.AWG_S3,
    s4: process.env.AWG_S4,
    h1: process.env.AWG_H1,
    h2: process.env.AWG_H2,
    h3: process.env.AWG_H3,
    h4: process.env.AWG_H4,
    subnet_prefix: process.env.PEER_SUBNET_PREFIX,
    address_start: Number(process.env.PEER_ADDRESS_START || 2),
    client_dns: process.env.CLIENT_DNS || "1.1.1.1",
  });

  db.prepare("UPDATE peers SET server_id = ? WHERE server_id IS NULL").run(legacyId);
  console.log("[db] мигрировал старую .env-конфигурацию в servers как", legacyId);
}
