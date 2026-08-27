import type { ReactNode } from "react";
import Link from "next/link";
import {
  STAGE_LABELS,
  STATUS_LABELS,
  WORK_TYPE_LABELS,
  waitDays,
  overdueInfo,
  type DashboardTask,
} from "@/lib/dashboard-service";
import { wordCountText } from "@/lib/task-service";
import { stageColor } from "./stage-colors";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function DashboardTaskRow({
  task,
  now,
  currentUserId,
  action,
}: {
  task: DashboardTask;
  now: Date;
  currentUserId?: number;
  action?: ReactNode;
}) {
  const info = overdueInfo(task, now);
  const c = stageColor(task.stage);
  const stageLabel = STAGE_LABELS[task.stage] ?? task.stage;
  const workTypeLabel = WORK_TYPE_LABELS[task.workType] ?? "读校";
  const statusLabel = STATUS_LABELS[task.status] ?? task.status;
  const isMine = currentUserId != null && task.proofreaderId === currentUserId;

  return (
    <li
      className={`rounded-lg border border-[#E6E8EC] border-l-4 bg-white px-4 py-3 shadow-sm transition hover:shadow-md ${c.strip}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${c.icon} ${c.iconText}`}
        >
          {c.short}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-sm text-amber-500">{"★".repeat(task.starLevel)}</span>
            <Link
              href={`/books/${task.bookId}`}
              className="min-w-0 truncate text-sm font-bold text-[#172033] hover:text-[#FF5A1F]"
              title={task.title}
            >
              {task.title}
            </Link>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${c.badge}`}>
              {stageLabel}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {workTypeLabel}
            </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {statusLabel}
            </span>
            {isMine && (
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700">
                我的当前任务
              </span>
            )}
            {info.isOverdue && (
              <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                已滞留
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-[#667085]">
            责任编辑：{task.editorName ?? "—"} · 发布单位：
            {task.publisherCompanyName ?? "—"} · 接收外校公司：
            {task.companyName ?? "—"} · 来稿 {fmtDate(task.publishedAt)} · 已等待{" "}
            {waitDays(task.publishedAt, now)} 天
          </div>
          <div className="mt-0.5 truncate text-xs text-[#667085]">
            工作字数：{wordCountText(task.workWordCount)} · 外校确认：
            {wordCountText(task.externalConfirmedWordCount)}
          </div>
          {task.proofreaderName && (
            <div className="mt-0.5 truncate text-xs text-[#667085]">
              校对人员：{task.proofreaderName} · 开始校对 {fmtDate(task.startedAt)}
              {task.finishedAt && <> · 完成 {fmtDate(task.finishedAt)}</>}
            </div>
          )}
          {task.status === "PENDING_CONFIRMATION" && (
            <div className="mt-0.5 text-xs text-gray-400">等待外校主管确认收稿</div>
          )}
          {task.status === "READY_TO_START" && !action && (
            <div className="mt-0.5 text-xs text-gray-400">等待校对人员开始</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/books/${task.bookId}`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            查看历史
          </Link>
          {action}
        </div>
      </div>
    </li>
  );
}
