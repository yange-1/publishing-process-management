import Link from "next/link";
import { requireReportViewer } from "@/lib/session";
import { openDatabase } from "@/lib/db";
import { computeReport } from "@/lib/report-service";
import { reportCompanyScope } from "@/lib/report-permission";
import { toShanghaiYMD } from "@/lib/date-util";
import { metricTotal, type ReportKind, type ReportResult } from "@/lib/report-types";

const KIND_TABS: { value: ReportKind; slug: string; label: string }[] = [
  { value: "MONTHLY", slug: "monthly", label: "月报" },
  { value: "HALF_YEAR", slug: "half_year", label: "半年报" },
  { value: "ANNUAL", slug: "annual", label: "年报" },
];

function kindFromSlug(raw: string | undefined): ReportKind {
  if (raw === "half_year") return "HALF_YEAR";
  if (raw === "annual") return "ANNUAL";
  return "MONTHLY";
}

function kindSlug(kind: ReportKind): string {
  return KIND_TABS.find((t) => t.value === kind)!.slug;
}

function parseIntIn(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isInteger(n) && n >= min && n <= max) return n;
  return fallback;
}

function fmt(n: number): string {
  return String(n);
}

function MetricCard({
  label,
  value,
  unit,
  actual,
  forecast,
}: {
  label: string;
  value: string;
  unit: string;
  actual?: number;
  forecast?: number;
}) {
  const hasForecast = forecast != null && forecast > 0;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">
        {value}
        <span className="ml-1 text-sm font-normal text-gray-500">{unit}</span>
      </div>
      {hasForecast && (
        <div className="mt-1 text-xs text-amber-600">
          <span className="mr-2">实际 {fmt(actual ?? 0)}</span>
          <span>预测 {fmt(forecast)}</span>
        </div>
      )}
    </div>
  );
}

function summaryText(r: ReportResult): string {
  const cycle =
    r.avgCycle500kDays != null ? `${r.avgCycle500kDays.toFixed(1)}天` : "暂无数据";
  const parts = [
    `${r.periodLabel}来稿量${fmt(metricTotal(r.incomingCount))}本次、${fmt(metricTotal(r.incomingWords))}字`,
    `完成量${fmt(metricTotal(r.completedCount))}本次、${fmt(metricTotal(r.completedWords))}字`,
    `按期返回${fmt(metricTotal(r.onTimeCount))}本次`,
    `期末滞留${fmt(metricTotal(r.overdueCount))}本次`,
    `平均50万字完成周期为${cycle}`,
  ];
  return parts.join("，") + "。";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireReportViewer();
  const sp = await searchParams;
  const today = toShanghaiYMD(new Date());

  const kind = kindFromSlug(typeof sp.kind === "string" ? sp.kind : undefined);
  const year = parseIntIn(typeof sp.year === "string" ? sp.year : undefined, 2000, 2100, today.year);

  let period: number;
  if (kind === "MONTHLY") period = parseIntIn(typeof sp.period === "string" ? sp.period : undefined, 1, 12, today.month);
  else if (kind === "HALF_YEAR") period = parseIntIn(typeof sp.period === "string" ? sp.period : undefined, 1, 2, today.month <= 6 ? 1 : 2);
  else period = 0;

  // 公司范围由服务端按登录用户强制确定，不信任任何前端传入的 company_id。
  const companyId = reportCompanyScope(user.role, user.company_id ?? null);

  const db = openDatabase();
  let result: ReportResult;
  let companyName: string | null = null;
  try {
    result = computeReport(db, { kind, year, period, companyId, now: new Date() });
    if (user.role === "EXTERNAL_SUPERVISOR" && user.company_id != null) {
      const row = db.prepare("SELECT name FROM companies WHERE id = ?").get(user.company_id) as
        | { name: string }
        | undefined;
      companyName = row?.name ?? "本公司";
    }
  } finally {
    db.close();
  }

  const yearOptions: number[] = [];
  for (let y = today.year - 2; y <= today.year + 1; y++) yearOptions.push(y);

  const periodOptions: { value: number; label: string }[] =
    kind === "MONTHLY"
      ? Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}月` }))
      : kind === "HALF_YEAR"
        ? [
            { value: 1, label: "上半年" },
            { value: 2, label: "下半年" },
          ]
        : [];

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">统计报表</h1>
        <Link
          href="/"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          返回首页
        </Link>
      </header>

      {companyName && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          当前统计公司：{companyName}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        {KIND_TABS.map((t) => {
          const active = t.value === kind;
          const href = `/reports?kind=${t.slug}&year=${year}${kind !== "ANNUAL" ? `&period=${period}` : ""}`;
          return (
            <Link
              key={t.value}
              href={href}
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                active
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <form method="get" action="/reports" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="kind" value={kindSlug(kind)} />
        <select
          name="year"
          defaultValue={year}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-700"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        {periodOptions.length > 0 && (
          <select
            name="period"
            defaultValue={period}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-700"
          >
            {periodOptions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          查询
        </button>
      </form>

      <div className="mb-4 flex items-center gap-3">
        <span className="text-lg font-semibold text-gray-900">{result.periodLabel}</span>
        {result.status === "ACTUAL" ? (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            实绩版
          </span>
        ) : (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            预测版
          </span>
        )}
        <span className="text-sm text-gray-500">数据截止：{result.cutoffLabel}</span>
      </div>

      {result.forecastNote && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {result.forecastNote}
        </div>
      )}

      <section className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          label="来稿量"
          value={fmt(metricTotal(result.incomingCount))}
          unit="本次"
          actual={result.incomingCount.actual}
          forecast={result.incomingCount.forecast}
        />
        <MetricCard
          label="来稿字数"
          value={fmt(metricTotal(result.incomingWords))}
          unit="字"
          actual={result.incomingWords.actual}
          forecast={result.incomingWords.forecast}
        />
        <MetricCard
          label="完成量"
          value={fmt(metricTotal(result.completedCount))}
          unit="本次"
          actual={result.completedCount.actual}
          forecast={result.completedCount.forecast}
        />
        <MetricCard
          label="完成字数"
          value={fmt(metricTotal(result.completedWords))}
          unit="字"
          actual={result.completedWords.actual}
          forecast={result.completedWords.forecast}
        />
        <MetricCard
          label="按期返回量"
          value={fmt(metricTotal(result.onTimeCount))}
          unit="本次"
          actual={result.onTimeCount.actual}
          forecast={result.onTimeCount.forecast}
        />
        <MetricCard
          label="滞留量"
          value={fmt(metricTotal(result.overdueCount))}
          unit="本次"
          actual={result.overdueCount.actual}
          forecast={result.overdueCount.forecast}
        />
        <MetricCard
          label="平均50万字完成周期"
          value={result.avgCycle500kDays != null ? result.avgCycle500kDays.toFixed(1) : "—"}
          unit="天"
        />
      </section>

      <section className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">自动摘要</h2>
        <p className="text-sm text-gray-800">{summaryText(result)}</p>
      </section>

      {(result.dataQuality.length > 0 ||
        result.missingWorkWordsCount > 0 ||
        result.missingConfirmedWordsCount > 0) && (
        <section className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">数据质量提示</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
            {result.missingWorkWordsCount > 0 && (
              <li>工作字数缺失 {result.missingWorkWordsCount} 本次（显示「未填写」，未按 0 补造）</li>
            )}
            {result.missingConfirmedWordsCount > 0 && (
              <li>外校确认字数缺失 {result.missingConfirmedWordsCount} 本次（显示「未填写」，未按 0 补造）</li>
            )}
            {result.dataQuality
              .filter((d) => !d.includes("缺失"))
              .map((d) => (
                <li key={d}>{d}</li>
              ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-gray-400">
        统计口径：每一项校对任务（每一次校次）计为 1 本次，不按书名去重；取消任务不进入统计。预测值仅供趋势参考，不代表实际结果。
      </p>
    </main>
  );
}
