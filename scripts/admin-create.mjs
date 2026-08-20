import readline from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createInitialAdmin } from "../lib/admin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dbPath =
  process.env.DATABASE_PATH ||
  path.join(projectRoot, "data", "publishing-process.db");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q) => (await rl.question(q)).trim();

try {
  const username = await ask("登录账号：");
  const displayName = await ask("显示姓名：");
  const companyName = await ask("社内部门或公司名称：");
  const confirm = await ask(
    `确认创建管理员「${displayName}」(${username})，所属「${companyName}」？(y/N) `,
  );
  rl.close();

  if (confirm.toLowerCase() !== "y") {
    console.log("已取消");
    process.exit(0);
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  const result = createInitialAdmin(db, { username, displayName, companyName });
  db.close();

  if (!result.ok) {
    console.log("已存在 INTERNAL_ADMIN，拒绝重复创建");
  } else {
    console.log("管理员账号已创建，统一初始密码为123456，请首次登录后立即修改。");
  }
} catch (e) {
  rl.close();
  console.error("创建失败：" + (e && e.message ? e.message : e));
  process.exit(1);
}
