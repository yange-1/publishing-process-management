// 校次颜色：只用于小图标、标签和左侧细色条，不铺满整张卡片。
// 暖色为主：一校=金黄、二校=橙、三校=珊瑚红、核红=玫红；初审=紫、加校=绿（少量辅色）。
export interface StageColor {
  /** 校次图标单字：初/一/二/三/红/加 */
  short: string;
  /** 校次图标背景（44px 圆角方形） */
  icon: string;
  /** 校次图标文字 */
  iconText: string;
  /** 左侧细色条（约4px） */
  strip: string;
  /** 校次标签 */
  badge: string;
}

export const STAGE_COLORS: Record<string, StageColor> = {
  // 初审：紫 #8B5CF6
  INITIAL_REVIEW: {
    short: "初",
    icon: "bg-violet-500",
    iconText: "text-white",
    strip: "border-l-violet-500",
    badge: "bg-violet-50 text-violet-700",
  },
  // 一校：金黄 #EAB308
  FIRST_PROOF: {
    short: "一",
    icon: "bg-yellow-500",
    iconText: "text-yellow-950",
    strip: "border-l-yellow-500",
    badge: "bg-yellow-50 text-yellow-700",
  },
  // 二校：橙 #F97316
  SECOND_PROOF: {
    short: "二",
    icon: "bg-orange-500",
    iconText: "text-white",
    strip: "border-l-orange-500",
    badge: "bg-orange-50 text-orange-700",
  },
  // 三校：珊瑚红 #F43F5E
  THIRD_PROOF: {
    short: "三",
    icon: "bg-rose-500",
    iconText: "text-white",
    strip: "border-l-rose-500",
    badge: "bg-rose-50 text-rose-700",
  },
  // 核红：玫红 #E11D48
  RED_CHECK: {
    short: "红",
    icon: "bg-rose-600",
    iconText: "text-white",
    strip: "border-l-rose-600",
    badge: "bg-rose-50 text-rose-700",
  },
  // 加校：绿 #22C55E
  ADDITIONAL_PROOF: {
    short: "加",
    icon: "bg-green-500",
    iconText: "text-white",
    strip: "border-l-green-500",
    badge: "bg-green-50 text-green-700",
  },
};

export function stageColor(stage: string): StageColor {
  return STAGE_COLORS[stage] ?? STAGE_COLORS.INITIAL_REVIEW;
}
