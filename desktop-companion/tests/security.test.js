"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const MAIN = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf-8");

test("1. safeStorage 不可用时不降级明文保存令牌", () => {
  assert.ok(MAIN.includes("safeStorage.isEncryptionAvailable"), "应检查 safeStorage 可用性");
  assert.ok(MAIN.includes("encryptString"), "保存前应加密");
  assert.ok(MAIN.includes("decryptString"), "读取时应解密");
  // 令牌文件是加密后的 Buffer，不把明文 token 直接写盘
  assert.ok(!/writeFileSync\([^)]*token\b/.test(MAIN.replace(/tokenFilePath/g, "")), "不应把明文 token 写盘");
});

test("2. 令牌只保存在主进程，渲染进程无法读取", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.cjs"), "utf-8");
  assert.ok(!preload.includes("token"), "preload 不应暴露令牌");
  assert.ok(!preload.includes("fetch"), "preload 不应暴露网络能力");
});

test("3. 密码只用于本次认证，不持久化", () => {
  // 登录密码经 login:submit 交主进程；主进程不写密码到磁盘（仅加密令牌）
  assert.ok(MAIN.includes("login:submit"));
  assert.ok(!/writeFileSync\([^)]*password/.test(MAIN), "不应写入密码");
});
