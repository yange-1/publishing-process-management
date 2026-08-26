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

// 新增表（幂等 IF NOT EXISTS）：deliveries 送达记录（配送版块）。
// 只追加、task_id 唯一防重复送达，不改变 tasks.status，不重建任何旧表。
const NEW_TABLES = `
CREATE TABLE IF NOT EXISTS deliveries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL UNIQUE REFERENCES tasks(id),
  delivered_by  INTEGER NOT NULL REFERENCES users(id),
  is_proxy      INTEGER NOT NULL DEFAULT 0 CHECK (is_proxy IN (0, 1)),
  proxy_role    TEXT,
  proxy_reason  TEXT,
  delivered_at  TEXT NOT NULL,
  occurred_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_deliveries_delivered_at ON deliveries(delivered_at);
CREATE TRIGGER IF NOT EXISTS trg_deliveries_require_delivered_by
BEFORE INSERT ON deliveries
WHEN NEW.delivered_by IS NULL
BEGIN
  SELECT RAISE(ABORT, 'deliveries.delivered_by 不能为空');
END;
CREATE TRIGGER IF NOT EXISTS trg_deliveries_no_update
BEFORE UPDATE ON deliveries
BEGIN
  SELECT RAISE(ABORT, 'deliveries is append-only');
END;
CREATE TRIGGER IF NOT EXISTS trg_deliveries_no_delete
BEFORE DELETE ON deliveries
BEGIN
  SELECT RAISE(ABORT, 'deliveries is append-only');
END;
CREATE TABLE IF NOT EXISTS delivery_receipts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id   INTEGER NOT NULL UNIQUE REFERENCES deliveries(id),
  confirmed_by  INTEGER NOT NULL REFERENCES users(id),
  confirmed_at  TEXT NOT NULL,
  occurred_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_delivery_receipts_confirmed_at ON delivery_receipts(confirmed_at);
CREATE TRIGGER IF NOT EXISTS trg_delivery_receipts_no_update
BEFORE UPDATE ON delivery_receipts
BEGIN
  SELECT RAISE(ABORT, 'delivery_receipts is append-only');
END;
CREATE TRIGGER IF NOT EXISTS trg_delivery_receipts_no_delete
BEFORE DELETE ON delivery_receipts
BEGIN
  SELECT RAISE(ABORT, 'delivery_receipts is append-only');
END;
`;
db.exec(NEW_TABLES);

const deliveriesCreated = tableExists("deliveries");

const usersFinal = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
const tasksFinal = db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name);
db.close();

console.log(`迁移完成：新增 ${added} 个字段（幂等，重复执行无副作用）`);
console.log("users 字段：" + usersFinal.join(", "));
console.log("tasks 字段：" + tasksFinal.join(", "));
console.log("deliveries 表：" + (deliveriesCreated ? "已创建/已存在" : "未创建"));
