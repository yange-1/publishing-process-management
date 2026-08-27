import Link from "next/link";
import type { ReactNode } from "react";
import {
  STAGE_LABELS,
  WORK_TYPE_LABELS,
  waitDays,
  overdueInfo,
  type DashboardTask,
} from "@/lib/dashboard-service";
import { stageColor } from "./stage-colors";

// 「前方还有 X 份待制作」版块的紧凑白色信息卡。
// 主体白色，左侧校次彩色图标 + 细色条；不显示七节点流程，不重复显示“待制作”状态标签。
export default function EditorQueueCard({
  task,
  now,
  action,
}: {
  task: DashboardTask;
  now: Date;
  action?: ReactNode;
}) {
  const info = overdueInfo(task, now);
  const c = stageColor(task.stage);
  const stageLabel = STAGE_LABELS[task.stage] ?? task.stage;
  const workTypeLabel = WORK_TYPE_LABELS[task.workType] ?? "读校";

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
            <Link
              href={`/books/${task.bookId}`}
              className="min-w-0 truncate text-sm font-bold text-[#172033] hover:text-[#FF5A1F]"
              title={task.title}
            >
              {task.title}
            </Link>
            {info.isOverdue && (
              <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                已滞留
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#667085]">
            <span className={`rounded px-1.5 py-0.5 font-medium ${c.badge}`}>{stageLabel}</span>
            <span>{workTypeLabel}</span>
            <span className="font-medium text-[#FF7A00]">等待 {waitDays(task.publishedAt, now)} 天</span>
            {task.companyName && <span>{task.companyName}</span>}
          </div>
        </div>

        {action && <div className="shrink-0">{action}</div>}
      </div>
    </li>
  );
}
