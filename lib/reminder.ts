// 自动阈值提醒文案生成（纯函数）。
// 只负责把已计算好的「已等待天数 / 阈值天数 / 超出天数」拼成自然语言提示，
// 不写数据库、不调用大模型或外部 API，阈值计算复用 lib/dashboard-service.ts。
// 提示语不含书名与状态：书名已在任务卡顶部展示，避免信息重复；
// 已结束 / 已取消任务由 listOverdue 的 SQL 过滤，不在本函数重复判断。

export interface ReminderInput {
  waitDays: number;
  thresholdDays: number;
  exceedDays: number;
}

// 生成提醒文案；达到阈值当天用中文逗号「，」，超过阈值用中文感叹号「！」，结尾统一「请尽快处理！」。
export function buildReminder(input: ReminderInput): string {
  const { waitDays, thresholdDays, exceedDays } = input;
  // 未达到阈值不生成提醒（listOverdue 已过滤，此处作防御性兜底）。
  if (waitDays < thresholdDays) return "";
  const head = `已收稿${waitDays}天`;
  return exceedDays === 0 ? `${head}，请尽快处理！` : `${head}！请尽快处理！`;
}
