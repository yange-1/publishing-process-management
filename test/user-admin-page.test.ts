import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "../lib/password.ts";
import {
  listUsers,
  createUser,
  resetUserPassword,
  deactivateUser,
  userAdminErrorMessage,
  UserAdminServiceError,
} from "../lib/user-admin-service.ts";

const SCHEMA = fs.readFileSync(
  path.join(process.cwd(), "lib", "schema.sql"),
  "utf-8",
);

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

// 页面层 / 服务器入口测试：覆盖可在 node:test 单元测试中验证的部分。
// 路由保护、首页入口显示、会话来源与不写入正式库，由 requireRole/getCurrentUser
// 与 npm run build 集成验证，见开发记录与汇报。

test("1. 业务错误转换为安全中文提示", () => {
  const err = new UserAdminServiceError("USERNAME_TAKEN", "登录账号已存在");
  assert.strictEqual(userAdminErrorMessage(err), "登录账号已存在");
  const err2 = new UserAdminServiceError("CANNOT_OPERATE_SELF", "不能重置自己的密码");
  assert.strictEqual(userAdminErrorMessage(err2), "不能重置自己的密码");
});

test("2. 未知错误转换为通用提示，不泄露 SQLite 原始信息", () => {
  const raw = new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: users.username");
  assert.strictEqual(userAdminErrorMessage(raw), "操作失败，请稍后重试");
  assert.strictEqual(userAdminErrorMessage("some raw string"), "操作失败，请稍后重试");
});

test("3. 账号列表数据不包含 password_hash", () => {
  const db = freshDb();
  createUser(db, 1, { username: "editor1", displayName: "编辑甲", role: "RESPONSIBLE_EDITOR", companyName: "社内" });
  const list = listUsers(db, 1);
  assert.ok(list.length >= 2);
  for (const item of list) {
    assert.ok(!("password_hash" in item), "页面列表不应包含 password_hash");
  }
  db.close();
});

test("4. 创建入口不接受 INTERNAL_ADMIN 角色", () => {
  const db = freshDb();
  assert.throws(
    () => createUser(db, 1, { username: "admin2", displayName: "管理员2", role: "INTERNAL_ADMIN", companyName: "社内" }),
    (e: unknown) => e instanceof UserAdminServiceError && e.code === "INVALID_ROLE",
  );
  db.close();
});

test("5. 重置、停用不能针对管理员自己", () => {
  const db = freshDb();
  assert.throws(
    () => resetUserPassword(db, 1, 1),
    (e: unknown) => e instanceof UserAdminServiceError && e.code === "CANNOT_OPERATE_SELF",
  );
  assert.throws(
    () => deactivateUser(db, 1, 1),
    (e: unknown) => e instanceof UserAdminServiceError && e.code === "CANNOT_OPERATE_SELF",
  );
  db.close();
});
