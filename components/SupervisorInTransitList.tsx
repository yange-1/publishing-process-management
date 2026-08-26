import Link from "next/link";
import {
  STAGE_LABELS,
  WORK_TYPE_LABELS,
  type DashboardTask,
} from "@/lib/dashboard-service";
import DeliverActions from "./DeliverActions";

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
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {items.map((task) => (
        <li key={task.id} className="px-4 py-3">
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
                  {STAGE_LABELS[task.stage] ?? task.stage}
                </span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  {WORK_TYPE_LABELS[task.workType] ?? "读校"}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-gray-500">
                责任编辑：{task.editorName ?? "—"} · 结束校对 {fmtDate(task.finishedAt)}
              </div>
              {task.proofreaderName && (
                <div className="mt-0.5 truncate text-xs text-gray-500">
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
      ))}
    </ul>
  );
}
