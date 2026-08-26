import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ===== 备份恢复验证脚本 =====
// 将指定备份恢复到系统临时目录中的独立临时数据库，只读校验其完整性与行数，
// 并与原备份库比对六表行数。全程不覆盖、不替换、不重命名、不删除正式数据库。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const FORMAL_DB =
  process.env.DATABASE_PATH || path.join(projectRoot, "data", "publishing-process.db");

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

function fail(msg) {
  console.error(`错误：${msg}`);
  process.exit(1);
}

// 1. 必须显式接收备份文件路径
const backupArg = process.argv[2];
if (!backupArg) {
  console.error("用法：npm run db:restore-check -- <备份文件路径>");
  process.exit(1);
}
const backupPath = path.resolve(backupArg);

// 2. 存在性检查 & 禁止操作正式数据库
if (!fs.existsSync(backupPath)) {
  fail(`备份文件不存在：${backupPath}`);
}
if (path.resolve(backupPath) === path.resolve(FORMAL_DB)) {
  fail("传入路径是正式数据库，禁止作为恢复验证对象");
}

// 3. 在系统临时目录创建独立临时文件夹
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "restore-check-"));

let tmpDbPath;
try {
  // 4. 将备份复制到临时目录中的临时数据库
  tmpDbPath = path.join(tmpDir, "restore.db");
  fs.copyFileSync(backupPath, tmpDbPath);

  // 5. 只读打开临时恢复库，执行完整性与行数统计
  let tmpIntegrity;
  let tmpQuick;
  let tmpCounts;
  {
    const db = new Database(tmpDbPath, { readonly: true });
    try {
      tmpIntegrity = db.pragma("integrity_check");
      tmpQuick = db.pragma("quick_check");
      tmpCounts = counts(db);
    } finally {
      db.close();
    }
  }

  // 6. 只读读取原备份库六表行数
  let backupCounts;
  {
    const db = new Database(backupPath, { readonly: true });
    try {
      backupCounts = counts(db);
    } finally {
      db.close();
    }
  }

  // 7. 输出结果与比对
  console.log(`原备份文件：${backupPath}`);
  console.log(`临时恢复库：${tmpDbPath}`);
  console.log(`integrity_check：${integrityLabel(tmpIntegrity)}`);
  console.log(`quick_check：${quickLabel(tmpQuick)}`);
  console.log("业务表行数（原备份库 → 临时恢复库）：");
  let allMatch = true;
  for (const t of TABLES) {
    const s = backupCounts[t];
    const b = tmpCounts[t];
    if (s == null && b == null) {
      console.log(`  ${t}: 表不存在（未迁移），跳过`);
      continue;
    }
    const match = s === b;
    if (!match) allMatch = false;
    console.log(`  ${t}: ${s} → ${b}${match ? "" : "  (不一致)"}`);
  }

  const integrityOk = integrityLabel(tmpIntegrity) === "ok";
  const quickOk = quickLabel(tmpQuick) === "ok";

  if (!integrityOk || !quickOk || !allMatch) {
    console.error("恢复验证未通过（完整性异常或业务表行数不一致）");
    process.exitCode = 1;
  } else {
    console.log("恢复验证通过：临时恢复库完整性与业务表行数全部一致");
  }
} finally {
  // 8. 只删除系统临时目录中的恢复副本，不删除原备份文件、不触碰正式数据库
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
