import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { getProtocol, DEFAULT_PROTOCOL } from "./protocols/index.js";

export const AWG_VERSIONS = ["2", "3.1"];
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;
const RANGE = /^\d+(-\d+)?$/;

export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function parseExtra(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function withParsedExtra(row) {
  return { ...row, extraParams: parseExtra(row.extra_params) };
}

// Приводит версию и доп. параметры к единому виду и проверяет ограничения протокола.
// body — то, что пришло в запросе, existing — текущая строка сервера (для PATCH).
export function resolveAwg(body, existing = {}) {
  const version = String(body.awgVersion ?? existing.awg_version ?? "2");
  if (!AWG_VERSIONS.includes(version)) {
    throw badRequest(`Версия AmneziaWG должна быть одной из: ${AWG_VERSIONS.join(", ")}`);
  }
  if (version === "2") return { version, extra: null };

  const input = body.extraParams ?? parseExtra(existing.extra_params) ?? {};
  const extra = {
    headerProtectionKey: input.headerProtectionKey,
    contentPaddingAddition: input.contentPaddingAddition ?? "0-64",
    randomTrailers: input.randomTrailers ?? "on",
    disableCookies: input.disableCookies ?? "off",
  };

  if (!BASE64_KEY.test(String(extra.headerProtectionKey || ""))) {
    throw badRequest("Для AWG 3.1 нужен HeaderProtectionKey: 32 байта в base64 (44 символа)");
  }
  if (!RANGE.test(String(extra.contentPaddingAddition))) {
    throw badRequest("ContentPaddingAddition должен быть числом или диапазоном вида 0-64");
  }
  for (const flag of ["randomTrailers", "disableCookies"]) {
    if (!["on", "off"].includes(extra[flag])) {
      throw badRequest(`${flag} должен быть on или off`);
    }
  }
  for (const key of ["s1", "s2", "s3", "s4"]) {
    const value = Number(body[key] ?? existing[key]);
    if (!Number.isInteger(value) || value < 12) {
      throw badRequest(`При защите заголовков AWG 3.1 параметр ${key.toUpperCase()} должен быть не меньше 12`);
    }
  }
  return { version, extra };
}

export const REQUIRED_FIELDS = [
  "name", "endpoint", "container", "configPath", "publicKey", "presharedKey",
  "jc", "jmin", "jmax", "s1", "s2", "s3", "s4", "h1", "h2", "h3", "h4",
  "subnetPrefix",
];


// Создаёт запись о сервере из тела запроса (camelCase). Бросает ошибку со статусом 400
// при неполных или неверных данных. Возвращает id нового сервера.
export function createServerRecord(body) {
  const protocol = getProtocol(body.protocol ?? DEFAULT_PROTOCOL).id;
  const isAwg = protocol === "awg";
  const required = isAwg ? REQUIRED_FIELDS : ["name", "endpoint", "container", "configPath", "publicKey"];
  const missing = required.filter((f) => !body[f]);
  if (missing.length) {
    throw badRequest(`Не заполнены поля: ${missing.join(", ")}`);
  }

  // Протоколы без AWG-параметров: храним только свои данные в extra_params
  const awg = isAwg ? resolveAwg(body) : { version: "2", extra: body.extraParams || null };
  const id = randomUUID();
  db.prepare(
    `INSERT INTO servers
     (id, name, endpoint, container, config_path, interface, public_key, preshared_key,
      jc, jmin, jmax, s1, s2, s3, s4, h1, h2, h3, h4, subnet_prefix, address_start, client_dns,
      ssh_host, ssh_user, ssh_key_path, awg_version, extra_params, protocol)
     VALUES (@id, @name, @endpoint, @container, @config_path, @interface, @public_key, @preshared_key,
      @jc, @jmin, @jmax, @s1, @s2, @s3, @s4, @h1, @h2, @h3, @h4, @subnet_prefix, @address_start, @client_dns,
      @ssh_host, @ssh_user, @ssh_key_path, @awg_version, @extra_params, @protocol)`
  ).run({
    id,
    name: body.name,
    endpoint: body.endpoint,
    container: body.container,
    config_path: body.configPath,
    interface: body.interface || (isAwg ? "awg0" : "-"),
    public_key: body.publicKey,
    preshared_key: body.presharedKey || "-",
    jc: body.jc,
    jmin: body.jmin,
    jmax: body.jmax,
    s1: body.s1,
    s2: body.s2,
    s3: body.s3,
    s4: body.s4,
    h1: body.h1,
    h2: body.h2,
    h3: body.h3,
    h4: body.h4,
    subnet_prefix: body.subnetPrefix || "-",
    address_start: Number(body.addressStart || 2),
    client_dns: body.clientDns || "1.1.1.1",
    ssh_host: body.sshHost || null,
    ssh_user: body.sshUser || "root",
    ssh_key_path: body.sshKeyPath || null,
    awg_version: awg.version,
    extra_params: awg.extra ? JSON.stringify(awg.extra) : null,
    protocol,
  });
  return id;
}
