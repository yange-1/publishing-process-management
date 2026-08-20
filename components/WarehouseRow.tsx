import {
  LEVEL_META,
  STAGE_META,
  STATUS_META,
  overdueInfo,
  type Project,
} from "./projects";

export default function WarehouseRow({
  project,
  today,
}: {
  project: Project;
  today: Date;
}) {
  const level = LEVEL_META[project.level];
  const stage = STAGE_META[project.stage];
  const statusClass = STATUS_META[project.status];
  const info = overdueInfo(project, today);

  return (
    <li
      className={`flex items-center gap-3 border-l-4 ${stage.borderClass} py-2 pl-3 pr-3 ${
        info.isOverdue ? "bg-red-50" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
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
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${statusClass}`}
          >
            {project.status}
          </span>
          {info.isOverdue && (
            <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
              已滞留
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
          <span>发布人：{project.editor}</span>
          <span>校对负责人：{project.proofreader}</span>
          <span>发布时间：{project.publishedAt}</span>
          <span
            className={
              info.isOverdue
                ? "font-medium text-red-600"
                : "font-medium text-gray-600"
            }
          >
            已等待 {info.days} 天
          </span>
        </div>
      </div>
      <button
        type="button"
        className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
      >
        查看历史
      </button>
    </li>
  );
}
