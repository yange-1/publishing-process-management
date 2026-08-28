// 设置字段白名单与清洗（settings.json 只允许 muted / autoStart / serverUrl 三个非敏感字段）
"use strict";

const SETTINGS_KEYS = ["muted", "autoStart", "serverUrl"];

function defaultSettings() {
  return { muted: false, autoStart: true, serverUrl: "http://localhost:3000" };
}

// 只保留白名单字段，丢弃任何未知/敏感字段（密码、令牌等绝不出现在 settings.json）。
function sanitizeSettings(input) {
  const out = {};
  if (input && typeof input === "object") {
    for (const k of SETTINGS_KEYS) {
      if (k in input) out[k] = input[k];
    }
  }
  return out;
}

module.exports = { SETTINGS_KEYS, defaultSettings, sanitizeSettings };
