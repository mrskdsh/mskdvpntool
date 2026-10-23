import { randomUUID } from "node:crypto";
const { db } = await import(process.env.ROOT + "/src/db.js");
const { hashPassword } = await import(process.env.ROOT + "/src/auth.js");
db.prepare("INSERT INTO users (id,username,password_hash,role,display_name) VALUES (?,?,?,?,?)").run(randomUUID(),"adm",hashPassword("testpass123"),"admin","adm");
