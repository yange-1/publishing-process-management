import Link from "next/link";
import { STAGE_LABELS, WORK_TYPE_LABELS, type OverdueItem } from "@/lib/dashboard-service";

export default function DashboardOverdueRow({ item }: { item: OverdueItem }) {
  const stageLabel = STAGE_LABELS[item.stage] ?? item.stage;
  const workTypeLabel = WORK_TYPE_LABELS[item.workType] ?? "读校";

  return (
    <li className="rounded-md border border-red-300 border-l-4 border-l-red-500 bg-red-50 p-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-sm leading-none text-amber-500">
          {"★".repeat(item.starLevel)}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900"
          title={item.title}
        >
          {item.title}
        </span>
        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
          {stageLabel}
        </span>
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
          {workTypeLabel}
        </span>
        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
          {item.location}
        </span>
        <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
          已滞留
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span className="text-gray-600">已等待 {item.waitDays} 天</span>
        <span className="text-gray-600">阈值 {item.thresholdDays} 天</span>
        <span className="ml-auto rounded bg-red-600 px-1.5 py-0.5 font-semibold text-white">
          超出 {item.exceedDays} 天
        </span>
        <Link
          href={`/books/${item.bookId}`}
          className="shrink-0 rounded border border-red-200 px-2 py-0.5 text-red-600 hover:bg-red-100"
        >
          查看历史
        </Link>
      </div>
    </li>
  );
}
