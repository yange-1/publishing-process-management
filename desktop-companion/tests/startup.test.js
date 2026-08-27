"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const MAIN = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf-8");
const APP = fs.readFileSync(path.join(__dirname, "..", "renderer", "app.js"), "utf-8");

test("1. 启动未取得数据时不显示排队书堆（渲染层无默认 queued）", () => {
  assert.ok(!APP.includes('render("queued")'), "不应默认渲染排队书堆");
});

test("2. 首次请求立即执行，不等待轮询间隔", () => {
  const sp = MAIN.indexOf("function startPolling");
  const spBody = MAIN.slice(sp, sp + 320);
  assert.ok(spBody.includes("pollOnce"), "startPolling 应立即调用 pollOnce");
  assert.ok(spBody.includes("setInterval"), "之后再设置轮询定时器");
  assert.ok(MAIN.includes("ready-to-show"), "应在渲染层就绪后启动");
});

test("3. 全零时发送 empty，渲染层有静态空状态", () => {
  assert.ok(MAIN.includes('["empty"]'), "四种状态全零时应发送 empty");
  assert.ok(APP.includes("empty: function"), "渲染层应有 empty 静态状态");
});

test("4. loading 阶段不播放语音（仅收到 voiceText 才播报）", () => {
  assert.ok(APP.includes("voiceText"), "仅当有 voiceText 才播报");
});
