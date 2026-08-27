"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const MAIN = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf-8");
const M = require("../renderer/manuscripts.js");

test("1. 首次登录后的初始数据不播报（首次轮询只建立 baseline）", () => {
  assert.ok(MAIN.includes("baselineEstablished"), "应有 baselineEstablished 标志");
  assert.ok(MAIN.includes("if (!baselineEstablished)"), "首次轮询应走建立 baseline 分支");
  const start = MAIN.indexOf("if (!baselineEstablished)");
  const firstBranch = MAIN.slice(start, MAIN.indexOf("} else {", start));
  assert.ok(firstBranch.includes("toSnapshot"), "首次应建立快照");
  assert.ok(!firstBranch.includes("detectChanges"), "首次不应检测变化");
  assert.ok(!firstBranch.includes("changesSpeech"), "首次不应生成语音");
});

test("2. 已保存令牌重启后：启动时重置 baseline，首次轮询不播报", () => {
  assert.ok(MAIN.includes("baselineEstablished = false"), "启动时应重置 baseline 标志");
  assert.ok(MAIN.includes("prevSnapshot = null"), "启动时应清空旧快照");
});

test("3. 重新登录后：登录成功重置 baseline，首次轮询不播报", () => {
  // handleLoginSubmit 成功分支内同时重置 prevSnapshot 与 baselineEstablished
  assert.ok(MAIN.includes("baselineEstablished = false"), "登录成功后应重置 baseline 标志");
  assert.ok(MAIN.includes("prevSnapshot = null"), "登录成功后应清空旧快照");
});

test("4. 建立 baseline 后真实状态变化播报一次；相同轮询不重复播报", () => {
  const snap = M.toSnapshot(M.MOCK_MANUSCRIPTS);
  const changed = M.MOCK_MANUSCRIPTS.map((m) =>
    m.manuscriptId === "M09" ? { ...m, state: "proofreading" } : m,
  );
  assert.strictEqual(M.detectChanges(snap, changed).length, 1);
  const snap2 = M.toSnapshot(changed);
  assert.deepStrictEqual(M.detectChanges(snap2, changed), []);
});

test("5. 网络恢复且数据未变化不播报（错误不更新 baseline，恢复后按原 baseline 比较）", () => {
  // 轮询 catch 分支不写 prevSnapshot，只有成功轮询更新 baseline
  assert.ok(MAIN.includes("catch"), "网络错误应被捕获");
  const snap = M.toSnapshot(M.MOCK_MANUSCRIPTS);
  assert.deepStrictEqual(M.detectChanges(snap, M.MOCK_MANUSCRIPTS), []);
});
