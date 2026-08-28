"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SETTINGS_KEYS, defaultSettings, sanitizeSettings } = require("../settings.cjs");

test("1. settings 只保留三个非敏感字段", () => {
  const out = sanitizeSettings({
    muted: true,
    autoStart: false,
    serverUrl: "https://example.com",
    password: "secret",
    token: "abc",
    foo: 1,
  });
  assert.deepStrictEqual(Object.keys(out).sort(), ["autoStart", "muted", "serverUrl"].sort());
  assert.ok(!("password" in out), "不应保留密码");
  assert.ok(!("token" in out), "不应保留令牌");
});

test("2. 默认设置 autoStart=true、muted=false、serverUrl=localhost", () => {
  const d = defaultSettings();
  assert.strictEqual(d.autoStart, true);
  assert.strictEqual(d.muted, false);
  assert.strictEqual(d.serverUrl, "http://localhost:3000");
});

test("3. 空/非对象输入返回空对象", () => {
  assert.deepStrictEqual(sanitizeSettings(null), {});
  assert.deepStrictEqual(sanitizeSettings("x"), {});
  assert.deepStrictEqual(sanitizeSettings(undefined), {});
});

test("4. 白名单字段固定为 muted/autoStart/serverUrl", () => {
  assert.deepStrictEqual(SETTINGS_KEYS, ["muted", "autoStart", "serverUrl"]);
});
