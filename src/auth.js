import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16 || JWT_SECRET === "change_me") {
  console.error("[auth] JWT_SECRET не задан или слишком короткий (нужно не меньше 16 символов). Сгенерируйте: openssl rand -hex 32");
  process.exit(1);
}
const TOKEN_TTL = "30d";

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

// Отпечаток пароля в токене: после смены пароля все прежние сессии перестают работать
export function passwordStamp(user) {
  return createHash("sha256").update(String(user.password_hash)).digest("hex").slice(0, 16);
}

// Заглушка для проверки пароля несуществующего пользователя (чтобы по времени ответа нельзя было угадать логин)
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);
export function verifyDummy(password) {
  bcrypt.compareSync(String(password), DUMMY_HASH);
}

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, pv: passwordStamp(user) }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
