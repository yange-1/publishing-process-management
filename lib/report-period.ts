// 统计周期与“实绩/预测”判定（纯函数，可注入当前时间）。
// 月报在月内按“自然日”预测；半年报/年报按“自然月”预测。

import { toShanghaiYMD, monthLength, monthStartMs, monthEndMs } from "./date-util.ts";
import type { ReportKind, ReportStatus, MonthRef } from "./report-types.ts";

export interface DayLevelForecast {
  actualDays: number; // 已发生自然日数（含今天）
  remainingDays: number; // 待预测自然日数
}

export interface PeriodSpec {
  kind: ReportKind;
  year: number;
  months: MonthRef[]; // 统计期间包含的全部自然月（月报1个、半年6个、年报12个）
  status: ReportStatus;
  actualMonths: MonthRef[]; // 使用实际数据的完整月
  forecastMonths: MonthRef[]; // 需预测的月（半年/年报=最后一个在途月；月报为空，用日级）
  dayLevel: DayLevelForecast | null; // 仅月报预测版
  periodStartMs: number; // 期间开始（含）
  periodEndMs: number; // 期间结束（不含）
  cutoffMs: number; // 滞留量“统计截止时间” = 期间结束
}

// 统计期间包含的自然月列表。
export function periodMonths(kind: ReportKind, year: number, period: number): MonthRef[] {
  if (kind === "MONTHLY") {
    return [{ year, month: period }];
  }
  if (kind === "HALF_YEAR") {
    const start = period === 1 ? 1 : 7;
    const months: MonthRef[] = [];
    for (let m = start; m < start + 6; m++) months.push({ year, month: m });
    return months;
  }
  const months: MonthRef[] = [];
  for (let m = 1; m <= 12; m++) months.push({ year, month: m });
  return months;
}

function afterPeriod(todayYear: number, todayMonth: number, last: MonthRef): boolean {
  return todayYear > last.year || (todayYear === last.year && todayMonth > last.month);
}

export function buildPeriodSpec(
  kind: ReportKind,
  year: number,
  period: number,
  now: Date,
): PeriodSpec {
  const today = toShanghaiYMD(now);
  const months = periodMonths(kind, year, period);
  const first = months[0];
  const last = months[months.length - 1];
  const periodStartMs = monthStartMs(first.year, first.month);
  const periodEndMs = monthEndMs(last.year, last.month);

  // 期间已完全结束 → 实绩版。
  if (afterPeriod(today.year, today.month, last)) {
    return {
      kind, year, months,
      status: "ACTUAL",
      actualMonths: months,
      forecastMonths: [],
      dayLevel: null,
      periodStartMs, periodEndMs, cutoffMs: periodEndMs,
    };
  }

  // 月报：在途月内按日预测；30/28/29 天月份的最后一天即期末。
  if (kind === "MONTHLY") {
    const m = first;
    const len = monthLength(m.year, m.month);
    const inMonth = today.year === m.year && today.month === m.month;
    const actualDays = inMonth ? Math.min(today.day, len) : 0;
    if (inMonth && today.day >= len) {
      return {
        kind, year, months,
        status: "ACTUAL",
        actualMonths: months, forecastMonths: [], dayLevel: null,
        periodStartMs, periodEndMs, cutoffMs: periodEndMs,
      };
    }
    return {
      kind, year, months,
      status: "FORECAST",
      actualMonths: [], forecastMonths: months,
      dayLevel: { actualDays, remainingDays: len - actualDays },
      periodStartMs, periodEndMs, cutoffMs: periodEndMs,
    };
  }

  // 半年报/年报：已完整结束的月用实际数据，其余（在途月及之后）用预测。
  const actualMonths = months.filter(
    (m) => afterPeriod(today.year, today.month, m),
  );
  const forecastMonths = months.filter((m) => !actualMonths.includes(m));
  return {
    kind, year, months,
    status: "FORECAST",
    actualMonths, forecastMonths, dayLevel: null,
    periodStartMs, periodEndMs, cutoffMs: periodEndMs,
  };
}
