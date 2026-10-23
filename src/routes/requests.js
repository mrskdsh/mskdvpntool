import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { hashPassword } from "../auth.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { notifyAdmin } from "../telegram.js";

export const router = Router();

function h(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`[requests] ${req.method} ${req.path} failed:`, e.message);
      res.status(500).json({ error: e.message || "Внутренняя ошибка сервера" });
    }
  };
}

router.get(
  "/connection-requests",
  requireAuth,
  h(async (req, res) => {
    const rows =
      req.user.role === "admin"
        ? db.prepare("SELECT * FROM connection_requests ORDER BY created_at DESC").all()
        : db
            .prepare("SELECT * FROM connection_requests WHERE user_id = ? ORDER BY created_at DESC")
            .all(req.user.id);
    res.json(rows);
  })
);

router.post(
  "/connection-requests",
  requireAuth,
  h(async (req, res) => {
    const { comment, fullName, contact } = req.body || {};

    if (typeof fullName !== "string" || typeof contact !== "string" || (comment != null && typeof comment !== "string")) {
      return res.status(400).json({ error: "Некорректные данные заявки" });
    }
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: "Укажите имя и фамилию" });
    }
    if (!contact || !contact.trim()) {
      return res.status(400).json({ error: "Укажите контакт для связи" });
    }

    if (fullName.length > 120 || contact.length > 120 || (comment && String(comment).length > 1000)) {
      return res.status(400).json({ error: "Слишком длинный текст (имя и контакт до 120 символов, комментарий до 1000)" });
    }
    const recent = db
      .prepare("SELECT COUNT(*) AS c FROM connection_requests WHERE user_id = ? AND created_at > datetime('now', '-1 day')")
      .get(req.user.id).c;
    if (recent >= 5) {
      return res.status(429).json({ error: "Слишком много заявок за сутки, подождите ответа администратора" });
    }

    const id = randomUUID();
    const name = req.user.display_name || req.user.username;
    db.prepare(
      "INSERT INTO connection_requests (id, user_id, name, full_name, contact, comment) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, req.user.id, name, fullName.trim(), contact.trim(), comment || null);

    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    notifyAdmin(
      `🔌 <b>Новая заявка на подключение</b>\n\n` +
        `👤 <b>Имя:</b> ${esc(fullName.trim())}\n` +
        `📱 <b>Контакт:</b> ${esc(contact.trim())}\n` +
        `🔑 <b>Логин в панели:</b> ${esc(name)}` +
        (comment ? `\n💬 <b>Комментарий:</b> ${esc(comment)}` : "") +
        `\n\nЗайдите в панель, чтобы выдать доступ.`
    );
    res.status(201).json({ id });
  })
);

router.patch(
  "/connection-requests/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const { status } = req.body;
    db.prepare("UPDATE connection_requests SET status = ? WHERE id = ?").run(
      status,
      req.params.id
    );
    res.json({ ok: true });
  })
);

router.get(
  "/support-tickets",
  requireAuth,
  h(async (req, res) => {
    const rows =
      req.user.role === "admin"
        ? db.prepare("SELECT * FROM support_tickets ORDER BY created_at DESC").all()
        : db
            .prepare("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC")
            .all(req.user.id);
    res.json(rows);
  })
);

router.post(
  "/support-tickets",
  requireAuth,
  h(async (req, res) => {
    const { message } = req.body || {};
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Сообщение обязательно" });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: "Сообщение слишком длинное (до 2000 символов)" });
    }
    const recent = db
      .prepare("SELECT COUNT(*) AS c FROM support_tickets WHERE user_id = ? AND created_at > datetime('now', '-1 day')")
      .get(req.user.id).c;
    if (recent >= 10) {
      return res.status(429).json({ error: "Слишком много обращений за сутки, подождите ответа" });
    }
    const id = randomUUID();
    const name = req.user.display_name || req.user.username;
    db.prepare(
      "INSERT INTO support_tickets (id, user_id, name, message) VALUES (?, ?, ?, ?)"
    ).run(id, req.user.id, name, message.trim());

    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    notifyAdmin(
      `🆘 <b>Обращение в поддержку</b>\n\n👤 <b>От:</b> ${esc(name)}\n💬 ${esc(message.trim())}`
    );
    res.status(201).json({ id });
  })
);

router.patch(
  "/support-tickets/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const { response, status } = req.body;
    db.prepare("UPDATE support_tickets SET response = ?, status = ? WHERE id = ?").run(
      response || null,
      status || "resolved",
      req.params.id
    );
    res.json({ ok: true });
  })
);

router.get(
  "/users",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const rows = db
      .prepare("SELECT id, username, role, display_name, created_at FROM users ORDER BY created_at DESC")
      .all();
    res.json(rows);
  })
);

router.delete(
  "/users/:id",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "Нельзя удалить свой же аккаунт" });
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  })
);

router.post(
  "/users/:id/reset-password",
  requireAuth,
  requireAdmin,
  h(async (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Пароль должен быть не короче 6 символов" });
    }
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "Не найден" });

    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(newPassword),
      req.params.id
    );
    res.json({ ok: true });
  })
);
