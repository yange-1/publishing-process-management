import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const dbPath =
  process.env.DATABASE_PATH ||
  path.join(projectRoot, "data", "publishing-process.db");

// 认证相关字段（幂等迁移：已存在则跳过）
const AUTH_COLUMNS = [
  { name: "password_hash", definition: "TEXT" },
  { name: "must_change_password", definition: "INTEGER NOT NULL DEFAULT 0" },
  { name: "failed_login_count", definition: "INTEGER NOT NULL DEFAULT 0" },
  { name: "locked_until", definition: "TEXT" },
  { name: "last_login_at", definition: "TEXT" },
  { name: "session_version", definition: "INTEGER NOT NULL DEFAULT 0" },
];

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const existing = new Set(
  db.prepare("PRAGMA table_info(users)").all().map((c) => c.name),
);

let added = 0;
for (const col of AUTH_COLUMNS) {
  if (existing.has(col.name)) continue;
  db.exec(`ALTER TABLE users ADD COLUMN ${col.name} ${col.definition}`);
  added += 1;
}

const final = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
db.close();

console.log(`迁移完成：新增 ${added} 个字段（幂等，重复执行无副作用）`);
console.log("users 字段：" + final.join(", "));
