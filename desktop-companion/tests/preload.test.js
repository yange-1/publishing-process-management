"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

test("preload 只暴露必要能力，不暴露危险 Node 能力", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "preload.cjs"), "utf-8");

  assert.ok(src.includes("contextBridge"), "应使用 contextBridge 隔离");
  assert.ok(src.includes("exposeInMainWorld"), "应通过 exposeInMainWorld 暴露");

  // 悬浮窗能力
  assert.ok(src.includes("onData"));
  assert.ok(src.includes("getMuted"));
  assert.ok(src.includes("onMuteChanged"));
  // 登录能力（只提交用户名密码，不接触网络/令牌）
  assert.ok(src.includes("companionLogin"));
  assert.ok(src.includes("login:submit"));

  // 不暴露任何 Node 能力对象
  assert.ok(
    !/exposeInMainWorld\s*\(\s*["'](?:require|process|ipcRenderer|Buffer|global|module|fs)["']/.test(src),
    "不应暴露 Node 能力",
  );

  // 不暴露 fetch / 网络能力给渲染进程
  assert.ok(!src.includes("fetch"), "渲染进程不应拥有网络能力");
});
