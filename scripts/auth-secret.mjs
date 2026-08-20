import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env.local");

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  if (/^AUTH_SECRET=/m.test(content)) {
    console.log("AUTH_SECRET 已存在，未覆盖");
    process.exit(0);
  }
}

const secret = crypto.randomBytes(32).toString("base64");
const line = `AUTH_SECRET=${secret}\n`;
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
const separator = existing && !existing.endsWith("\n") ? "\n" : "";
fs.appendFileSync(envPath, separator + line);
console.log("AUTH_SECRET 已生成并写入 .env.local");
