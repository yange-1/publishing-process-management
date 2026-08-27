// 责任编辑首页订单进度条（纯展示型，不读写任何状态）。
// 已下单 → 已接单 → 待制作 → “备餐”中 → 配送中 → 待“收货” → 已完成
// 暖色节点：已完成=暖黄、当前=橙红、未完成=浅灰；文字深灰。
export const ORDER_STEPS = [
  "已下单",
  "已接单",
  "待制作",
  "“备餐”中",
  "配送中",
  "待“收货”",
  "已完成",
] as const;

export const ORDER_STEP_LABEL = (step: number): string =>
  ORDER_STEPS[Math.max(0, Math.min(6, step - 1))];

// 状态徽章语义色：订单/制作/配送=橙，送达/完成=绿（小面积，不用作主色）。
export function orderStepTone(step: number): "orange" | "green" {
  return step >= 6 ? "green" : "orange";
}

export default function ProgressSteps({ currentStep }: { currentStep: number }) {
  const step = Math.max(1, Math.min(7, currentStep));
  return (
    <ol className="flex items-start gap-1">
      {ORDER_STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <li key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                active
                  ? "bg-[#FF5A1F] ring-4 ring-[#FF5A1F]/20"
                  : done
                    ? "bg-[#FFD43B]"
                    : "bg-gray-300"
              }`}
            />
            <span
              className={`w-full truncate text-center text-[10px] leading-tight ${
                active ? "font-semibold text-[#172033]" : done ? "text-[#667085]" : "text-gray-400"
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
