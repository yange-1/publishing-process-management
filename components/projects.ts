export type Stage = "初审" | "一校" | "二校" | "三校" | "加校" | "核红";

export type Level = "普通" | "急稿" | "重要急稿";

export type ProjectStatus = "未开始" | "进行中" | "已完成";

export interface Project {
  id: string;
  bookName: string;
  editor: string; // 责任编辑（任务发布人）
  dispatcher?: string; // 分发人（校对主管），仅生产线
  proofreader: string; // 校对负责人（待分派 / 具体校对人员）
  level: Level;
  stage: Stage; // 当前校次
  status: ProjectStatus;
  publishedAt: string; // 任务发布时间 = 本校次来稿时间
  enteredProductionAt?: string; // 进入生产线时间 = 分发时间 = 节点开始时间
}

export interface StageMeta {
  label: string;
  borderClass: string;
  badgeClass: string;
}

export const STAGE_META: Record<Stage, StageMeta> = {
  初审: {
    label: "初审",
    borderClass: "border-l-blue-500",
    badgeClass: "bg-blue-600 text-white",
  },
  一校: {
    label: "一校",
    borderClass: "border-l-green-500",
    badgeClass: "bg-green-600 text-white",
  },
  二校: {
    label: "二校",
    borderClass: "border-l-amber-500",
    badgeClass: "bg-amber-600 text-white",
  },
  三校: {
    label: "三校",
    borderClass: "border-l-orange-500",
    badgeClass: "bg-orange-600 text-white",
  },
  加校: {
    label: "加校",
    borderClass: "border-l-purple-500",
    badgeClass: "bg-purple-600 text-white",
  },
  核红: {
    label: "核红",
    borderClass: "border-l-red-500",
    badgeClass: "bg-red-600 text-white",
  },
};

export const STATUS_META: Record<ProjectStatus, string> = {
  未开始: "bg-gray-100 text-gray-600",
  进行中: "bg-sky-100 text-sky-700",
  已完成: "bg-gray-200 text-gray-500",
};

export interface LevelMeta {
  label: string;
  stars: number;
  threshold: number;
}

export const LEVEL_META: Record<Level, LevelMeta> = {
  普通: { label: "普通稿件", stars: 0, threshold: 30 },
  急稿: { label: "急稿", stars: 2, threshold: 15 },
  重要急稿: { label: "重要急稿", stars: 3, threshold: 7 },
};

const INITIAL_REVIEW_THRESHOLD = 90;

const LEVEL_ORDER: Record<Level, number> = {
  重要急稿: 0,
  急稿: 1,
  普通: 2,
};

export function isWarehouse(project: Project): boolean {
  return project.status === "未开始";
}

export function isProduction(project: Project): boolean {
  return project.status === "进行中";
}

export function thresholdFor(project: Project): number {
  return project.stage === "初审"
    ? INITIAL_REVIEW_THRESHOLD
    : LEVEL_META[project.level].threshold;
}

export function waitDays(dateString: string, today: Date): number {
  const from = new Date(`${dateString}T00:00:00`);
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((to.getTime() - from.getTime()) / 86400000);
  return Math.max(0, diff);
}

// 生产线“已处理天数”：自进入生产线时间起算。
export function processedDays(project: Project, today: Date): number {
  if (!project.enteredProductionAt) return 0;
  return waitDays(project.enteredProductionAt, today);
}

export interface OverdueInfo {
  days: number;
  threshold: number;
  overdueDays: number;
  isOverdue: boolean;
}

export function overdueInfo(project: Project, today: Date): OverdueInfo {
  const days = waitDays(project.publishedAt, today);
  const threshold = thresholdFor(project);
  return {
    days,
    threshold,
    overdueDays: days - threshold,
    isOverdue: days > threshold,
  };
}

// 仓库与生产线通用排序：重要急稿 → 急稿 → 普通，同级按发布时间升序。
export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const levelDiff = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (levelDiff !== 0) return levelDiff;
    return a.publishedAt.localeCompare(b.publishedAt);
  });
}

// 总控预警排序：超出天数最多在前；超出相同时星级较高优先。
export function sortOverdue(projects: Project[], today: Date): Project[] {
  return [...projects].sort((a, b) => {
    const oa = overdueInfo(a, today).overdueDays;
    const ob = overdueInfo(b, today).overdueDays;
    if (ob !== oa) return ob - oa;
    return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
  });
}

// 完全虚构的模拟数据，仅用于演示版首页看板。
export const MOCK_PROJECTS: Project[] = [
  // —— 书稿仓库（20 条，未开始 / 待分派 / 初审）——
  { id: "w1", bookName: "云间书简", editor: "王编辑", proofreader: "待分派", level: "重要急稿", stage: "初审", status: "未开始", publishedAt: "2026-01-15" },
  { id: "w2", bookName: "山水有信", editor: "李编辑", proofreader: "待分派", level: "急稿", stage: "初审", status: "未开始", publishedAt: "2026-02-10" },
  { id: "w3", bookName: "故纸堆", editor: "张编辑", proofreader: "待分派", level: "普通", stage: "初审", status: "未开始", publishedAt: "2026-01-05" },
  { id: "w4", bookName: "春风渡口", editor: "赵编辑", proofreader: "待分派", level: "重要急稿", stage: "初审", status: "未开始", publishedAt: "2026-02-20" },
  { id: "w5", bookName: "月照归途", editor: "王编辑", proofreader: "待分派", level: "急稿", stage: "初审", status: "未开始", publishedAt: "2026-03-01" },
  { id: "w6", bookName: "半亩方塘", editor: "李编辑", proofreader: "待分派", level: "普通", stage: "初审", status: "未开始", publishedAt: "2026-02-15" },
  { id: "w7", bookName: "星河入梦", editor: "张编辑", proofreader: "待分派", level: "重要急稿", stage: "初审", status: "未开始", publishedAt: "2026-03-15" },
  { id: "w8", bookName: "城南草木", editor: "赵编辑", proofreader: "待分派", level: "急稿", stage: "初审", status: "未开始", publishedAt: "2026-03-25" },
  { id: "w9", bookName: "灯下书语", editor: "王编辑", proofreader: "待分派", level: "普通", stage: "初审", status: "未开始", publishedAt: "2026-04-01" },
  { id: "w10", bookName: "远山如黛", editor: "李编辑", proofreader: "待分派", level: "普通", stage: "初审", status: "未开始", publishedAt: "2026-04-10" },
  { id: "w11", bookName: "纸上春秋", editor: "张编辑", proofreader: "待分派", level: "普通", stage: "初审", status: "未开始", publishedAt: "2026-04-20" },
  { id: "w12", bookName: "静夜思笺", editor: "赵编辑", proofreader: "待分派", level: "普通", stage: "初审", status: "未开始", publishedAt: "2026-05-01" },
  { id: "w13", bookName: "旧时光慢", editor: "王编辑", proofreader: "待分派", level: "重要急稿", stage: "初审", status: "未开始", publishedAt: "2026-06-10" },
  { id: "w14", bookName: "未寄之信", editor: "李编辑", proofreader: "待分派", level: "急稿", stage: "初审", status: "未开始", publishedAt: "2026-06-20" },
  { id: "w15", bookName: "竹影横斜", editor: "张编辑", proofreader: "待分派", level: "普通", stage: "初审", status: "未开始", publishedAt: "2026-07-05" },
  { id: "w16", bookName: "梅香如故", editor: "赵编辑", proofreader: "待分派", level: "普通", stage: "初审", status: "未开始", publishedAt: "2026-07-15" },
  { id: "w17", bookName: "雪泥鸿爪", editor: "王编辑", proofreader: "待分派", level: "急稿", stage: "初审", status: "未开始", publishedAt: "2026-08-01" },
  { id: "w18", bookName: "月落乌啼", editor: "李编辑", proofreader: "待分派", level: "重要急稿", stage: "初审", status: "未开始", publishedAt: "2026-08-05" },
  { id: "w19", bookName: "灯下漫笔", editor: "张编辑", proofreader: "待分派", level: "普通", stage: "初审", status: "未开始", publishedAt: "2026-08-10" },
  { id: "w20", bookName: "夜航船", editor: "赵编辑", proofreader: "待分派", level: "普通", stage: "初审", status: "未开始", publishedAt: "2026-08-15" },

  // —— 生产线（6 条，进行中，每位校对人员唯一）——
  { id: "l1", bookName: "旧巷春秋", editor: "王编辑", dispatcher: "王主管", proofreader: "陈校对", level: "重要急稿", stage: "二校", status: "进行中", publishedAt: "2026-07-20", enteredProductionAt: "2026-08-10" },
  { id: "l2", bookName: "冷山夜行", editor: "李编辑", dispatcher: "王主管", proofreader: "刘校对", level: "急稿", stage: "三校", status: "进行中", publishedAt: "2026-07-25", enteredProductionAt: "2026-08-05" },
  { id: "l3", bookName: "青禾志", editor: "张编辑", dispatcher: "李主管", proofreader: "赵校对", level: "普通", stage: "一校", status: "进行中", publishedAt: "2026-06-10", enteredProductionAt: "2026-08-01" },
  { id: "l4", bookName: "孤城月", editor: "王编辑", dispatcher: "李主管", proofreader: "孙校对", level: "普通", stage: "加校", status: "进行中", publishedAt: "2026-07-01", enteredProductionAt: "2026-07-25" },
  { id: "l5", bookName: "风起长林", editor: "李编辑", dispatcher: "王主管", proofreader: "周校对", level: "重要急稿", stage: "核红", status: "进行中", publishedAt: "2026-08-16", enteredProductionAt: "2026-08-18" },
  { id: "l6", bookName: "数字浪潮", editor: "张编辑", dispatcher: "王主管", proofreader: "吴校对", level: "急稿", stage: "初审", status: "进行中", publishedAt: "2026-08-14", enteredProductionAt: "2026-08-17" },

  // —— 已完成（2 条）——
  { id: "c1", bookName: "星际漫游", editor: "张编辑", proofreader: "陈校对", level: "急稿", stage: "核红", status: "已完成", publishedAt: "2026-06-20" },
  { id: "c2", bookName: "长夜将尽", editor: "王编辑", proofreader: "刘校对", level: "普通", stage: "二校", status: "已完成", publishedAt: "2026-05-15" },
];
