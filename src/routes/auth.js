import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { hashPassword, verifyPassword, verifyDummy, signToken } from "../auth.js";
import { requireAuth } from "../middleware/auth.js";
import { loginRateLimit, recordFailedAttempt, clearAttempts, registerRateLimit } from "../middleware/rateLimit.js";
import { verifyTurnstile } from "../turnstile.js";

export const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.COOKIE_SECURE === "true",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, display_name: u.display_name };
}

router.get("/config", (req, res) => {
  res.json({
    captchaSiteKey: process.env.TURNSTILE_SITE_KEY || null,
    inviteRequired: Boolean(process.env.REGISTRATION_INVITE_CODE),
  });
});

router.post("/register", registerRateLimit, async (req, res) => {
  let { username, password, inviteCode, turnstileToken } = req.body || {};

  const requiredCode = process.env.REGISTRATION_INVITE_CODE;
  if (requiredCode && inviteCode !== requiredCode) {
    return res.status(403).json({ error: "Неверный код приглашения" });
  }

  if (process.env.TURNSTILE_SECRET_KEY) {
    const captchaOk = await verifyTurnstile(turnstileToken, req.ip);
    if (!captchaOk) {
      return res.status(403).json({ error: "Не пройдена проверка на робота, попробуйте ещё раз" });
    }
  }

  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return res.status(400).json({ error: "Логин и пароль обязательны" });
  }
  username = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
    return res.status(400).json({
      error: "Логин: латинские буквы, цифры, точка, дефис, от 2 до 32 символов",
    });
  }
  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: "Пароль: от 6 до 128 символов" });
  }

  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(400).json({ error: "Такой логин уже занят" });

  const user = {
    id: randomUUID(),
    username,
    password_hash: hashPassword(password),
    role: "client",
    display_name: username,
  };
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, display_name) VALUES (@id, @username, @password_hash, @role, @display_name)"
  ).run(user);

  const token = signToken(user);
  res.cookie("token", token, COOKIE_OPTS);
  res.status(201).json({ user: publicUser(user) });
});

router.post("/login", loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string" || !username || !password || password.length > 256) {
    return res.status(400).json({ error: "Логин и пароль обязательны" });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username.trim().toLowerCase());
  if (!user) verifyDummy(password);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailedAttempt(req);
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }

  clearAttempts(req);
  const token = signToken(user);
  res.cookie("token", token, COOKIE_OPTS);
  res.json({ user: publicUser(user) });
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", COOKIE_OPTS);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post("/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "Заполните оба поля" });
  }
  if (newPassword.length < 6 || newPassword.length > 128) {
    return res.status(400).json({ error: "Новый пароль: от 6 до 128 символов" });
  }
  if (!verifyPassword(currentPassword, req.user.password_hash)) {
    return res.status(401).json({ error: "Текущий пароль неверный" });
  }

  const newHash = hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, req.user.id);
  // Остальные сессии этого пользователя закрываются, а текущая получает новый токен
  res.cookie("token", signToken({ ...req.user, password_hash: newHash }), COOKIE_OPTS);
  res.json({ ok: true });
});
