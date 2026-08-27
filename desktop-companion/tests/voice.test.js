"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const M = require("../renderer/manuscripts.js");

test("1. 首次获得数据（无快照）：不播报", () => {
  assert.deepStrictEqual(M.detectChanges(null, M.MOCK_MANUSCRIPTS), []);
});

test("2. 完全相同的数据再次到达：不播报", () => {
  const snap = M.toSnapshot(M.MOCK_MANUSCRIPTS);
  assert.deepStrictEqual(M.detectChanges(snap, M.MOCK_MANUSCRIPTS), []);
});

test("3. 单本书稿状态改变只播报一次", () => {
  const snap = M.toSnapshot(M.MOCK_MANUSCRIPTS);
  const changed = M.MOCK_MANUSCRIPTS.map((m) =>
    m.manuscriptId === "M09" ? { ...m, state: "proofreading" } : m,
  );
  const changes = M.detectChanges(snap, changed);
  assert.strictEqual(changes.length, 1);
  assert.strictEqual(changes[0].currentStatus, "proofreading");
  assert.strictEqual(changes[0].previousStatus, "queued");
  assert.strictEqual(M.changesSpeech(changes), "您有1份书稿已开始校对。");
});

test("4. 多次相同轮询不重复播报", () => {
  const snap = M.toSnapshot(M.MOCK_MANUSCRIPTS);
  assert.deepStrictEqual(M.detectChanges(snap, M.MOCK_MANUSCRIPTS), []);
  assert.deepStrictEqual(M.detectChanges(snap, M.MOCK_MANUSCRIPTS), []);
});

test("5. 新出现的书稿按其状态播报一次", () => {
  const snap = M.toSnapshot(M.MOCK_MANUSCRIPTS);
  const added = M.MOCK_MANUSCRIPTS.concat([
    { manuscriptId: "M99", title: "书稿99", state: "queued" },
  ]);
  const changes = M.detectChanges(snap, added);
  assert.strictEqual(changes.length, 1);
  assert.strictEqual(changes[0].currentStatus, "queued");
});

test("6. 多本书同时改变合并数量，不重复朗读同一句", () => {
  const snap = M.toSnapshot(M.MOCK_MANUSCRIPTS);
  const changed = M.MOCK_MANUSCRIPTS.map((m) => {
    if (m.manuscriptId === "M09") return { ...m, state: "proofreading" };
    if (m.manuscriptId === "M10") return { ...m, state: "proofreading" };
    return m;
  });
  const changes = M.detectChanges(snap, changed);
  assert.strictEqual(changes.length, 2);
  assert.strictEqual(M.changesSpeech(changes), "您有2份书稿已开始校对。");
});

test("7. 播报文案覆盖四种状态", () => {
  assert.strictEqual(M.stateVerb("proofreading"), "已开始校对。");
  assert.strictEqual(M.stateVerb("overdue"), "发生滞留，请及时处理。");
  assert.strictEqual(M.stateVerb("delivering"), "正在配送。");
  assert.strictEqual(M.stateVerb("queued"), "已进入排队。");
});

test("8. 主进程轮询：网络错误不播报、静音不播报、单定时器（main.cjs 源码检查）", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf-8");
  assert.ok(main.includes("catch"), "应捕获网络错误");
  assert.ok(main.includes("!muted"), "静音时不下发 voiceText");
  assert.strictEqual((main.match(/setInterval/g) || []).length, 1, "只应有一个轮询定时器");
  assert.ok(main.includes("clearInterval"));
  assert.ok(main.includes("Authorization"), "Bearer 头由主进程 fetch 使用");
  assert.ok(main.includes("15 * 1000"), "轮询间隔应为 15 秒");
});

test("9. 已送达单份播报一次", () => {
  const snap = M.toSnapshot(M.MOCK_MANUSCRIPTS);
  const changed = M.MOCK_MANUSCRIPTS.map((m) =>
    m.manuscriptId === "M06" ? { ...m, state: "delivered" } : m,
  );
  const changes = M.detectChanges(snap, changed);
  assert.strictEqual(changes.length, 1);
  assert.strictEqual(M.changesSpeech(changes), "您好，您的书稿已送达。");
});

test("10. 同轮多份送达合并播报", () => {
  const snap = M.toSnapshot(M.MOCK_MANUSCRIPTS);
  const changed = M.MOCK_MANUSCRIPTS.map((m) => {
    if (m.manuscriptId === "M06") return { ...m, state: "delivered" };
    if (m.manuscriptId === "M07") return { ...m, state: "delivered" };
    return m;
  });
  const changes = M.detectChanges(snap, changed);
  assert.strictEqual(changes.length, 2);
  assert.strictEqual(M.changesSpeech(changes), "您好，您有2份书稿已送达。");
});

test("11. 已送达后续相同轮询不重复播报", () => {
  const snap = M.toSnapshot(M.MOCK_MANUSCRIPTS);
  const changed = M.MOCK_MANUSCRIPTS.map((m) =>
    m.manuscriptId === "M06" ? { ...m, state: "delivered" } : m,
  );
  const snap2 = M.toSnapshot(changed);
  assert.deepStrictEqual(M.detectChanges(snap2, changed), []);
});
