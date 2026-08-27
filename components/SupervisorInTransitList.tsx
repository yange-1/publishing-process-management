import Link from "next/link";
import {
  STAGE_LABELS,
  WORK_TYPE_LABELS,
  type DashboardTask,
} from "@/lib/dashboard-service";
import DeliverActions from "./DeliverActions";
import { stageColor } from "./stage-colors";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 外校主管/Dominance 首页「运送中」列表：已结束校对、尚未送达的稿件。
export default function SupervisorInTransitList({
  items,
  currentRole,
}: {
  items: DashboardTask[];
  currentRole: string;
}) {
  return (
    <ul className="space-y-2">
      {items.map((task) => {
        const c = stageColor(task.stage);
        return (
          <li
            key={task.id}
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
                  <span className="shrink-0 text-sm text-amber-500">
                    {"★".repeat(task.starLevel)}
                  </span>
                  <span className="min-w-0 truncate text-sm font-bold text-[#172033]" title={task.title}>
                    {task.title}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${c.badge}`}>
                    {STAGE_LABELS[task.stage] ?? task.stage}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    {WORK_TYPE_LABELS[task.workType] ?? "读校"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-[#667085]">
                  责任编辑：{task.editorName ?? "—"} · 结束校对 {fmtDate(task.finishedAt)}
                </div>
                {task.proofreaderName && (
                  <div className="mt-0.5 truncate text-xs text-[#667085]">
                    校对人员：{task.proofreaderName}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/books/${task.bookId}`}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  查看历史
                </Link>
                <DeliverActions taskId={task.id} currentRole={currentRole} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
