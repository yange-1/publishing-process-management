import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  hashPassword,
  verifyPassword,
  DEFAULT_PASSWORD,
} from "../lib/password.ts";
import {
  authenticateUser,
  getSessionUser,
  validateNewPassword,
  changePassword,
} from "../lib/auth-service.ts";
import { createInitialAdmin } from "../lib/admin.mjs";

const SCHEMA = fs.readFileSync(
  path.join(process.cwd(), "lib", "schema.sql"),
  "utf-8",
);

const FORMAL_TABLES = ["companies", "users", "books", "tasks", "task_events", "audit_log"];
const FORMAL_PATH = path.join(process.cwd(), "data", "publishing-process.db");

function formalCounts(): Record<string, number> {
  const r: Record<string, number> = {};
  if (!fs.existsSync(FORMAL_PATH)) return r;
  const db = new Database(FORMAL_PATH, { readonly: true });
  for (const t of FORMAL_TABLES) {
    r[t] = (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
  }
  db.close();
  return r;
}

const FORMAL_BASELINE = formalCounts();

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  db.prepare("INSERT INTO companies(id, name, type) VALUES (1, '社内', 'INTERNAL'), (2, '外校A', 'EXTERNAL')").run();
  return db;
}

function seedUser(
  db: Database.Database,
  id: number,
  username: string,
  role: string,
  opts: {
    password?: string | null;
    mustChange?: number;
    isActive?: number;
    companyId?: number | null;
  } = {},
): void {
  db.prepare(
    "INSERT INTO users(id, username, display_name, company_id, role, password_hash, must_change_password, is_active) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    id,
    username,
    username,
    opts.companyId ?? 1,
    role,
    opts.password === undefined ? hashPassword(DEFAULT_PASSWORD) : opts.password === null ? null : hashPassword(opts.password),
    opts.mustChange ?? 0,
    opts.isActive ?? 1,
  );
}

function rows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
}

test("1. 默认密码哈希不等于明文123456", () => {
  const h = hashPassword(DEFAULT_PASSWORD);
  assert.notStrictEqual(h, DEFAULT_PASSWORD);
  assert.ok(h.startsWith("$2"));
});

test("2. 新账号可用123456首次认证", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR", { mustChange: 1 });
  const user = authenticateUser(db, "editor1", DEFAULT_PASSWORD);
  assert.ok(user);
  assert.strictEqual(user.id, 1);
  db.close();
});

test("3. 新账号 must_change_password 为 1", () => {
  const db = freshDb();
  const r = createInitialAdmin(db, { username: "admin", displayName: "管理员", companyName: "社内" });
  assert.ok(r.ok);
  const u = db.prepare("SELECT must_change_password FROM users WHERE id = ?").get(r.id) as { must_change_password: number };
  assert.strictEqual(u.must_change_password, 1);
  db.close();
});

test("4. 未修改默认密码时 must_change_password 仍为 1（不能进首页）", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR", { mustChange: 1 });
  const user = getSessionUser(db, 1, 0);
  assert.ok(user);
  assert.strictEqual(user.must_change_password, 1);
  db.close();
});

test("5. 正确密码可以验证", () => {
  assert.strictEqual(verifyPassword("abc123", hashPassword("abc123")), true);
});

test("6. 错误密码不能验证", () => {
  assert.strictEqual(verifyPassword("wrong", hashPassword("abc123")), false);
});

test("7. 已停用账号不能登录", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR", { isActive: 0 });
  assert.strictEqual(authenticateUser(db, "editor1", DEFAULT_PASSWORD), null);
  db.close();
});

test("8. 连续5次失败触发15分钟锁定", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR");
  for (let i = 0; i < 5; i++) {
    authenticateUser(db, "editor1", "wrong");
  }
  const u = db.prepare("SELECT locked_until, failed_login_count FROM users WHERE id = 1").get() as { locked_until: string | null; failed_login_count: number };
  assert.ok(u.locked_until);
  assert.ok(new Date(u.locked_until).getTime() > Date.now());
  // 锁定后即使密码正确也不得登录
  assert.strictEqual(authenticateUser(db, "editor1", DEFAULT_PASSWORD), null);
  db.close();
});

test("9. 成功登录清零失败次数", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR");
  db.prepare("UPDATE users SET failed_login_count = 3 WHERE id = 1").run();
  authenticateUser(db, "editor1", DEFAULT_PASSWORD);
  const u = db.prepare("SELECT failed_login_count, locked_until FROM users WHERE id = 1").get() as { failed_login_count: number; locked_until: string | null };
  assert.strictEqual(u.failed_login_count, 0);
  assert.strictEqual(u.locked_until, null);
  db.close();
});

test("10. 不存在账号与密码错误均返回 null（相同提示）", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR");
  assert.strictEqual(authenticateUser(db, "nobody", "x"), null);
  assert.strictEqual(authenticateUser(db, "editor1", "wrong"), null);
  db.close();
});

test("11. 会话回查数据库返回真实角色", () => {
  const db = freshDb();
  seedUser(db, 1, "pf1", "PROOFREADER");
  const user = getSessionUser(db, 1, 0);
  assert.ok(user);
  assert.strictEqual(user.role, "PROOFREADER");
  db.close();
});

test("12. session_version 不一致时拒绝", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR");
  db.prepare("UPDATE users SET session_version = 3 WHERE id = 1").run();
  assert.strictEqual(getSessionUser(db, 1, 0), null);
  assert.ok(getSessionUser(db, 1, 3));
  db.close();
});

test("13. INTERNAL_ADMIN 被识别为最高权限角色", () => {
  const db = freshDb();
  seedUser(db, 1, "admin1", "INTERNAL_ADMIN");
  const user = getSessionUser(db, 1, 0);
  assert.strictEqual(user?.role, "INTERNAL_ADMIN");
  db.close();
});

test("14. 普通角色不能冒充管理员", () => {
  const db = freshDb();
  seedUser(db, 1, "pf1", "PROOFREADER");
  const user = authenticateUser(db, "pf1", DEFAULT_PASSWORD);
  assert.ok(user);
  assert.strictEqual(user.role, "PROOFREADER");
  assert.notStrictEqual(user.role, "INTERNAL_ADMIN");
  db.close();
});

test("15. 首次管理员工具不能重复创建", () => {
  const db = freshDb();
  const r1 = createInitialAdmin(db, { username: "admin", displayName: "管理员", companyName: "社内" });
  assert.ok(r1.ok);
  const r2 = createInitialAdmin(db, { username: "admin2", displayName: "管理员2", companyName: "社内" });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(rows(db, "users"), 1);
  db.close();
});

test("16. 新密码少于6位时拒绝", () => {
  assert.ok(validateNewPassword("12345", "editor1"));
});

test("17. 新密码仍为123456时拒绝", () => {
  assert.ok(validateNewPassword("123456", "editor1"));
});

test("18. 新密码与账号相同时拒绝", () => {
  assert.ok(validateNewPassword("editor1", "editor1"));
});

test("19. 两次新密码不一致时拒绝", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR", { mustChange: 1 });
  const r = changePassword(db, 1, "newpass123", "different");
  assert.strictEqual(r.ok, false);
  db.close();
});

test("20. 修改成功后 must_change_password 变为 0", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR", { mustChange: 1 });
  const r = changePassword(db, 1, "newpass123", "newpass123");
  assert.strictEqual(r.ok, true);
  const u = db.prepare("SELECT must_change_password FROM users WHERE id = 1").get() as { must_change_password: number };
  assert.strictEqual(u.must_change_password, 0);
  db.close();
});

test("21. 修改密码后旧密码失效", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR", { password: DEFAULT_PASSWORD, mustChange: 1 });
  changePassword(db, 1, "newpass123", "newpass123");
  assert.strictEqual(authenticateUser(db, "editor1", DEFAULT_PASSWORD), null);
  db.close();
});

test("22. 修改密码后新密码可以登录", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR", { password: DEFAULT_PASSWORD, mustChange: 1 });
  changePassword(db, 1, "newpass123", "newpass123");
  assert.ok(authenticateUser(db, "editor1", "newpass123"));
  db.close();
});

test("23. 修改密码后旧会话因 session_version 变化而失效", () => {
  const db = freshDb();
  seedUser(db, 1, "editor1", "RESPONSIBLE_EDITOR", { mustChange: 1 });
  assert.ok(getSessionUser(db, 1, 0));
  changePassword(db, 1, "newpass123", "newpass123");
  const u = db.prepare("SELECT session_version FROM users WHERE id = 1").get() as { session_version: number };
  assert.strictEqual(u.session_version, 1);
  assert.strictEqual(getSessionUser(db, 1, 0), null); // 旧版本失效
  assert.ok(getSessionUser(db, 1, 1)); // 新版本有效
  db.close();
});

test("24. 正式数据库未被测试污染", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
