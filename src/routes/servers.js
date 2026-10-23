import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { getProvisionJob, startProvision } from "../provisionJobs.js";
import { listProtocols } from "../protocols/index.js";
import { createServerRecord, parseExtra, resolveAwg, withParsedExtra } from "../servers-core.js";

export const router = Router();

function h(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`[servers] ${req.method} ${req.path} failed:`, e.message);
      res.status(e.status || 500).json({ error: e.message || "Внутренняя ошибка сервера" });
    }
  };
}

router.get(
  "/",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const servers = db.prepare("SELECT * FROM servers ORDER BY created_at").all();
    const withCounts = servers.map((s) => ({
      ...withParsedExtra(s),
      peerCount: db.prepare("SELECT COUNT(*) as c FROM peers WHERE server_id = ?").get(s.id).c,
    }));
    res.json(withCounts);
  })
);

router.get(
  "/protocols",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    res.json(listProtocols());
  })
);

router.post(
  "/",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    if (req.body?.protocol && req.body.protocol !== "awg") {
      return res.status(400).json({ error: "Подключить готовый сервер можно только для AmneziaWG. Остальные протоколы панель устанавливает сама" });
    }
    const id = createServerRecord(req.body || {});

    res.status(201).json({ id });
  })
);

// Создание нового сервера прямо из панели: запускает фоновое развёртывание
router.post(
  "/provision",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    // Пароль от сервера можно принимать только по HTTPS или через туннель на localhost
    const remote = String(req.socket?.remoteAddress || "");
    const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    const secureTransport = req.secure || (loopback && !req.headers["x-forwarded-for"]);
    res.status(202).json(startProvision(req.body, { secureTransport }));
  })
);

router.get(
  "/provision/:jobId",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const job = getProvisionJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Задание не найдено (возможно, панель перезапускалась)" });
    res.json(job);
  })
);

router.patch(
  "/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(req.params.id);
    if (!server) return res.status(404).json({ error: "Не найден" });

    const fieldMap = {
      name: "name", endpoint: "endpoint", container: "container",
      configPath: "config_path", interface: "interface",
      publicKey: "public_key", presharedKey: "preshared_key",
      jc: "jc", jmin: "jmin", jmax: "jmax",
      s1: "s1", s2: "s2", s3: "s3", s4: "s4",
      h1: "h1", h2: "h2", h3: "h3", h4: "h4",
      subnetPrefix: "subnet_prefix", addressStart: "address_start",
      clientDns: "client_dns",
      sshHost: "ssh_host", sshUser: "ssh_user", sshKeyPath: "ssh_key_path",
    };

    const updates = {};
    for (const [bodyKey, col] of Object.entries(fieldMap)) {
      const v = req.body[bodyKey];
      if (v === undefined) continue;
      // Значения попадают в команды и конфиги: только короткие строки или числа, без переводов строк
      const okType = typeof v === "number" || (typeof v === "string" && v.length <= 512 && !/[\r\n\0]/.test(v));
      if (!okType) return res.status(400).json({ error: `Недопустимое значение поля ${bodyKey}` });
      updates[col] = v;
    }
    const touchesAwg = req.body.awgVersion !== undefined || req.body.extraParams !== undefined;
    if (touchesAwg && (server.protocol || "awg") !== "awg") {
      return res.status(400).json({ error: "Версия и параметры AmneziaWG есть только у серверов AmneziaWG" });
    }
    if (touchesAwg || server.awg_version === "3.1") {
      const merged = { ...server, ...updates };
      const awg = resolveAwg(req.body, merged);
      updates.awg_version = awg.version;
      updates.extra_params = awg.extra ? JSON.stringify(awg.extra) : null;
    }
    if (Object.keys(updates).length === 0) {
      return res.json(withParsedExtra(server));
    }

    const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(", ");
    db.prepare(`UPDATE servers SET ${setClause} WHERE id = @id`).run({ ...updates, id: server.id });

    res.json(withParsedExtra(db.prepare("SELECT * FROM servers WHERE id = ?").get(server.id)));
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const peerCount = db
      .prepare("SELECT COUNT(*) as c FROM peers WHERE server_id = ?")
      .get(req.params.id).c;
    if (peerCount > 0) {
      return res.status(400).json({
        error: `На сервере ещё ${peerCount} доступ(ов) — сначала перенесите или удалите их`,
      });
    }
    db.prepare("DELETE FROM servers WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  })
);
