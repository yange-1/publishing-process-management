import Link from "next/link";
import {
  STAGE_LABELS,
  type DashboardTask,
  type DeliveredTask,
} from "@/lib/dashboard-service";
import ConfirmReceiptActions from "./ConfirmReceiptActions";
import ProgressSteps from "./ProgressSteps";
import { stageColor } from "./stage-colors";

// 责任编辑首页右栏「已“出餐”」版块：
// 先展示「已送达未确认」（附确认“收货”按钮），再展示「配送中」。
// 每份稿件为白色卡片，校次颜色只用于左侧图标与细色条。
export default function EditorMealBoard({
  delivered,
  inTransit,
}: {
  delivered: DeliveredTask[];
  inTransit: DashboardTask[];
}) {
  return (
    <ul className="space-y-2">
      {delivered.map((task) => {
        const c = stageColor(task.stage);
        return (
          <li
            key={`d-${task.id}`}
            className={`space-y-2 rounded-lg border border-[#E6E8EC] border-l-4 bg-white px-4 py-3 shadow-sm ${c.strip}`}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${c.icon} ${c.iconText}`}
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
                  <span className="shrink-0 rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-orange-700">
                    已送达
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${c.badge}`}>
                    {STAGE_LABELS[task.stage] ?? task.stage}
                  </span>
                </div>
              </div>
            </div>
            <ProgressSteps currentStep={6} />
            <div className="text-xs text-[#667085]">已送达！请尽快确认“收货”～</div>
            <ConfirmReceiptActions taskId={task.id} />
          </li>
        );
      })}

      {inTransit.map((task) => {
        const c = stageColor(task.stage);
        return (
          <li
            key={`t-${task.id}`}
            className={`space-y-2 rounded-lg border border-[#E6E8EC] border-l-4 bg-white px-4 py-3 shadow-sm ${c.strip}`}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${c.icon} ${c.iconText}`}
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
                  <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-800">
                    配送中
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${c.badge}`}>
                    {STAGE_LABELS[task.stage] ?? task.stage}
                  </span>
                </div>
              </div>
            </div>
            <ProgressSteps currentStep={5} />
            <div className="text-xs text-[#667085]">配送中，您的书稿正在向您奔来～</div>
          </li>
        );
      })}
    </ul>
  );
}
