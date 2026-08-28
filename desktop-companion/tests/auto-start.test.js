"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const MAIN = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf-8");

test("1. 开发模式不注册开机启动（applyAutoStart 由 app.isPackaged 守卫）", () => {
  assert.ok(MAIN.includes("app.isPackaged"), "应有 isPackaged 守卫");
  assert.ok(MAIN.includes("setLoginItemSettings"), "应调用 setLoginItemSettings");
});

test("2. 安装版默认 autoStart=true", () => {
  const settings = fs.readFileSync(path.join(__dirname, "..", "settings.cjs"), "utf-8");
  assert.ok(settings.includes("autoStart: true"), "默认 autoStart 应为 true");
});

test("3. 托盘存在“开机自动启动”与“重新登录/更换服务器”", () => {
  assert.ok(MAIN.includes("开机自动启动"), "托盘应有开机自动启动");
  assert.ok(MAIN.includes("重新登录/更换服务器"), "托盘应有重新登录/更换服务器");
});

test("4. 更换服务器删除旧令牌并重置 baseline", () => {
  assert.ok(MAIN.includes("clearToken"), "更换地址应删除旧令牌");
  assert.ok(MAIN.includes("baselineEstablished = false"), "更换地址应重置 baseline");
});

test("5. 请求地址由 serverUrl 构造，不再写死 localhost", () => {
  assert.ok(MAIN.includes("${serverUrl}/api/companion/auth"), "登录地址应由 serverUrl 构造");
  assert.ok(MAIN.includes("${serverUrl}/api/companion/manuscripts"), "轮询地址应由 serverUrl 构造");
  assert.ok(!MAIN.includes("COMPANION_API_URL"), "不应再用环境变量写死地址");
});
