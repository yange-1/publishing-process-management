"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { computeWindowSize, areaFraction } = require("../window-size.js");

test("1. 1536×864 可用桌面：窗口面积约为 2.5%", () => {
  const wa = { width: 1536, height: 864 };
  const s = computeWindowSize(wa, 1.6);
  const f = areaFraction(s.width, s.height, wa);
  assert.ok(Math.abs(f - 0.025) < 0.002, `面积比例 ${f} 应接近 2.5%`);
});

test("2. 1920×1080 可用桌面：窗口面积约为 2.5%", () => {
  const wa = { width: 1920, height: 1080 };
  const s = computeWindowSize(wa, 1.6);
  const f = areaFraction(s.width, s.height, wa);
  assert.ok(Math.abs(f - 0.025) < 0.002, `面积比例 ${f} 应接近 2.5%`);
});

test("3. 不同分辨率下保持约 1.6:1 宽高比", () => {
  const sizes = [
    { width: 1366, height: 768 },
    { width: 2560, height: 1440 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
  ];
  for (const wa of sizes) {
    const s = computeWindowSize(wa, 1.6);
    const ratio = s.width / s.height;
    assert.ok(Math.abs(ratio - 1.6) < 0.05, `${wa.width}×${wa.height} 宽高比 ${ratio} 应约 1.6`);
  }
});

test("4. 尺寸结果为整数、非零、非负、无小数", () => {
  for (const wa of [
    { width: 1536, height: 864 },
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    const s = computeWindowSize(wa, 1.6);
    assert.ok(Number.isInteger(s.width), "宽应为整数");
    assert.ok(Number.isInteger(s.height), "高应为整数");
    assert.ok(s.width > 0, "宽应为正数");
    assert.ok(s.height > 0, "高应为正数");
  }
});

test("5. 改变显示器不影响状态快照和语音去重（尺寸计算独立）", () => {
  // 尺寸计算是纯函数，不引用任何状态/语音/快照逻辑。
  const small = computeWindowSize({ width: 1536, height: 864 }, 1.6);
  const big = computeWindowSize({ width: 3840, height: 2160 }, 1.6);
  assert.ok(big.width > small.width, "更大桌面应得到更大窗口");

  // 语音去重逻辑与尺寸无关：首次快照仍不播报。
  const M = require("../renderer/manuscripts.js");
  assert.deepStrictEqual(M.detectChanges(null, M.MOCK_MANUSCRIPTS), []);
});
