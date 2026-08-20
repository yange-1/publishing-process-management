import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const dbPath =
  process.env.DATABASE_PATH ||
  path.join(projectRoot, "data", "publishing-process.db");
const schemaPath = path.join(projectRoot, "lib", "schema.sql");

// 1. 创建 data 目录（如不存在）
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// 2. 打开连接并开启必要 pragma
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// 3. 执行初始化（幂等：IF NOT EXISTS）
const schema = fs.readFileSync(schemaPath, "utf-8");
db.exec(schema);

// 4. 汇总结果
const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all()
  .map((row) => row.name);

db.close();

console.log("数据库初始化完成：" + dbPath);
console.log("业务表：" + tables.join(", "));
