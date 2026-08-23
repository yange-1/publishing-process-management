import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 回归测试：局域网访问退出登录跳转与登录成功返回。
// 上一轮在 lib/auth.ts 自定义 redirect 回调返回相对地址，导致 next-auth v4
// 客户端登录流程里 new URL(data.url) 抛错，登录实际成功却被判为失败。
// 本轮恢复默认 redirect（服务端始终返回可解析的绝对地址），并将退出改为
// signOut({ redirect:false }) + router.push("/login")，
// 使 /login 自动沿用当前访问主机（localhost / 局域网 IP / 未来 HTTPS 域名）。

const read = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf-8");

test("登录页使用 redirect:false 且成功后跳转相对首页，不依赖服务端绝对地址", () => {
  const src = read("app/login/page.tsx");
  assert.ok(src.includes("redirect: false"), "登录应使用 redirect:false 避免客户端导航");
  assert.ok(src.includes('router.push("/")'), "登录成功应跳转相对首页");
  assert.ok(!src.includes("res.url"), "登录成功不得跳转到服务端返回的 data.url");
});

test("退出按钮使用 signOut({redirect:false}) 后由客户端路由跳转相对 /login", () => {
  const src = read("app/components/UserBar.tsx");
  assert.ok(src.includes("signOut({ redirect: false })"), "退出应使用 redirect:false");
  assert.ok(src.includes('router.push("/login")'), "退出后应跳转相对 /login");
  assert.ok(!src.includes("callbackUrl"), "退出不得传入 callbackUrl");
});

test("lib/auth.ts 已恢复默认 redirect，无自定义相对地址回调", () => {
  const src = read("lib/auth.ts");
  assert.ok(!src.includes("resolveRedirect"), "不应再引用已删除的 resolveRedirect");
  assert.ok(!src.includes("redirect({"), "不应保留自定义 redirect 回调");
});

test("已删除上一轮相互矛盾的 resolveRedirect helper", () => {
  assert.strictEqual(
    fs.existsSync(path.join(process.cwd(), "lib", "redirect.ts")),
    false,
    "lib/redirect.ts 应已删除",
  );
});

test("退出目标为相对 /login，不硬编码 localhost 或局域网 IP", () => {
  const src = read("app/components/UserBar.tsx");
  assert.ok(src.includes('router.push("/login")'), "退出目标应为相对 /login");
  assert.ok(!src.includes('router.push("http'), "退出跳转不得使用绝对地址");
  assert.ok(!src.includes('router.push("//'), "退出跳转不得使用协议相对地址");
  assert.ok(!src.includes("192.168"), "不得硬编码局域网 IP");
});

test("登录/退出均不接收用户可控的回调地址（防开放重定向）", () => {
  const login = read("app/login/page.tsx");
  const userBar = read("app/components/UserBar.tsx");
  assert.ok(!login.includes("callbackUrl"), "登录页不得注入用户可控 callbackUrl");
  assert.ok(!userBar.includes("callbackUrl"), "退出按钮不得注入用户可控 callbackUrl");
  assert.ok(!userBar.includes("window.location"), "退出跳转不得引用当前完整地址");
});
