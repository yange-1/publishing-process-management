import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ===== 数据库在线备份脚本 =====
// 使用 better-sqlite3 的 db.backup() 在线备份 API，产生与源库一致的安全快照（兼容 WAL 模式）。
// 只读打开源库，不修改正式数据库任何业务数据；备份完成后对备份库做完整性校验与行数比对。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const DB_PATH =
  process.env.DATABASE_PATH || path.join(projectRoot, "data", "publishing-process.db");
const BACKUP_DIR =
  process.env.BACKUP_DIR || path.join(projectRoot, "data", "backups");

const TABLES = ["companies", "users", "books", "tasks", "task_events", "audit_log", "deliveries", "delivery_receipts"];

function tableExists(db, name) {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) != null
  );
}

function counts(db) {
  const r = {};
  for (const t of TABLES) {
    r[t] = tableExists(db, t)
      ? db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c
      : null; // 表尚不存在（如未迁移 deliveries）时记 null
  }
  return r;
}

function integrityLabel(pragmaResult) {
  return pragmaResult?.[0]?.integrity_check ?? "unknown";
}

function quickLabel(pragmaResult) {
  return pragmaResult?.[0]?.quick_check ?? "unknown";
}

// 本地时间戳：YYYYMMDD-HHMMSS
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// 生成不与现有文件冲突的备份路径（同一秒内重复执行不覆盖已有备份）。
function resolveBackupPath(dir) {
  const base = `publishing-process-${timestamp()}.db`;
  let candidate = path.join(dir, base);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `publishing-process-${timestamp()}-${n}.db`);
    n += 1;
  }
  return candidate;
}

function fail(msg) {
  console.error(`错误：${msg}`);
  process.exit(1);
}

// 1. 正式数据库存在性
if (!fs.existsSync(DB_PATH)) {
  fail(`正式数据库不存在：${DB_PATH}`);
}

const backupPath = resolveBackupPath(BACKUP_DIR);

// 2. 禁止备份目标与正式数据库为同一路径
if (path.resolve(backupPath) === path.resolve(DB_PATH)) {
  fail("备份目标与正式数据库为同一路径，已拒绝执行");
}

// 3. 自动创建备份目录
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// 4. 备份前只读读取正式库六表行数
let sourceCounts;
{
  const src = new Database(DB_PATH, { readonly: true });
  try {
    sourceCounts = counts(src);
  } finally {
    src.close();
  }
}

// 5. 在线备份（只读源库，兼容 WAL，不修改正式数据）
try {
  const src = new Database(DB_PATH, { readonly: true });
  try {
    await src.backup(backupPath);
  } finally {
    src.close();
  }
} catch (e) {
  fail(`备份过程失败：${e instanceof Error ? e.message : String(e)}`);
}

// 6. 只读打开备份库，执行完整性检查与六表行数统计
let backupIntegrity;
let backupQuick;
let backupCounts;
{
  const bk = new Database(backupPath, { readonly: true });
  try {
    backupIntegrity = bk.pragma("integrity_check");
    backupQuick = bk.pragma("quick_check");
    backupCounts = counts(bk);
  } finally {
    bk.close();
  }
}

// 7. 输出结果（不输出密码、哈希或任何敏感值）
const size = fs.statSync(backupPath).size;
console.log(`备份文件：${backupPath}`);
console.log(`备份文件大小：${size} 字节`);
console.log(`integrity_check：${integrityLabel(backupIntegrity)}`);
console.log(`quick_check：${quickLabel(backupQuick)}`);
console.log("业务表行数（正式库 → 备份库）：");
let allMatch = true;
for (const t of TABLES) {
  const s = sourceCounts[t];
  const b = backupCounts[t];
  if (s == null && b == null) {
    console.log(`  ${t}: 表不存在（未迁移），跳过`);
    continue;
  }
  const match = s === b;
  if (!match) allMatch = false;
  console.log(`  ${t}: ${s} → ${b}${match ? "" : "  (不一致)"}`);
}

const integrityOk = integrityLabel(backupIntegrity) === "ok";
const quickOk = quickLabel(backupQuick) === "ok";

if (!integrityOk || !quickOk || !allMatch) {
  console.error("备份校验未通过（完整性异常或业务表行数不一致）");
  process.exit(1);
}

console.log("备份成功：完整性与业务表行数全部一致");
