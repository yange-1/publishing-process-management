import { LEVEL_META, STAGE_META, overdueInfo, type Project } from "./projects";

const REGION_META = {
  warehouse: { label: "仓库", className: "bg-amber-100 text-amber-700" },
  production: { label: "生产线", className: "bg-blue-100 text-blue-700" },
} as const;

export default function OverdueRow({
  project,
  today,
  kind,
}: {
  project: Project;
  today: Date;
  kind: "warehouse" | "production";
}) {
  const level = LEVEL_META[project.level];
  const stage = STAGE_META[project.stage];
  const info = overdueInfo(project, today);
  const region = REGION_META[kind];

  return (
    <li className="rounded-md border border-red-300 border-l-4 border-l-red-500 bg-red-50 p-2.5">
      <div className="flex items-center gap-2">
        {level.stars > 0 && (
          <span className="shrink-0 text-sm leading-none text-amber-500">
            {"★".repeat(level.stars)}
          </span>
        )}
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900"
          title={project.bookName}
        >
          {project.bookName}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${stage.badgeClass}`}
        >
          {stage.label}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${region.className}`}
        >
          {region.label}
        </span>
        <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
          已滞留
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span className="text-gray-600">已等待 {info.days} 天</span>
        <span className="text-gray-600">阈值 {info.threshold} 天</span>
        <span className="ml-auto rounded bg-red-600 px-1.5 py-0.5 font-semibold text-white">
          超出 {info.overdueDays} 天
        </span>
      </div>
    </li>
  );
}
