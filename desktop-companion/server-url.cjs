// 平台地址校验与规范化（纯逻辑，可测试）
"use strict";

const DEFAULT_SERVER_URL = "http://localhost:3000";

function isLocalHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

// 返回规范化后的 base URL（无路径、无末尾斜杠）；非法返回 null。
// 规则：仅 http/https；拒绝用户名密码；拒绝路径/查询/片段；非本机必须 HTTPS。
function normalizeServerUrl(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) return null;
  if (!isLocalHost(url.hostname) && url.protocol !== "https:") return null;
  return url.origin; // 自动去掉末尾斜杠与路径
}

module.exports = { DEFAULT_SERVER_URL, normalizeServerUrl };
