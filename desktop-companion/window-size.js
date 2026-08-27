// 校了么桌面伴侣 · 悬浮窗尺寸自适应计算（纯函数，可被 Node 测试）
"use strict";

// workArea: { width, height }，Electron 返回的是 DIP 尺寸，不除以 scaleFactor。
// ratio: 宽高比，默认 1.6。
// 目标面积 = 可用桌面面积 × 2.5%（0.025）。
function computeWindowSize(workArea, ratio) {
  ratio = ratio || 1.6;
  const targetArea = workArea.width * workArea.height * 0.025;
  const width = Math.sqrt(targetArea * ratio);
  const height = width / ratio;
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

// 窗口面积占可用桌面面积的比例（用于测试校验）。
function areaFraction(width, height, workArea) {
  return (width * height) / (workArea.width * workArea.height);
}

module.exports = { computeWindowSize: computeWindowSize, areaFraction: areaFraction };
