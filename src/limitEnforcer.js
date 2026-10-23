import cron from "node-cron";
import { db } from "./db.js";
import { protocolOf } from "./protocols/index.js";

async function enforceForServer(server) {
  const peers = db
    .prepare("SELECT * FROM peers WHERE server_id = ? AND limit_gb IS NOT NULL")
    .all(server.id);
  if (peers.length === 0) return;

  let stats = [];
  try {
    stats = await protocolOf(server).getClientStats(server);
  } catch (e) {
    console.error(`[limitEnforcer] failed to read stats for ${server.name}:`, e.message);
    return;
  }
  const byKey = Object.fromEntries(stats.map((s) => [s.publicKey, s]));

  let anyBlocked = false;
  for (const peer of peers) {
    const live = byKey[peer.public_key];
    if (!live) continue;

    const usedBytes =
      Math.max(0, live.rxBytes - peer.base_rx) + Math.max(0, live.txBytes - peer.base_tx);
    const limitBytes = peer.limit_gb * 1024 * 1024 * 1024;

    if (usedBytes >= limitBytes && !peer.blocked) {
      console.log(`[limitEnforcer] ${peer.name} exceeded limit, blocking`);
      db.prepare("UPDATE peers SET blocked = 1 WHERE id = ?").run(peer.id);
      anyBlocked = true;
    }
  }

  if (anyBlocked) {
    const all = db.prepare("SELECT * FROM peers WHERE server_id = ?").all(server.id);
    await protocolOf(server).syncClients(
      all.map((p) => ({
        publicKey: p.public_key,
        presharedKey: p.preshared_key,
        address: p.address,
        blocked: Boolean(p.blocked),
      })),
      server
    );
  }
}

export async function enforce() {
  const servers = db.prepare("SELECT * FROM servers").all();
  for (const server of servers) {
    await enforceForServer(server);
  }
}

export function startLimitEnforcer() {
  cron.schedule("* * * * *", () => {
    enforce().catch((e) => console.error("[limitEnforcer]", e));
  });
  console.log("[limitEnforcer] started, checking every 1 min");
}
