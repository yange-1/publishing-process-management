import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ===== 责任编辑首页界面优化（只读源码断言，不触碰数据库） =====

const HOME = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
const STEPS = fs.readFileSync(
  path.join(process.cwd(), "components", "ProgressSteps.tsx"),
  "utf-8",
);
const CARD = fs.readFileSync(
  path.join(process.cwd(), "components", "EditorOrderCard.tsx"),
  "utf-8",
);
const QUEUE = fs.readFileSync(
  path.join(process.cwd(), "components", "EditorQueueCard.tsx"),
  "utf-8",
);
const COLORS = fs.readFileSync(
  path.join(process.cwd(), "components", "stage-colors.ts"),
  "utf-8",
);
const CONFIRM = fs.readFileSync(
  path.join(process.cwd(), "components", "ConfirmReceiptActions.tsx"),
  "utf-8",
);
const MEAL = fs.readFileSync(
  path.join(process.cwd(), "components", "EditorMealBoard.tsx"),
  "utf-8",
);

const SEVEN_STEPS = ["已下单", "已接单", "待制作", "“备餐”中", "配送中", "待“收货”", "已完成"];

test("1. 进度条包含七个订单阶段", () => {
  for (const s of SEVEN_STEPS) {
    assert.ok(STEPS.includes(s), `缺少阶段「${s}」`);
  }
});

test("2. 订单卡复用进度条并突出书名/校次/等待时间/校对人员", () => {
  assert.ok(CARD.includes("ProgressSteps"));
  assert.ok(CARD.includes("等待 {waitDays"));
  assert.ok(CARD.includes("校对：{task.proofreaderName}"));
  assert.ok(CARD.includes("已滞留")); // 红色只用于滞留，不用于普通状态
});

test("3. 责任编辑首页使用订单卡与 orderStepFor 映射", () => {
  assert.ok(HOME.includes("EditorOrderCard"));
  assert.ok(HOME.includes("orderStepFor"));
  assert.ok(HOME.includes("step={orderStepFor(task)}"));
});

test("4. “备餐”统计卡使用红色；红只用于滞留", () => {
  assert.ok(
    HOME.includes('label="“备餐”中，请耐心等待～" value={myProduction.length} tone="red"'),
  );
  assert.ok(HOME.includes('label="滞留任务" value={overdue.length} tone="red"'));
});

test("5. 保留全部已确认文案", () => {
  assert.ok(HOME.includes("前方还有 {warehouseForDisplay.length} 份待制作"));
  assert.ok(HOME.includes('isEditor ? "“备餐”中，请耐心等待～" : "生产线"'));
  assert.ok(HOME.includes("已“出餐”"));
});

test("6. 六种校次颜色：一校金黄、二校橙，不再用蓝/青作校次", () => {
  const icons = [
    "bg-violet-500", // 初审 紫
    "bg-yellow-500", // 一校 金黄
    "bg-orange-500", // 二校 橙
    "bg-rose-500", // 三校 珊瑚红
    "bg-rose-600", // 核红 玫红
    "bg-green-500", // 加校 绿
  ];
  for (const ic of icons) {
    assert.ok(COLORS.includes(ic), `缺少校次图标色 ${ic}`);
  }
  // 校次不再使用蓝/青
  assert.ok(!COLORS.includes("bg-blue-"), "校次不应使用蓝色");
  assert.ok(!COLORS.includes("bg-cyan-"), "校次不应使用青色");
  for (const stage of [
    "INITIAL_REVIEW",
    "FIRST_PROOF",
    "SECOND_PROOF",
    "THIRD_PROOF",
    "RED_CHECK",
    "ADDITIONAL_PROOF",
  ]) {
    assert.ok(COLORS.includes(stage), `缺少校次 ${stage}`);
  }
});

test("7. “前方还有”队列卡不带七节点流程，仅保留精简信息", () => {
  assert.ok(!QUEUE.includes("ProgressSteps"));
  assert.ok(!QUEUE.includes("ORDER_STEP_LABEL"));
  assert.ok(QUEUE.includes("等待 {waitDays"));
  assert.ok(QUEUE.includes("已滞留"));
  assert.ok(QUEUE.includes("action"));
});

test("8. “前方还有”版块使用队列卡（不再传 step）", () => {
  assert.ok(HOME.includes("EditorQueueCard"));
  assert.ok(HOME.includes("<ul className=\"space-y-2\">"));
});

test("9. 主色为橙红/明黄，无蓝色主按钮、无荧光玫红按钮", () => {
  // 确认收货按钮橙红
  assert.ok(CONFIRM.includes("bg-[#FF5A1F]"));
  assert.ok(!CONFIRM.includes("bg-rose-500"));
  assert.ok(!CONFIRM.includes("bg-emerald-600"));
  // 首页无蓝色主按钮
  assert.ok(!HOME.includes("bg-blue-600"));
  // 右栏标题使用明黄背景
  assert.ok(HOME.includes("bg-[#FFD43B]"));
  // 已送达浅黄、配送中浅橙
  assert.ok(MEAL.includes("bg-yellow-100"));
  assert.ok(MEAL.includes("bg-orange-100"));
  assert.ok(!MEAL.includes("bg-emerald-50"));
  // 进度节点用暖色（橙红当前 / 明黄已完成），不用蓝
  assert.ok(STEPS.includes("bg-[#FF5A1F]"));
  assert.ok(STEPS.includes("bg-[#FFD43B]"));
  assert.ok(!STEPS.includes("bg-blue-"));
});

test("10. 各角色操作按钮统一橙红，无蓝色/深绿主按钮", () => {
  const start = fs.readFileSync(
    path.join(process.cwd(), "components", "StartActions.tsx"),
    "utf-8",
  );
  const finish = fs.readFileSync(
    path.join(process.cwd(), "components", "FinishActions.tsx"),
    "utf-8",
  );
  const deliver = fs.readFileSync(
    path.join(process.cwd(), "components", "DeliverActions.tsx"),
    "utf-8",
  );
  for (const src of [start, finish, deliver]) {
    assert.ok(!src.includes("bg-blue-600"), "开始/结束/送达按钮不应为蓝色");
    assert.ok(!src.includes("bg-emerald-600"), "开始/结束/送达按钮不应为深绿");
    assert.ok(src.includes("bg-[#FF5A1F]"), "主操作按钮应为橙红");
  }
});
