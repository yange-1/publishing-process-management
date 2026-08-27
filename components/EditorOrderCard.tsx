import Link from "next/link";
import type { ReactNode } from "react";
import {
  STAGE_LABELS,
  WORK_TYPE_LABELS,
  waitDays,
  overdueInfo,
  type DashboardTask,
} from "@/lib/dashboard-service";
import ProgressSteps, { ORDER_STEP_LABEL, orderStepTone } from "./ProgressSteps";
import { stageColor } from "./stage-colors";

// 责任编辑首页的「订单卡」：主体白色，左侧校次图标 + 细色条，保留进度条与状态标签。
// 纯展示组件：不改变任何查询、权限或状态流转；下一步动作由外部 action 传入。
export default function EditorOrderCard({
  task,
  now,
  step,
  action,
}: {
  task: DashboardTask;
  now: Date;
  step: number;
  action?: ReactNode;
}) {
  const info = overdueInfo(task, now);
  const c = stageColor(task.stage);
  const stageLabel = STAGE_LABELS[task.stage] ?? task.stage;
  const workTypeLabel = WORK_TYPE_LABELS[task.workType] ?? "读校";
  const tone = orderStepTone(step);
  const badgeCls =
    tone === "green" ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700";

  return (
    <li
      className={`rounded-lg border border-[#E6E8EC] border-l-4 bg-white px-4 py-3 shadow-sm transition hover:shadow-md ${c.strip}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${c.icon} ${c.iconText}`}
          >
            {c.short}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                href={`/books/${task.bookId}`}
                className="min-w-0 truncate text-sm font-bold text-[#172033] hover:text-[#FF5A1F]"
                title={task.title}
              >
                {task.title}
              </Link>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${badgeCls}`}>
                {ORDER_STEP_LABEL(step)}
              </span>
              {info.isOverdue && (
                <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                  已滞留
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#667085]">
              <span className={`rounded px-1.5 py-0.5 font-medium ${c.badge}`}>{stageLabel}</span>
              <span>{workTypeLabel}</span>
              <span className="font-medium text-[#FF7A00]">
                等待 {waitDays(task.publishedAt, now)} 天
              </span>
              {task.proofreaderName && <span>校对：{task.proofreaderName}</span>}
              {task.companyName && <span>{task.companyName}</span>}
            </div>

            <ProgressSteps currentStep={step} />
          </div>
        </div>

        {action && <div className="shrink-0">{action}</div>}
      </div>
    </li>
  );
}
