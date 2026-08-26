import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ===== 品牌名称统一：校了么 =====
// 只读源码断言，不触碰数据库。

const LAYOUT = fs.readFileSync(path.join(process.cwd(), "app", "layout.tsx"), "utf-8");
const HOME = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
const LOGIN = fs.readFileSync(
  path.join(process.cwd(), "app", "login", "page.tsx"),
  "utf-8",
);

const OLD_NAMES = ["出版校对流程管理平台", "出版校对流程管理", "校对流程管理平台"];

test("1. 登录页显示“校了么”", () => {
  assert.ok(LOGIN.includes("校了么"));
  assert.ok(!LOGIN.includes("出版校对流程管理"));
});

test("2. 登录后页面顶部显示“校了么”", () => {
  assert.ok(HOME.includes(`<h1 className="text-2xl font-bold text-gray-900">校了么</h1>`));
});

test("3. 浏览器 metadata title 为“校了么”", () => {
  assert.ok(LAYOUT.includes(`title: "校了么"`));
  // description 不再使用旧名称
  assert.ok(LAYOUT.includes(`书稿校对任务与返稿配送管理系统`));
});

test("4. 用户页面不再出现旧平台名称", () => {
  for (const src of [HOME, LOGIN, LAYOUT]) {
    for (const old of OLD_NAMES) {
      assert.ok(!src.includes(old), `仍残留旧名称「${old}」`);
    }
  }
});
