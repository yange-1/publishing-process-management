// 统计报表中心 —— 权威统计服务。
// 所有统计口径（来稿量/完成量/按期返回/滞留量/平均周期）只在此处计算，
// 复用 lib/dashboard-service.ts 的阈值与等待天数，禁止在页面里另写一套。
// 本服务为纯计算 + 只读查询，不写数据库、不修改业务数据。

import type Database from "better-sqlite3";
import { overdueThresholdDays, waitDays } from "./dashboard-service.ts";
import {
  toShanghaiYMD,
  toIso,
  monthEndMs,
  monthStartMs,
  ymdFullLabel,
} from "./date-util.ts";
import { buildPeriodSpec } from "./report-period.ts";
import { movingAverage } from "./report-forecast.ts";
import type {
  ReportKind,
  ReportRequest,
  ReportResult,
} from "./report-types.ts";

const DAY_MS = 86400000;
// 平均完成周期的统计单位：每 50 万字。公式 = 总耗时 ÷ 总字数 × AVG_CYCLE_BASE_WORDS。
const AVG_CYCLE_BASE_WORDS = 500000;

interface TaskRow {
  stage: string;
  starLevel: number;
  status: string;
  workWordCount: number | null;
  externalConfirmedWordCount: number | null;
  publishedAt: string;
  finishedAt: string | null;
  cancelledAt: string | null;
}

interface RangeMetrics {
  incomingCount: number;
  incomingWords: number;
  missingWorkWords: number;
  completedCount: number;
  completedWords: number;
  missingConfirmedWords: number;
  onTimeCount: number;
  cycleTotalMs: number;
  cycleWords: number;
  cycleValidCount: number;
}

interface MonthAgg {
  incoming: number;
  incomingWords: number;
  completed: number;
  completedWords: number;
  onTime: number;
}

function monthKeyOf(ms: number): string {
  const y = toShanghaiYMD(new Date(ms));
  return `${y.year}-${String(y.month).padStart(2, "0")}`;
}

function queryTasks(
  db: Database.Database,
  cutoffIso: string,
  companyId: number | null,
): TaskRow[] {
  const where = companyId != null
    ? "published_at IS NOT NULL AND published_at < ? AND company_id = ?"
    : "published_at IS NOT NULL AND published_at < ?";
  const params: (string | number)[] =
    companyId != null ? [cutoffIso, companyId] : [cutoffIso];
  const rows = db
    .prepare(
      `SELECT stage, star_level, status, work_word_count, external_confirmed_word_count,
              published_at, finished_at, cancelled_at
       FROM tasks WHERE ${where}`,
    )
    .all(...params) as Array<{
    stage: string;
    star_level: number;
    status: string;
    work_word_count: number | null;
    external_confirmed_word_count: number | null;
    published_at: string;
    finished_at: string | null;
    cancelled_at: string | null;
  }>;
  return rows.map((r) => ({
    stage: r.stage,
    starLevel: r.star_level,
    status: r.status,
    workWordCount: r.work_word_count,
    externalConfirmedWordCount: r.external_confirmed_word_count,
    publishedAt: r.published_at,
    finishedAt: r.finished_at,
    cancelledAt: r.cancelled_at,
  }));
}

function computeRangeMetrics(
  tasks: TaskRow[],
  rangeStartMs: number,
  rangeEndMs: number,
): RangeMetrics {
  const m: RangeMetrics = {
    incomingCount: 0,
    incomingWords: 0,
    missingWorkWords: 0,
    completedCount: 0,
    completedWords: 0,
    missingConfirmedWords: 0,
    onTimeCount: 0,
    cycleTotalMs: 0,
    cycleWords: 0,
    cycleValidCount: 0,
  };
  for (const t of tasks) {
    const publishedMs = new Date(t.publishedAt).getTime();
    const finishedMs = t.finishedAt ? new Date(t.finishedAt).getTime() : null;
    const cancelledMs = t.cancelledAt ? new Date(t.cancelledAt).getTime() : null;

    // 来稿量：统计期内发布且未取消（CANCELLED 不进入）。
    if (publishedMs >= rangeStartMs && publishedMs < rangeEndMs && cancelledMs === null) {
      m.incomingCount++;
      if (t.workWordCount == null) m.missingWorkWords++;
      else m.incomingWords += t.workWordCount;
    }

    // 完成量：统计期内完成且未取消（CANCELLED 不进入）。
    if (
      finishedMs !== null &&
      finishedMs >= rangeStartMs &&
      finishedMs < rangeEndMs &&
      cancelledMs === null
    ) {
      m.completedCount++;
      if (t.externalConfirmedWordCount == null) m.missingConfirmedWords++;
      else m.completedWords += t.externalConfirmedWordCount;

      const threshold = overdueThresholdDays(t.stage, t.starLevel);
      // 按期返回：从发布到完成未超过既定阈值（复用 waitDays + 阈值）。
      if (waitDays(t.publishedAt, new Date(finishedMs)) <= threshold) {
        m.onTimeCount++;
      }
      // 平均周期：仅外校确认字数为有效正整数（>0）的任务进入公式。
      if (t.externalConfirmedWordCount != null && t.externalConfirmedWordCount > 0) {
        m.cycleTotalMs += finishedMs - publishedMs;
        m.cycleWords += t.externalConfirmedWordCount;
        m.cycleValidCount++;
      }
    }
  }
  return m;
}

// 滞留量：截至 cutoff 尚未完成、尚未取消且已超过阈值（复用 waitDays + 阈值）。
function countOverdue(tasks: TaskRow[], cutoffMs: number): number {
  let count = 0;
  for (const t of tasks) {
    const publishedMs = new Date(t.publishedAt).getTime();
    if (publishedMs >= cutoffMs) continue;
    const finishedMs = t.finishedAt ? new Date(t.finishedAt).getTime() : null;
    const cancelledMs = t.cancelledAt ? new Date(t.cancelledAt).getTime() : null;
    if (finishedMs !== null && finishedMs < cutoffMs) continue;
    if (cancelledMs !== null && cancelledMs < cutoffMs) continue;
    const threshold = overdueThresholdDays(t.stage, t.starLevel);
    if (waitDays(t.publishedAt, new Date(cutoffMs)) > threshold) count++;
  }
  return count;
}

// 按自然月聚合（用于半年/年报的移动平均预测）。
function computeMonthAggs(tasks: TaskRow[]): Map<string, MonthAgg> {
  const map = new Map<string, MonthAgg>();
  const get = (k: string): MonthAgg => {
    let a = map.get(k);
    if (!a) {
      a = { incoming: 0, incomingWords: 0, completed: 0, completedWords: 0, onTime: 0 };
      map.set(k, a);
    }
    return a;
  };
  for (const t of tasks) {
    const publishedMs = new Date(t.publishedAt).getTime();
    const finishedMs = t.finishedAt ? new Date(t.finishedAt).getTime() : null;
    const cancelledMs = t.cancelledAt ? new Date(t.cancelledAt).getTime() : null;

    if (cancelledMs === null) {
      const a = get(monthKeyOf(publishedMs));
      a.incoming++;
      if (t.workWordCount != null) a.incomingWords += t.workWordCount;
    }
    if (finishedMs !== null && cancelledMs === null) {
      const a = get(monthKeyOf(finishedMs));
      a.completed++;
      if (t.externalConfirmedWordCount != null) a.completedWords += t.externalConfirmedWordCount;
      const threshold = overdueThresholdDays(t.stage, t.starLevel);
      if (waitDays(t.publishedAt, new Date(finishedMs)) <= threshold) a.onTime++;
    }
  }
  return map;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function periodLabel(kind: ReportKind, year: number, period: number): string {
  if (kind === "MONTHLY") return `${year}年${period}月`;
  if (kind === "HALF_YEAR") return `${year}年${period === 1 ? "上" : "下"}半年`;
  return `${year}年`;
}

// “数据截止时间”展示为某个自然日；exclusiveMs 为不含该日的截止时间戳。
function cutoffDayLabel(exclusiveMs: number): string {
  const y = toShanghaiYMD(new Date(exclusiveMs - 1));
  return ymdFullLabel(y.year, y.month, y.day);
}

export function computeReport(db: Database.Database, req: ReportRequest): ReportResult {
  const spec = buildPeriodSpec(req.kind, req.year, req.period, req.now);
  const nowMs = req.now.getTime();
  const today = toShanghaiYMD(req.now);
  const tasks = queryTasks(db, toIso(spec.periodEndMs), req.companyId);

  // 滞留量为期末状态量：实绩版按期间末，预测版按当前日期的保守快照。
  const snapshotCutoffMs = spec.status === "ACTUAL" ? spec.periodEndMs : nowMs;
  const overdueCount = countOverdue(tasks, snapshotCutoffMs);

  // 实际数据的覆盖区间（预测版只覆盖已发生的部分）。
  let actualEndMs = spec.periodEndMs;
  if (spec.status === "FORECAST") {
    if (spec.kind === "MONTHLY" && spec.dayLevel) {
      actualEndMs = spec.periodStartMs + spec.dayLevel.actualDays * DAY_MS;
    } else if (spec.actualMonths.length > 0) {
      const lastActual = spec.actualMonths[spec.actualMonths.length - 1];
      actualEndMs = monthEndMs(lastActual.year, lastActual.month);
    } else {
      actualEndMs = spec.periodStartMs;
    }
  }

  const actual = computeRangeMetrics(tasks, spec.periodStartMs, actualEndMs);
  const result: ReportResult = {
    kind: req.kind,
    year: req.year,
    periodLabel: periodLabel(req.kind, req.year, req.period),
    status: spec.status,
    cutoffLabel: spec.status === "ACTUAL"
      ? cutoffDayLabel(spec.periodEndMs)
      : ymdFullLabel(today.year, today.month, today.day),
    incomingCount: { actual: actual.incomingCount, forecast: 0 },
    incomingWords: { actual: actual.incomingWords, forecast: 0 },
    completedCount: { actual: actual.completedCount, forecast: 0 },
    completedWords: { actual: actual.completedWords, forecast: 0 },
    onTimeCount: { actual: actual.onTimeCount, forecast: 0 },
    overdueCount: { actual: overdueCount, forecast: 0 },
    avgCycle500kDays: actual.cycleWords > 0
      ? round1((actual.cycleTotalMs / actual.cycleWords) * AVG_CYCLE_BASE_WORDS / DAY_MS)
      : null,
    missingWorkWordsCount: actual.missingWorkWords,
    missingConfirmedWordsCount: actual.missingConfirmedWords,
    dataQuality: [],
    forecastNote: null,
  };

  // 预测版：补预测值。
  if (spec.status === "FORECAST") {
    if (spec.kind === "MONTHLY" && spec.dayLevel && spec.dayLevel.actualDays > 0) {
      const d = spec.dayLevel;
      const f = (v: number) => round1((v / d.actualDays) * d.remainingDays);
      result.incomingCount.forecast = f(actual.incomingCount);
      result.incomingWords.forecast = f(actual.incomingWords);
      result.completedCount.forecast = f(actual.completedCount);
      result.completedWords.forecast = f(actual.completedWords);
      result.onTimeCount.forecast = f(actual.onTimeCount);
      result.forecastNote =
        `本报告为预测版：第${d.actualDays + 1}—${d.actualDays + d.remainingDays}日为预测值` +
        `（按前${d.actualDays}日日均值推算），预测值不代表实际值。`;
    } else if (spec.kind !== "MONTHLY") {
      const aggs = computeMonthAggs(tasks);
      const keys = spec.actualMonths.map((m) => monthKeyOf(monthStartMs(m.year, m.month)));
      const series = (pick: (a: MonthAgg) => number) =>
        keys.map((k) => {
          const a = aggs.get(k);
          return a ? pick(a) : 0;
        });
      const forecastMonth = spec.forecastMonths[0];
      const fc = (values: number[]) => movingAverage(values, 3);
      const inc = fc(series((a) => a.incoming));
      const incW = fc(series((a) => a.incomingWords));
      const cmp = fc(series((a) => a.completed));
      const cmpW = fc(series((a) => a.completedWords));
      const onT = fc(series((a) => a.onTime));
      result.incomingCount.forecast = inc.value ?? 0;
      result.incomingWords.forecast = incW.value ?? 0;
      result.completedCount.forecast = cmp.value ?? 0;
      result.completedWords.forecast = cmpW.value ?? 0;
      result.onTimeCount.forecast = onT.value ?? 0;
      const monthLabel = forecastMonth
        ? `${forecastMonth.year}年${forecastMonth.month}月`
        : "";
      const lowNote = inc.note || cmp.note;
      result.forecastNote =
        `本报告为预测版：${monthLabel}为预测值（按最近3个月移动平均推算）` +
        (lowNote ? `，${lowNote}` : "") + `，预测值不代表实际值。`;
    } else {
      result.forecastNote = "本报告为预测版：暂无足够历史数据，无法预测。";
    }
  }

  // 数据质量提示。
  const dq: string[] = [];
  if (result.missingWorkWordsCount > 0) {
    dq.push(`工作字数缺失 ${result.missingWorkWordsCount} 本次`);
  }
  if (result.missingConfirmedWordsCount > 0) {
    dq.push(`外校确认字数缺失 ${result.missingConfirmedWordsCount} 本次`);
  }
  if (spec.status !== "FORECAST" && result.avgCycle500kDays === null && result.completedCount.actual > 0) {
    dq.push("无有效外校确认字数，无法计算平均完成周期");
  }
  result.dataQuality = dq;

  return result;
}
