# 校了么桌面伴侣（Windows 悬浮动图原型）

一个完全透明的 Windows 悬浮窗口：桌面上只显示当前状态对应的透明 PNG 动图，没有任何文字、按钮、背景或边框。

本阶段只使用**模拟数据**，不连接平台接口、不读取数据库、不修改业务状态。

## 目录结构

```
desktop-companion/
  package.json       独立依赖（Electron 不进入平台根目录）
  main.cjs           主进程：透明悬浮窗、系统托盘、位置持久化、快照/静音持久化、IPC 白名单
  preload.cjs        预加载：仅暴露 getMuted/onMuteChanged/loadSnapshot/saveSnapshot
  tray-icon.png      托盘图标
  renderer/
    index.html       仅一个动图容器
    styles.css       透明样式 + 图层定位 + 动画
    states.js        展示状态与轮播纯逻辑
    manuscripts.js   模拟书稿数据 + 状态变化检测 + 语音文案
    app.js           渲染、轮播、键盘切换、语音变化逻辑
    assets/          7 张透明 PNG 素材
  tests/
    states.test.js   状态/轮播测试
    voice.test.js    语音变化规则测试
    preload.test.js  preload 安全测试
  README.md
```

## 安装与启动

```bash
cd desktop-companion
npm install
npm test
npm run dev
```

## 悬浮窗口

- 完全透明：`frame:false`、`transparent:true`、`backgroundColor:'#00000000'`、`hasShadow:false`、`alwaysOnTop:true`、`resizable:false`。
- 桌面只显示动图，无文字、按钮、背景、边框或阴影。
- 整块动图区域可拖动（`-webkit-app-region: drag`），记住上次位置。

## 系统托盘

托盘菜单（不属于悬浮窗）：

- 显示 / 隐藏
- 静音 / 恢复语音
- 退出校了么桌面伴侣

## 四种动图

| 状态 | 素材 | 动画 |
| --- | --- | --- |
| 正在校对 | `proofreading-book.png` + `proofreading-hand-pen.png` | 手笔书写 |
| 发生滞留 | `stalled-books.png` + `stalled-exclamation.png` | 感叹号轻微呼吸 |
| 正在配送 | `delivery-wings.png` + `delivery-books.png` | 翅膀扇动、书堆漂浮 |
| 在排队 | `queue-books.png` | 轻微呼吸 |

每 5 秒在数量不为 0 的状态间自动轮播（轮播不触发语音）。

## 开发验收键盘操作（不触发语音）

- 数字 `1`：正在校对
- 数字 `2`：发生滞留
- 数字 `3`：正在配送
- 数字 `4`：在排队

## 语音规则（仅状态变化时播报）

- 只有同一 `manuscriptId` 的状态确实发生改变时才播报一次。
- 首次启动、数据不变、轮播、键盘切换、重启、显示/隐藏均不播报。
- 多本书同时变化合并为一次简短播报；新播报前取消旧语音。
- 静音时继续记录快照、不播报，恢复后不补播。
- 状态快照通过主进程安全持久化（renderer 不直接读写本机文件）。

## 安全设置

- `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`。
- preload 只暴露白名单 IPC 通道；不加载远程网页、不读数据库、不读敏感文件。

## 说明

本阶段为本地原型，使用模拟书稿数据，不连接真实平台。参考图与素材源 zip 已加入 `.gitignore`，不纳入提交。
