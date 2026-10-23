import { verifyToken, passwordStamp } from "../auth.js";
import { db } from "../db.js";

export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Не авторизован" });

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);
  if (!user) return res.status(401).json({ error: "Пользователь не найден" });

  if (payload.pv !== passwordStamp(user)) {
    return res.status(401).json({ error: "Сессия устарела, войдите заново" });
  }

  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Только для администратора" });
  }
  next();
}
