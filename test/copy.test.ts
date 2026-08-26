import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ===== 角色差异化页面文案（只读源码，不触碰数据库） =====
// 覆盖：待确认收稿 → 您有新的订单！；责任编辑书稿仓库/生产线统计卡；
// 配送相关最终文案；中文引号与全角波浪号。

const HOME = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
const CONFIRM = fs.readFileSync(
  path.join(process.cwd(), "components", "ConfirmReceiptActions.tsx"),
  "utf-8",
);
const MEAL = fs.readFileSync(
  path.join(process.cwd(), "components", "EditorMealBoard.tsx"),
  "utf-8",
);

const 全角波浪号 = "～";
const 左引号 = "“";
const 右引号 = "”";

test("1. 外校主管首页显示“您有新的订单！”", () => {
  // 外校主管首页展开区域标题
  assert.ok(HOME.includes(`<h2 className="text-lg font-semibold text-gray-900">您有新的订单！</h2>`));
});

test("2. Dominance 首页入口显示“您有新的订单！”", () => {
  // Dominance（非责任编辑）顶部待确认入口文案
  assert.ok(HOME.includes('isEditor ? "我的待确认" : "您有新的订单！"'));
});

test("3. 首页不再显示旧标题“待确认收稿”", () => {
  assert.ok(!HOME.includes("待确认收稿"));
});

test("4. 责任编辑“前方还有 xx 份待制作”随公司筛选联动", () => {
  assert.ok(HOME.includes('label="前方还有"'));
  assert.ok(HOME.includes('unit="份待制作"'));
  // 统计卡与列表标题均使用筛选后的 warehouseForDisplay.length，不再使用未筛选的 warehouse.length
  assert.ok(HOME.includes('label="前方还有" value={warehouseForDisplay.length}'));
  assert.ok(HOME.includes('前方还有 {warehouseForDisplay.length} 份待制作'));
  // 其他角色的“书稿仓库”仍使用未筛选的 warehouse.length
  assert.ok(HOME.includes('label="书稿仓库" value={warehouse.length}'));
});

test("5. 其他角色仍看到“书稿仓库”", () => {
  assert.ok(HOME.includes('label="书稿仓库"'));
});

test("6. 责任编辑看到““备餐”中，请耐心等待～”", () => {
  assert.ok(HOME.includes(`“备餐”中，请耐心等待～`));
});

test("7. 其他角色仍看到“生产线”", () => {
  assert.ok(HOME.includes('label="生产线"'));
});

test("8. 责任编辑看到“已“出餐””", () => {
  assert.ok(HOME.includes(`已“出餐”`));
});

test("9. 按钮显示“确认“收货””", () => {
  assert.ok(CONFIRM.includes(`确认“收货”`));
});

test("10. 配送文案使用中文引号与全角波浪号，不出现半角双波浪号", () => {
  const expected = [
    `已送达！请尽快确认“收货”${全角波浪号}`,
    `配送中，您的书稿正在向您奔来${全角波浪号}`,
  ];
  for (const s of expected) {
    assert.ok(MEAL.includes(s), `EditorMealBoard 缺少文案：${s}`);
  }
  // 所有波浪号均为全角“～”，不得出现两个半角“~~”
  assert.ok(!MEAL.includes("~~"));
  assert.ok(!CONFIRM.includes("~~"));
  assert.ok(!HOME.includes("~~"));
  // 引号使用中文双引号“ ”
  assert.ok(MEAL.includes(`确认“收货”`));
  assert.ok(HOME.includes(`已“出餐”`));
  assert.ok(HOME.includes(`${左引号}备餐${右引号}`));
});

test("11. 责任编辑列表标题“前方还有 N 份待制作”复用筛选后 warehouseForDisplay.length", () => {
  // 列表区标题（区别于顶部统计卡）：直接复用筛选后的 warehouseForDisplay.length
  assert.ok(HOME.includes(`前方还有 {warehouseForDisplay.length} 份待制作`));
  // 原责任编辑列表标题“部门书稿仓库”不再出现
  assert.ok(!HOME.includes("部门书稿仓库"));
});

test("12. 责任编辑列表“我的生产线”改为““备餐”中，请耐心等待～”", () => {
  assert.ok(HOME.includes(`isEditor ? "“备餐”中，请耐心等待～" : "生产线"`));
  // 原“我的生产线”列表标题不再出现
  assert.ok(!HOME.includes("我的生产线"));
});

test("13. 其他角色列表标题保持“书稿仓库”“生产线”不变", () => {
  // 非责任编辑的仓库列表标题仍为“书稿仓库”
  assert.ok(HOME.includes(`<h2 className="text-lg font-semibold text-gray-900">书稿仓库</h2>`));
  // 非责任编辑的生产线列表标题仍为“生产线”
  assert.ok(HOME.includes(`: "生产线"`));
});

test("14. 公司筛选联动：标题/统计卡/“共 X 条”均复用 warehouseForDisplay.length", () => {
  // 筛选逻辑：选中公司按 companyId 过滤，未选或清除则全部
  assert.ok(HOME.includes("warehouse.filter((t) => t.companyId === companyFilter)"));
  assert.ok(HOME.includes("companyFilter != null"));
  // 右侧“共 X 条”与筛选后数量一致
  assert.ok(HOME.includes("共 {warehouseForDisplay.length} 条"));
  // 责任编辑“前方还有”不再使用未筛选的 warehouse.length
  assert.ok(!HOME.includes("前方还有 {warehouse.length}"));
  assert.ok(!HOME.includes('label="前方还有" value={warehouse.length}'));
});
