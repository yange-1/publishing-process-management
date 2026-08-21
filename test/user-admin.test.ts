import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { hashPassword, verifyPassword, DEFAULT_PASSWORD } from "../lib/password.ts";
import { authenticateUser, getSessionUser } from "../lib/auth-service.ts";
import {
  listUsers,
  createUser,
  resetUserPassword,
  deactivateUser,
  activateUser,
  UserAdminServiceError,
  type UserAdminErrorCode,
} from "../lib/user-admin-service.ts";

const SCHEMA = fs.readFileSync(
  path.join(process.cwd(), "lib", "schema.sql"),
  "utf-8",
);

const FORMAL_PATH = path.join(process.cwd(), "data", "publishing-process.db");
const TABLES = ["companies", "users", "books", "tasks", "task_events", "audit_log"];

function formalCounts(): Record<string, number> {
  const r: Record<string, number> = {};
  if (!fs.existsSync(FORMAL_PATH)) return r;
  const db = new Database(FORMAL_PATH, { readonly: true });
  for (const t of TABLES) {
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
  db.prepare("INSERT INTO companies(id, name, type) VALUES (1, '社内', 'INTERNAL')").run();
  db.prepare(
    "INSERT INTO users(id, username, display_name, company_id, role, password_hash, must_change_password, is_active) VALUES (1, 'admin', '管理员', 1, 'INTERNAL_ADMIN', ?, 0, 1)",
  ).run(hashPassword("admin-secret"));
  return db;
}

function seedUser(db: Database.Database, id: number, username: string, role: string): void {
  db.prepare(
    "INSERT INTO users(id, username, display_name, company_id, role, password_hash, must_change_password, is_active) VALUES (?,?,?,?,?,?,0,1)",
  ).run(id, username, username, 1, role, hashPassword(DEFAULT_PASSWORD));
}

function rows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
}

function assertThrowsCode(fn: () => unknown, code: UserAdminErrorCode): void {
  assert.throws(
    fn,
    (err: unknown) => {
      assert.ok(
        err instanceof UserAdminServiceError,
        `expected UserAdminServiceError, got ${String(err)}`,
      );
      assert.strictEqual((err as UserAdminServiceError).code, code);
      return true;
    },
  );
}

test("1. INTERNAL_ADMIN可以查看安全账号列表", () => {
  const db = freshDb();
  const list = listUsers(db, 1);
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 1);
  const self = list.find((u) => u.id === 1);
  assert.ok(self);
  assert.strictEqual(self.role, "INTERNAL_ADMIN");
  assert.strictEqual(self.company_name, "社内");
  db.close();
});

test("2. 列表不包含password_hash", () => {
  const db = freshDb();
  createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  const list = listUsers(db, 1);
  assert.ok(list.length >= 2);
  for (const item of list) {
    assert.ok(!("password_hash" in item), "列表不应包含 password_hash");
  }
  db.close();
});

test("3. 普通角色不能查看账号列表", () => {
  const db = freshDb();
  seedUser(db, 2, "pf1", "PROOFREADER");
  assertThrowsCode(() => listUsers(db, 2), "FORBIDDEN");
  db.close();
});

test("4. 管理员能创建责任编辑", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "编辑部" });
  const u = db.prepare("SELECT role, company_id FROM users WHERE id = ?").get(id) as { role: string; company_id: number };
  assert.strictEqual(u.role, "RESPONSIBLE_EDITOR");
  const c = db.prepare("SELECT type FROM companies WHERE id = ?").get(u.company_id) as { type: string };
  assert.strictEqual(c.type, "INTERNAL");
  db.close();
});

test("5. 管理员能创建外校公司主管", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "sup1", displayName: "主管甲", role: "EXTERNAL_SUPERVISOR", companyName: "外校A" });
  const u = db.prepare("SELECT role, company_id FROM users WHERE id = ?").get(id) as { role: string; company_id: number };
  assert.strictEqual(u.role, "EXTERNAL_SUPERVISOR");
  const c = db.prepare("SELECT type FROM companies WHERE id = ?").get(u.company_id) as { type: string };
  assert.strictEqual(c.type, "EXTERNAL");
  db.close();
});

test("6. 管理员能创建校对人员", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "pf1", displayName: "校对甲", role: "PROOFREADER", companyName: "外校B" });
  const u = db.prepare("SELECT role, company_id FROM users WHERE id = ?").get(id) as { role: string; company_id: number };
  assert.strictEqual(u.role, "PROOFREADER");
  const c = db.prepare("SELECT type FROM companies WHERE id = ?").get(u.company_id) as { type: string };
  assert.strictEqual(c.type, "EXTERNAL");
  db.close();
});

test("7. 普通用户不能创建账号", () => {
  const db = freshDb();
  seedUser(db, 2, "pf1", "PROOFREADER");
  assertThrowsCode(
    () => createUser(db, 2, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" }),
    "FORBIDDEN",
  );
  db.close();
});

test("8. 不能通过普通服务创建INTERNAL_ADMIN", () => {
  const db = freshDb();
  assertThrowsCode(
    () => createUser(db, 1, { username: "admin2", displayName: "管理员2", role: "INTERNAL_ADMIN", companyName: "社内" }),
    "INVALID_ROLE",
  );
  assert.strictEqual(rows(db, "users"), 1);
  db.close();
});

test("9. 新用户密码为123456对应的哈希，数据库不保存明文", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  const u = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(id) as { password_hash: string };
  assert.ok(u.password_hash);
  assert.notStrictEqual(u.password_hash, DEFAULT_PASSWORD);
  assert.strictEqual(verifyPassword(DEFAULT_PASSWORD, u.password_hash), true);
  db.close();
});

test("10. 新用户must_change_password为1", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  const u = db.prepare("SELECT must_change_password FROM users WHERE id = ?").get(id) as { must_change_password: number };
  assert.strictEqual(u.must_change_password, 1);
  db.close();
});

test("11. 相同公司能够复用，不重复创建", () => {
  const db = freshDb();
  createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "编辑部" });
  createUser(db, 1, { username: "editor2", displayName: "编辑乙", role: "RESPONSIBLE_EDITOR", companyName: "编辑部" });
  const c = db.prepare("SELECT COUNT(*) c FROM companies WHERE name = '编辑部' AND type = 'INTERNAL'").get() as { c: number };
  assert.strictEqual(c.c, 1);
  db.close();
});

test("12. 重复登录账号创建失败", () => {
  const db = freshDb();
  createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  assertThrowsCode(
    () => createUser(db, 1, { username: "editor1", displayName: "编辑甲2", role: "RESPONSIBLE_EDITOR", companyName: "社内" }),
    "USERNAME_TAKEN",
  );
  assert.strictEqual(rows(db, "users"), 2);
  db.close();
});

test("13. 创建失败能够完整回滚", () => {
  const db = freshDb();
  createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "编辑部" });
  assertThrowsCode(
    () => createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "新部门" }),
    "USERNAME_TAKEN",
  );
  const c = db.prepare("SELECT COUNT(*) c FROM companies WHERE name = '新部门'").get() as { c: number };
  assert.strictEqual(c.c, 0);
  db.close();
});

test("14. 管理员能重置普通用户密码", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hashPassword("changed123"), id);
  resetUserPassword(db, 1, id);
  assert.ok(authenticateUser(db, "editor1", DEFAULT_PASSWORD));
  assert.strictEqual(authenticateUser(db, "editor1", "changed123"), null);
  db.close();
});

test("15. 重置后session_version增加", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  const before = (db.prepare("SELECT session_version FROM users WHERE id = ?").get(id) as { session_version: number }).session_version;
  resetUserPassword(db, 1, id);
  const after = (db.prepare("SELECT session_version FROM users WHERE id = ?").get(id) as { session_version: number }).session_version;
  assert.strictEqual(after, before + 1);
  db.close();
});

test("16. 重置后用户必须再次修改密码", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  resetUserPassword(db, 1, id);
  const u = db.prepare("SELECT must_change_password FROM users WHERE id = ?").get(id) as { must_change_password: number };
  assert.strictEqual(u.must_change_password, 1);
  db.close();
});

test("17. 管理员不能重置自己", () => {
  const db = freshDb();
  assertThrowsCode(() => resetUserPassword(db, 1, 1), "CANNOT_OPERATE_SELF");
  db.close();
});

test("18. 管理员能停用普通用户", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  deactivateUser(db, 1, id);
  const u = db.prepare("SELECT is_active FROM users WHERE id = ?").get(id) as { is_active: number };
  assert.strictEqual(u.is_active, 0);
  db.close();
});

test("19. 被停用用户已有会话失效且不能登录", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  assert.ok(getSessionUser(db, id, 0));
  deactivateUser(db, 1, id);
  assert.strictEqual(getSessionUser(db, id, 0), null);
  assert.strictEqual(getSessionUser(db, id, 1), null);
  assert.strictEqual(authenticateUser(db, "editor1", DEFAULT_PASSWORD), null);
  db.close();
});

test("20. 管理员不能停用自己", () => {
  const db = freshDb();
  assertThrowsCode(() => deactivateUser(db, 1, 1), "CANNOT_OPERATE_SELF");
  db.close();
});

test("21. 管理员不能通过普通服务操作其他INTERNAL_ADMIN", () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO users(id, username, display_name, company_id, role, password_hash, must_change_password, is_active) VALUES (2, 'admin2', '管理员2', 1, 'INTERNAL_ADMIN', ?, 0, 1)",
  ).run(hashPassword("x"));
  assertThrowsCode(() => deactivateUser(db, 1, 2), "CANNOT_MANAGE_ADMIN");
  assertThrowsCode(() => resetUserPassword(db, 1, 2), "CANNOT_MANAGE_ADMIN");
  db.close();
});

test("22. 管理员能重新启用普通用户", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  deactivateUser(db, 1, id);
  db.prepare("UPDATE users SET failed_login_count = 5, locked_until = ? WHERE id = ?").run(new Date(Date.now() + 60000).toISOString(), id);
  activateUser(db, 1, id);
  const u = db.prepare("SELECT is_active, failed_login_count, locked_until FROM users WHERE id = ?").get(id) as { is_active: number; failed_login_count: number; locked_until: string | null };
  assert.strictEqual(u.is_active, 1);
  assert.strictEqual(u.failed_login_count, 0);
  assert.strictEqual(u.locked_until, null);
  db.close();
});

test("23. 重复停用和重复启用保持幂等", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  const before = rows(db, "audit_log");
  deactivateUser(db, 1, id);
  deactivateUser(db, 1, id);
  assert.strictEqual(rows(db, "audit_log"), before + 1);
  activateUser(db, 1, id);
  activateUser(db, 1, id);
  assert.strictEqual(rows(db, "audit_log"), before + 2);
  assert.strictEqual((db.prepare("SELECT is_active FROM users WHERE id = ?").get(id) as { is_active: number }).is_active, 1);
  db.close();
});

test("24. 创建、重置、停用、启用均产生审计记录", () => {
  const db = freshDb();
  const before = rows(db, "audit_log");
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  assert.strictEqual(rows(db, "audit_log"), before + 1);
  resetUserPassword(db, 1, id);
  assert.strictEqual(rows(db, "audit_log"), before + 2);
  deactivateUser(db, 1, id);
  assert.strictEqual(rows(db, "audit_log"), before + 3);
  activateUser(db, 1, id);
  assert.strictEqual(rows(db, "audit_log"), before + 4);
  db.close();
});

test("25. 审计记录不含明文密码和密码哈希", () => {
  const db = freshDb();
  const id = createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  resetUserPassword(db, 1, id);
  deactivateUser(db, 1, id);
  activateUser(db, 1, id);
  const audits = db.prepare("SELECT before_value, after_value, reason FROM audit_log").all() as Array<{ before_value: string | null; after_value: string | null; reason: string }>;
  assert.ok(audits.length > 0);
  for (const a of audits) {
    const s = JSON.stringify(a);
    assert.ok(!s.includes("123456"), "审计不应包含明文密码");
    assert.ok(!s.includes("$2a$") && !s.includes("$2b$") && !s.includes("$2y$"), "审计不应包含密码哈希");
  }
  db.close();
});

test("26. audit_log不能更新或删除", () => {
  const db = freshDb();
  createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  assert.throws(() => db.prepare("UPDATE audit_log SET reason = 'x' WHERE id = 1").run());
  assert.throws(() => db.prepare("DELETE FROM audit_log WHERE id = 1").run());
  db.close();
});

test("27. 测试结束后正式数据库未被污染", () => {
  if (!fs.existsSync(FORMAL_PATH)) return;
  assert.deepStrictEqual(formalCounts(), FORMAL_BASELINE);
});
