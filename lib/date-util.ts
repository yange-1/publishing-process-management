// 集中日期工具：统计边界统一按 Asia/Shanghai 自然日计算。
// 数据库存 UTC ISO-8601 字符串；这里把 UTC 转成东八区自然日，
// 避免 UTC 直接截断造成月初/月末跨日错误。所有边界均为可注入、可测试的纯函数。

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface YMD {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

// UTC ISO 字符串 / Date → 东八区自然日（年/月/日）。
export function toShanghaiYMD(value: string | Date): YMD {
  const t = typeof value === "string" ? new Date(value).getTime() : value.getTime();
  if (Number.isNaN(t)) return { year: 0, month: 0, day: 0 };
  const d = new Date(t + SHANGHAI_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// 东八区某自然日 00:00 对应的 UTC 时间戳（含）。
export function shanghaiDayStartMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS;
}

// 东八区某自然日 24:00（次日 00:00）对应的 UTC 时间戳（不含）。
export function shanghaiDayEndMs(year: number, month: number, day: number): number {
  return shanghaiDayStartMs(year, month, day) + 86400000;
}

// 某月天数（考虑闰年）。
export function monthLength(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 某月 1 日 00:00 东八区的 UTC 时间戳（含）。
export function monthStartMs(year: number, month: number): number {
  return shanghaiDayStartMs(year, month, 1);
}

// 某月结束（= 次月 1 日 00:00 东八区）的 UTC 时间戳（不含）。
export function monthEndMs(year: number, month: number): number {
  return shanghaiDayStartMs(year, month + 1, 1);
}

// 时间戳 → UTC ISO 字符串。
export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

// 东八区 YMD → 显示字符串。
export function ymdLabel(y: number, m: number, d?: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return d == null ? `${y}-${p(m)}` : `${y}-${p(m)}-${p(d)}`;
}

// 东八区 YMD → 自然语言日期（用于“数据截止时间”展示）。
export function ymdFullLabel(y: number, m: number, d: number): string {
  return `${y}年${m}月${d}日`;
}
