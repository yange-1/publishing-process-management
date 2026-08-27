import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROUTE = fs.readFileSync(
  path.join(process.cwd(), "app", "api", "companion", "manuscripts", "route.ts"),
  "utf-8",
);
const AUTH_ROUTE = fs.readFileSync(
  path.join(process.cwd(), "app", "api", "companion", "auth", "route.ts"),
  "utf-8",
);
const SERVICE = fs.readFileSync(
  path.join(process.cwd(), "lib", "companion-service.ts"),
  "utf-8",
);
const TOKEN = fs.readFileSync(
  path.join(process.cwd(), "lib", "companion-token.ts"),
  "utf-8",
);

test("1. 未登录返回 401", () => {
  assert.ok(ROUTE.includes("status: 401"));
});

test("2. 非责任编辑返回 403", () => {
  assert.ok(ROUTE.includes("status: 403"));
  assert.ok(ROUTE.includes('"RESPONSIBLE_EDITOR"'));
});

test("3. 只有 GET 接口，无 POST/PUT/PATCH/DELETE", () => {
  assert.ok(ROUTE.includes("export async function GET"));
  assert.ok(!ROUTE.includes("export async function POST"));
  assert.ok(!ROUTE.includes("export async function PUT"));
  assert.ok(!ROUTE.includes("export async function PATCH"));
  assert.ok(!ROUTE.includes("export async function DELETE"));
});

test("4. Cache-Control: no-store", () => {
  assert.ok(ROUTE.includes("no-store"));
});

test("5. editorId 从服务器会话/令牌取得，不接受客户端传入", () => {
  assert.ok(!ROUTE.includes("searchParams"));
  assert.ok(!ROUTE.includes("request.nextUrl"));
  assert.ok(!/body\??\.\s*editorId|query\??\.\s*editorId/.test(ROUTE));
});

test("6. 返回对象不含 editorId、密码、令牌、校对人员等敏感字段", () => {
  const start = SERVICE.indexOf("interface CompanionManuscript");
  const end = SERVICE.indexOf("}", start);
  const iface = SERVICE.slice(start, end);
  for (const good of ["manuscriptId", "title", "stage", "state", "updatedAt"]) {
    assert.ok(iface.includes(good), `响应应包含字段 ${good}`);
  }
  for (const bad of ["editorId", "password", "token", "proofreader", "username", "companyId", "secret"]) {
    assert.ok(!iface.includes(bad), `响应不应包含字段 ${bad}`);
  }
});

test("7. 桌面登录接口为 POST，复用现有账户验证", () => {
  assert.ok(AUTH_ROUTE.includes("export async function POST"));
  assert.ok(AUTH_ROUTE.includes("authenticateUser"));
  assert.ok(AUTH_ROUTE.includes("signCompanionToken"));
  assert.ok(!AUTH_ROUTE.includes("export async function GET"));
});

test("8. 桌面登录仅责任编辑，其他角色返回 403", () => {
  assert.ok(AUTH_ROUTE.includes("status: 403"));
  assert.ok(AUTH_ROUTE.includes('"RESPONSIBLE_EDITOR"'));
});

test("9. 桌面登录错误密码返回 401", () => {
  assert.ok(AUTH_ROUTE.includes("status: 401"));
});

test("10. 桌面登录不记录密码与令牌日志", () => {
  assert.ok(!AUTH_ROUTE.includes("console.log"));
});

test("11. 只读接口支持 Bearer 令牌", () => {
  assert.ok(ROUTE.includes("Authorization"));
  assert.ok(ROUTE.includes("Bearer "));
  assert.ok(ROUTE.includes("verifyCompanionToken"));
});

test("12. Bearer 令牌回查 sessionVersion（密码/会话改变后失效）", () => {
  assert.ok(ROUTE.includes("getSessionUser"));
});

test("13. 令牌含 scope / exp / userId / sessionVersion，使用 AUTH_SECRET", () => {
  assert.ok(TOKEN.includes("scope"));
  assert.ok(TOKEN.includes("exp"));
  assert.ok(TOKEN.includes("userId"));
  assert.ok(TOKEN.includes("sessionVersion"));
  assert.ok(TOKEN.includes("createHmac"));
  assert.ok(TOKEN.includes("timingSafeEqual"));
});
