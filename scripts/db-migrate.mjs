import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const dbPath =
  process.env.DATABASE_PATH ||
  path.join(projectRoot, "data", "publishing-process.db");

// 各表的增量字段迁移（幂等：已存在则跳过）
const MIGRATIONS = [
  {
    table: "users",
    columns: [
      { name: "password_hash", definition: "TEXT" },
      { name: "must_change_password", definition: "INTEGER NOT NULL DEFAULT 0" },
      { name: "failed_login_count", definition: "INTEGER NOT NULL DEFAULT 0" },
      { name: "locked_until", definition: "TEXT" },
      { name: "last_login_at", definition: "TEXT" },
      { name: "session_version", definition: "INTEGER NOT NULL DEFAULT 0" },
    ],
  },
  {
    table: "tasks",
    columns: [
      { name: "company_id", definition: "INTEGER REFERENCES companies(id)" },
      { name: "work_type", definition: "TEXT NOT NULL DEFAULT 'PROOFREAD'" },
      { name: "work_word_count", definition: "INTEGER" },
      { name: "external_confirmed_word_count", definition: "INTEGER" },
    ],
  },
];

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

function tableExists(name) {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !=
    null
  );
}

let added = 0;
for (const m of MIGRATIONS) {
  if (!tableExists(m.table)) continue;
  const existing = new Set(
    db.prepare(`PRAGMA table_info(${m.table})`).all().map((c) => c.name),
  );
  for (const col of m.columns) {
    if (existing.has(col.name)) continue;
    db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${col.name} ${col.definition}`);
    added += 1;
  }
}

const usersFinal = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
const tasksFinal = db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name);
db.close();

console.log(`迁移完成：新增 ${added} 个字段（幂等，重复执行无副作用）`);
console.log("users 字段：" + usersFinal.join(", "));
console.log("tasks 字段：" + tasksFinal.join(", "));
