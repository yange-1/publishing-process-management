"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const S = require("../renderer/states.js");

const COUNTS = { proofreading: 3, overdue: 2, delivering: 3, queued: 4 };

test("1. 四种状态配置完整", () => {
  const ids = Object.keys(S.STATES).sort();
  assert.deepStrictEqual(ids, ["delivering", "overdue", "proofreading", "queued"].sort());
  for (const id of ids) {
    assert.ok(S.STATES[id].label, `${id} 缺少 label`);
    assert.ok(Number.isFinite(S.STATES[id].priority) && S.STATES[id].priority >= 1, `${id} 缺少 priority`);
  }
});

test("2. 轮播顺序正确：发生滞留 → 正在配送 → 正在校对 → 在排队", () => {
  assert.deepStrictEqual(S.CAROUSEL_ORDER, ["overdue", "delivering", "proofreading", "queued"]);
  assert.deepStrictEqual(
    S.statesInCarouselOrder().map((s) => s.label),
    ["发生滞留", "正在配送", "正在校对", "在排队"],
  );
});

test("3. 数量为 0 的状态被跳过", () => {
  const counts = { proofreading: 0, overdue: 2, delivering: 3, queued: 0 };
  assert.deepStrictEqual(
    S.activeCarouselStates(counts).map((s) => s.id),
    ["overdue", "delivering"],
  );
});

test("4. 最高优先级选择正确（滞留优先）", () => {
  assert.strictEqual(S.highestPriorityState(COUNTS).id, "overdue");
});

test("5. nextStateId 按轮播顺序循环", () => {
  assert.strictEqual(S.nextStateId("overdue", COUNTS), "delivering");
  assert.strictEqual(S.nextStateId("delivering", COUNTS), "proofreading");
  assert.strictEqual(S.nextStateId("proofreading", COUNTS), "queued");
  assert.strictEqual(S.nextStateId("queued", COUNTS), "overdue");
  assert.strictEqual(S.nextStateId("unknown", COUNTS), "overdue");
});
