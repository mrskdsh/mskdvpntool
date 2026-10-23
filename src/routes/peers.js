import { Router } from "express";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { db } from "../db.js";
import { protocolOf } from "../protocols/index.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export const router = Router();

function h(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`[peers] ${req.method} ${req.path} failed:`, e.message);
      res.status(e.status || 500).json({ error: e.message || "Внутренняя ошибка сервера" });
    }
  };
}

function getServer(serverId) {
  const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(serverId);
  if (!server) throw new Error("Сервер не найден");
  return server;
}

function resolveServerId(explicitId) {
  if (explicitId) return explicitId;
  const servers = db.prepare("SELECT id FROM servers").all();
  if (servers.length === 1) return servers[0].id;
  if (servers.length === 0) throw new Error("Нет ни одного добавленного сервера");
  throw new Error("Серверов несколько — укажите serverId явно");
}

async function withStats(peers) {
  const byServer = new Map();
  for (const p of peers) {
    if (!byServer.has(p.server_id)) byServer.set(p.server_id, []);
    byServer.get(p.server_id).push(p);
  }

  const statsByKey = {};
  const versionByServer = {};
  const protocolByServer = {};
  for (const serverId of byServer.keys()) {
    try {
      const server = getServer(serverId);
      versionByServer[serverId] = server.awg_version || "2";
      protocolByServer[serverId] = server.protocol || "awg";
      const stats = await protocolOf(server).getClientStats(server);
      for (const s of stats) statsByKey[s.publicKey] = s;
    } catch (e) {
      console.error(`[peers] failed to read stats for server ${serverId}:`, e.message);
    }
  }

  return peers.map((p) => {
    const live = statsByKey[p.public_key];
    const rx = live?.rxBytes ?? 0;
    const tx = live?.txBytes ?? 0;
    const usedBytes = Math.max(0, rx - p.base_rx) + Math.max(0, tx - p.base_tx);
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      address: p.address,
      limitGB: p.limit_gb,
      blocked: Boolean(p.blocked),
      hasKeys: Boolean(p.private_key),
      ownerId: p.owner_id,
      serverId: p.server_id,
      awgVersion: versionByServer[p.server_id] || "2",
      protocol: protocolByServer[p.server_id] || "awg",
      createdAt: p.created_at,
      usedBytes,
      usedGB: +(usedBytes / 1024 / 1024 / 1024).toFixed(2),
      lastHandshake: live?.lastHandshake ?? null,
      online: live ? Date.now() / 1000 - live.lastHandshake < 180 : false,
    };
  });
}

function nextAddress(server) {
  const used = db
    .prepare("SELECT address FROM peers WHERE server_id = ?")
    .all(server.id)
    .map((r) => r.address);
  return protocolOf(server).nextAddress(server, used);
}

async function syncFromDb(serverId) {
  const server = getServer(serverId);
  const peers = db.prepare("SELECT * FROM peers WHERE server_id = ?").all(serverId);
  await protocolOf(server).syncClients(
    peers.map((p) => ({
      publicKey: p.public_key,
      presharedKey: p.preshared_key,
      address: p.address,
      blocked: Boolean(p.blocked),
    })),
    server
  );
}

function requirePeerWithKeys(peer) {
  if (!peer.private_key) {
    throw Object.assign(new Error("Для этого доступа нет сохранённого ключа"), { status: 409 });
  }
  return {
    peerArg: {
      privateKey: peer.private_key,
      presharedKey: peer.preshared_key,
      publicKey: peer.public_key,
      address: peer.address,
      name: peer.name,
    },
    server: getServer(peer.server_id),
  };
}

router.get(
  "/",
  requireAuth,
  h(async (req, res) => {
    let rows;
    if (req.user.role === "admin") {
      rows = req.query.serverId
        ? db.prepare("SELECT * FROM peers WHERE server_id = ?").all(req.query.serverId)
        : db.prepare("SELECT * FROM peers").all();
    } else {
      rows = db.prepare("SELECT * FROM peers WHERE owner_id = ?").all(req.user.id);
    }
    res.json(await withStats(rows));
  })
);

router.post(
  "/",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const { name, email, limitGB, ownerId, serverId: bodyServerId } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Имя обязательно" });
    }

    const serverId = resolveServerId(bodyServerId);
    const server = getServer(serverId);

    const { privateKey, publicKey } = await protocolOf(server).generateClient(server);
    const presharedKey = server.preshared_key;
    const address = nextAddress(server);
    const id = randomUUID();

    db.prepare(
      `INSERT INTO peers (id, name, email, public_key, private_key, preshared_key, address, limit_gb, owner_id, server_id)
       VALUES (@id, @name, @email, @publicKey, @privateKey, @presharedKey, @address, @limitGB, @ownerId, @serverId)`
    ).run({
      id,
      name: name.trim(),
      email: email || null,
      publicKey,
      privateKey,
      presharedKey,
      address,
      limitGB: limitGB ?? null,
      ownerId: ownerId || null,
      serverId,
    });

    await syncFromDb(serverId);
    res.status(201).json({ id, name: name.trim(), address, serverId });
  })
);

router.get(
  "/:id",
  requireAuth,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });
    if (req.user.role !== "admin" && peer.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const [result] = await withStats([peer]);
    res.json(result);
  })
);

router.get(
  "/:id/config",
  requireAuth,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });
    if (req.user.role !== "admin" && peer.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const { peerArg, server } = requirePeerWithKeys(peer);
    res.json({ config: protocolOf(server).buildClientConfig(peerArg, server) });
  })
);

router.get(
  "/:id/qr",
  requireAuth,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });
    if (req.user.role !== "admin" && peer.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const { peerArg, server } = requirePeerWithKeys(peer);
    const config = protocolOf(server).buildClientConfig(peerArg, server);
    const dataUrl = await QRCode.toDataURL(config, { margin: 1, width: 320 });
    res.json({ qr: dataUrl });
  })
);

router.get(
  "/:id/vpn-link",
  requireAuth,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });
    if (req.user.role !== "admin" && peer.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const { peerArg, server } = requirePeerWithKeys(peer);
    res.json({ link: protocolOf(server).buildAppLink(peerArg, server) });
  })
);

router.get(
  "/:id/vpn-link/qr",
  requireAuth,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });
    if (req.user.role !== "admin" && peer.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    const { peerArg, server } = requirePeerWithKeys(peer);
    const link = protocolOf(server).buildAppLink(peerArg, server);
    const dataUrl = await QRCode.toDataURL(link, { margin: 1, width: 320 });
    res.json({ qr: dataUrl });
  })
);

router.patch(
  "/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const { limitGB, blocked, name, email, ownerId } = req.body;
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });

    const patch = {
      limit_gb: limitGB !== undefined ? limitGB : peer.limit_gb,
      blocked: blocked !== undefined ? (blocked ? 1 : 0) : peer.blocked,
      name: name !== undefined ? name : peer.name,
      email: email !== undefined ? email : peer.email,
      owner_id: ownerId !== undefined ? ownerId : peer.owner_id,
    };

    db.prepare(
      "UPDATE peers SET limit_gb=@limit_gb, blocked=@blocked, name=@name, email=@email, owner_id=@owner_id WHERE id=@id"
    ).run({ ...patch, id: peer.id });

    if (blocked !== undefined) await syncFromDb(peer.server_id);

    res.json(db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id));
  })
);

router.post(
  "/:id/reset-usage",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });

    const server = getServer(peer.server_id);
    const stats = await protocolOf(server).getClientStats(server);
    const live = stats.find((s) => s.publicKey === peer.public_key);
    db.prepare("UPDATE peers SET base_rx=?, base_tx=? WHERE id=?").run(
      live?.rxBytes ?? 0,
      live?.txBytes ?? 0,
      peer.id
    );
    res.json({ ok: true });
  })
);

router.post(
  "/resync",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const serverId = resolveServerId(req.body?.serverId);
    await syncFromDb(serverId);
    res.json({ ok: true });
  })
);

router.post(
  "/migrate",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const { peerIds, targetServerId, mode } = req.body || {};
    if (
      !Array.isArray(peerIds) ||
      peerIds.length === 0 ||
      peerIds.length > 200 ||
      !peerIds.every((id) => typeof id === "string")
    ) {
      return res.status(400).json({ error: "Выберите от 1 до 200 доступов" });
    }
    if (mode !== "copy" && mode !== "move") {
      return res.status(400).json({ error: "Режим должен быть copy или move" });
    }
    const target = db.prepare("SELECT * FROM servers WHERE id = ?").get(targetServerId);
    if (!target) return res.status(404).json({ error: "Целевой сервер не найден" });

    const getPeer = db.prepare("SELECT * FROM peers WHERE id = ?");
    const found = [...new Set(peerIds)].map((id) => getPeer.get(id)).filter(Boolean);
    const protocolOfPeer = (p) => db.prepare("SELECT protocol FROM servers WHERE id = ?").get(p.server_id)?.protocol || "awg";
    const targetProtocol = target.protocol || "awg";
    if (found.some((p) => p.server_id !== target.id && protocolOfPeer(p) !== targetProtocol)) {
      return res.status(400).json({ error: "Переносить доступы можно только между серверами с одинаковым протоколом" });
    }
    const toMigrate = found.filter((p) => p.server_id !== target.id);
    const skipped = peerIds.length - toMigrate.length;

    if (toMigrate.length === 0) {
      return res.json({ created: [], failed: [], skipped, mode, warning: null });
    }

    const planned = [];
    const failed = [];
    for (const src of toMigrate) {
      try {
        const { privateKey, publicKey } = await protocolOf(target).generateClient(target);
        planned.push({ src, privateKey, publicKey });
      } catch (e) {
        failed.push({ id: src.id, name: src.name, error: e.message });
      }
    }

    if (planned.length === 0) {
      return res.json({ created: [], failed, skipped, mode, warning: null });
    }

    const insert = db.prepare(
      `INSERT INTO peers (id, name, email, public_key, private_key, preshared_key, address, limit_gb, blocked, owner_id, server_id)
       VALUES (@id, @name, @email, @publicKey, @privateKey, @presharedKey, @address, @limitGB, @blocked, @ownerId, @serverId)`
    );
    const created = db.transaction(() =>
      planned.map(({ src, privateKey, publicKey }) => {
        const row = {
          id: randomUUID(),
          name: src.name,
          email: src.email,
          publicKey,
          privateKey,
          presharedKey: target.preshared_key,
          address: nextAddress(target),
          limitGB: src.limit_gb,
          blocked: src.blocked,
          ownerId: src.owner_id,
          serverId: target.id,
        };
        insert.run(row);
        return { ...row, fromId: src.id, fromServerId: src.server_id };
      })
    )();

    try {
      await syncFromDb(target.id);
    } catch (e) {
      const del = db.prepare("DELETE FROM peers WHERE id = ?");
      db.transaction(() => created.forEach((r) => del.run(r.id)))();
      await syncFromDb(target.id).catch(() => {});
      throw new Error(`Не удалось применить изменения на сервере «${target.name}»: ${e.message}`);
    }

    let warning = null;
    if (mode === "move") {
      const del = db.prepare("DELETE FROM peers WHERE id = ?");
      db.transaction(() => created.forEach((r) => del.run(r.fromId)))();
      for (const serverId of new Set(created.map((r) => r.fromServerId))) {
        try {
          await syncFromDb(serverId);
        } catch (e) {
          warning = `Старые доступы удалены из панели, но на прежнем сервере они могут остаться до следующей синхронизации: ${e.message}`;
        }
      }
    }

    res.json({
      created: created.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        serverId: r.serverId,
        fromId: r.fromId,
      })),
      failed,
      skipped,
      mode,
      warning,
    });
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const peer = db.prepare("SELECT * FROM peers WHERE id = ?").get(req.params.id);
    if (!peer) return res.status(404).json({ error: "Не найден" });

    db.prepare("DELETE FROM peers WHERE id = ?").run(req.params.id);
    await syncFromDb(peer.server_id);

    res.json({ ok: true });
  })
);
