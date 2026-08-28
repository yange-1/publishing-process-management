"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeServerUrl } = require("../server-url.cjs");

test("1. localhost 地址合法", () => {
  assert.strictEqual(normalizeServerUrl("http://localhost"), "http://localhost");
  assert.strictEqual(normalizeServerUrl("http://localhost:3000"), "http://localhost:3000");
  assert.strictEqual(normalizeServerUrl("http://127.0.0.1"), "http://127.0.0.1");
  assert.strictEqual(normalizeServerUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
});

test("2. HTTPS 地址合法（含非本机）", () => {
  assert.strictEqual(normalizeServerUrl("https://example.com"), "https://example.com");
  assert.strictEqual(normalizeServerUrl("https://192.168.1.10:8443"), "https://192.168.1.10:8443");
});

test("3. 非 localhost 的 HTTP 地址拒绝", () => {
  assert.strictEqual(normalizeServerUrl("http://example.com"), null);
  assert.strictEqual(normalizeServerUrl("http://192.168.1.10"), null);
});

test("4. 带用户名或密码的 URL 拒绝", () => {
  assert.strictEqual(normalizeServerUrl("http://user:pass@localhost:3000"), null);
  assert.strictEqual(normalizeServerUrl("https://user@example.com"), null);
});

test("5. 非 HTTP/HTTPS 协议拒绝", () => {
  assert.strictEqual(normalizeServerUrl("file:///etc/passwd"), null);
  assert.strictEqual(normalizeServerUrl("javascript:alert(1)"), null);
  assert.strictEqual(normalizeServerUrl("ftp://example.com"), null);
});

test("6. 带路径/查询的 API 地址拒绝", () => {
  assert.strictEqual(normalizeServerUrl("http://localhost:3000/api"), null);
  assert.strictEqual(normalizeServerUrl("http://localhost:3000/api/companion"), null);
  assert.strictEqual(normalizeServerUrl("http://localhost:3000?x=1"), null);
});

test("7. 自动去掉末尾斜杠", () => {
  assert.strictEqual(normalizeServerUrl("http://localhost:3000/"), "http://localhost:3000");
});

test("8. 空/非法输入返回 null", () => {
  assert.strictEqual(normalizeServerUrl(""), null);
  assert.strictEqual(normalizeServerUrl("   "), null);
  assert.strictEqual(normalizeServerUrl("not a url"), null);
});
