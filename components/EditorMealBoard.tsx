import Link from "next/link";
import {
  STAGE_LABELS,
  type DashboardTask,
  type DeliveredTask,
} from "@/lib/dashboard-service";
import ConfirmReceiptActions from "./ConfirmReceiptActions";

// 责任编辑首页右栏「已出餐」版块：
// 先展示「已送达未确认」（需编辑操作，附确认收到按钮），再展示「配送中」。
export default function EditorMealBoard({
  delivered,
  inTransit,
}: {
  delivered: DeliveredTask[];
  inTransit: DashboardTask[];
}) {
  return (
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {delivered.map((task) => (
        <li key={`d-${task.id}`} className="px-3 py-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  href={`/books/${task.bookId}`}
                  className="truncate text-sm font-medium text-gray-900 hover:text-blue-600"
                  title={task.title}
                >
                  {task.title}
                </Link>
                <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                  已送达
                </span>
                <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                  {STAGE_LABELS[task.stage] ?? task.stage}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500">已送达！请尽快确认“收货”～</div>
            </div>
            <ConfirmReceiptActions taskId={task.id} />
          </div>
        </li>
      ))}

      {inTransit.map((task) => (
        <li key={`t-${task.id}`} className="px-3 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/books/${task.bookId}`}
              className="truncate text-sm font-medium text-gray-900 hover:text-blue-600"
              title={task.title}
            >
              {task.title}
            </Link>
            <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
              配送中
            </span>
            <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
              {STAGE_LABELS[task.stage] ?? task.stage}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-gray-500">配送中，您的书稿正在向您奔来～</div>
        </li>
      ))}
    </ul>
  );
}
