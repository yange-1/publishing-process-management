// 统计报表中心 —— 共享类型与稳定结果结构。
// 本阶段的网页报表与下一阶段的 Excel 导出共用同一 ReportResult，
// 统计口径只由 lib/report-service.ts 权威计算，禁止在别处复制一套逻辑。

export type ReportKind = "MONTHLY" | "HALF_YEAR" | "ANNUAL";
export type ReportStatus = "ACTUAL" | "FORECAST"; // 实绩版 / 预测版

export interface MonthRef {
  year: number;
  month: number; // 1-12
}

// 单个指标的“实际 / 预测”两段值。实绩版 forecast 恒为 0。
export interface ReportMetric {
  actual: number;
  forecast: number;
}

export function metricTotal(m: ReportMetric): number {
  return m.actual + m.forecast;
}

export interface ReportResult {
  kind: ReportKind;
  year: number;
  periodLabel: string; // 如「2026年8月」「2026年上半年」「2026年」
  status: ReportStatus;
  cutoffLabel: string; // 数据截止时间（东八区）
  incomingCount: ReportMetric; // 来稿量（本次）
  incomingWords: ReportMetric; // 来稿字数（字）
  completedCount: ReportMetric; // 完成量（本次）
  completedWords: ReportMetric; // 完成字数（字）
  onTimeCount: ReportMetric; // 按期返回量（本次）
  overdueCount: ReportMetric; // 滞留量（本次）
  avgCycle500kDays: number | null; // 平均50万字完成周期（天，1位小数）
  missingWorkWordsCount: number; // 工作字数缺失（本次）
  missingConfirmedWordsCount: number; // 外校确认字数缺失（本次）
  dataQuality: string[]; // 数据质量提示
  forecastNote: string | null; // 预测说明（预测版必填，实绩版为 null）
}

// 页面请求参数（已校验）。
export interface ReportRequest {
  kind: ReportKind;
  year: number;
  period: number; // 月报=1-12 月；半年报=1(上半年)/2(下半年)；年报忽略
  companyId: number | null; // 外校主管=本公司；管理员=null（全局）
  now: Date; // 可注入的当前时间，便于稳定测试
}
