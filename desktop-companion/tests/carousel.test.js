"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const MAIN = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf-8");
const APP = fs.readFileSync(path.join(__dirname, "..", "renderer", "app.js"), "utf-8");
const S = require("../renderer/states.js");

test("1. 轮播队列只含数量大于 0 的状态，按固定顺序", () => {
  assert.ok(MAIN.includes("CAROUSEL_ORDER"), "主进程应使用固定轮播顺序");
  assert.ok(MAIN.includes("counts[id] || 0) > 0"), "只轮播数量大于 0 的状态");
  assert.deepStrictEqual(S.CAROUSEL_ORDER, ["overdue", "delivering", "proofreading", "queued"]);
});

test("2. 渲染层每 5 秒切换，单一状态不切换", () => {
  assert.ok(APP.includes("5000"), "5 秒切换周期");
  assert.ok(APP.includes("carouselStates.length <= 1"), "单一状态不切换");
  assert.ok(APP.includes("(carouselIndex + 1) % carouselStates.length"), "循环切换");
});

test("3. 动画轮播不产生语音", () => {
  const idx = APP.indexOf("setInterval");
  const block = APP.slice(idx, idx + 220);
  assert.ok(block.includes("renderCurrent"), "轮播应只切换动图");
  assert.ok(!block.includes("speak("), "轮播不应触发语音");
});

test("4. delivered 不产生第五种动画", () => {
  assert.ok(!S.CAROUSEL_ORDER.includes("delivered"), "delivered 不应在轮播顺序中");
  assert.ok(!APP.includes("delivered: function"), "渲染层不应有 delivered 动画");
});

test("5. 状态增减后轮播队列更新", () => {
  assert.ok(APP.includes("carouselIndex >= carouselStates.length"), "索引越界时应重置");
  assert.ok(APP.includes("renderCurrent"), "更新后应重新渲染");
});

test("6. loading 阶段透明且安静", () => {
  assert.ok(!APP.includes('renderState("queued")'), "启动不应默认渲染排队书堆");
});
