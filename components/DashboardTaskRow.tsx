import {
  STAGE_LABELS,
  STATUS_LABELS,
  waitDays,
  overdueInfo,
  type DashboardTask,
} from "@/lib/dashboard-service";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function DashboardTaskRow({
  task,
  now,
}: {
  task: DashboardTask;
  now: Date;
}) {
  const info = overdueInfo(task, now);
  const stageLabel = STAGE_LABELS[task.stage] ?? task.stage;
  const statusLabel = STATUS_LABELS[task.status] ?? task.status;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-sm text-amber-500">
          {"★".repeat(task.starLevel)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-gray-900" title={task.title}>
              {task.title}
            </span>
            <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
              {stageLabel}
            </span>
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {statusLabel}
            </span>
            {info.isOverdue && (
              <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                已滞留
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-gray-500">
            责任编辑：{task.editorName ?? "—"} · 发布单位：
            {task.publisherCompanyName ?? "—"} · 接收外校公司：
            {task.companyName ?? "—"} · 来稿 {fmtDate(task.publishedAt)} · 已等待{" "}
            {waitDays(task.publishedAt, now)} 天
          </div>
          {task.status === "READY_TO_START" && (
            <div className="mt-0.5 text-xs text-gray-400">等待校对人员开始</div>
          )}
        </div>
      </div>
    </li>
  );
}
