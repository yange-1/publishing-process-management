// 平滑预测纯函数：使用“最近 N 个完整自然月”的简单移动平均。
// 只用于尚未发生的日期/月份；不用于补齐漏填字数。

export const NO_DATA_NOTE = "历史数据不足，无法预测";
export const LOW_CONFIDENCE_NOTE = "历史数据不足，预测可信度较低";

export interface ForecastOutput {
  value: number | null; // 预测值；null 表示无法预测
  note: string | null; // 低可信 / 无法预测提示；正常为 null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// values 为按时间升序排列的历史月值；只取最近 window 个做简单平均。
// 0 个 → 无法预测；1~window-1 个 → 低可信；满 window 个 → 正常。
export function movingAverage(values: number[], window = 3): ForecastOutput {
  const recent = values.slice(-window);
  if (recent.length === 0) return { value: null, note: NO_DATA_NOTE };
  const sum = recent.reduce((a, b) => a + b, 0);
  const avg = sum / recent.length;
  return {
    value: round1(avg),
    note: recent.length < window ? LOW_CONFIDENCE_NOTE : null,
  };
}
