import cron from "node-cron";
import { db } from "./db.js";
import { protocolOf } from "./protocols/index.js";

async function resetForServer(server) {
  const peers = db.prepare("SELECT * FROM peers WHERE server_id = ?").all(server.id);
  if (peers.length === 0) return;

  let stats = [];
  try {
    stats = await protocolOf(server).getClientStats(server);
  } catch (e) {
    console.error(`[monthlyReset] failed to read stats for ${server.name}:`, e.message);
    return;
  }
  const byKey = Object.fromEntries(stats.map((s) => [s.publicKey, s]));

  const update = db.prepare("UPDATE peers SET base_rx = ?, base_tx = ? WHERE id = ?");
  for (const peer of peers) {
    const live = byKey[peer.public_key];
    update.run(live?.rxBytes ?? peer.base_rx, live?.txBytes ?? peer.base_tx, peer.id);
  }
  console.log(`[monthlyReset] reset usage counters for ${peers.length} peers on ${server.name}`);
}

export async function resetAll() {
  const servers = db.prepare("SELECT * FROM servers").all();
  for (const server of servers) {
    await resetForServer(server);
  }
}

export function startMonthlyReset() {
  cron.schedule("0 0 1 * *", () => {
    resetAll().catch((e) => console.error("[monthlyReset]", e));
  });
  console.log("[monthlyReset] scheduled for 1st of each month, 00:00");
}
