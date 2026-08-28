// 校了么桌面伴侣 · 预加载脚本
// 只通过 contextBridge 暴露必要能力，IPC 通道白名单，不暴露任何 Node 能力。
const { contextBridge, ipcRenderer } = require("electron");

// 悬浮窗渲染进程使用：接收数据、静音状态。
contextBridge.exposeInMainWorld("companion", {
  onData: (callback) => {
    ipcRenderer.on("companion:data", (_event, payload) => callback(payload));
  },
  getMuted: () => ipcRenderer.invoke("mute:get"),
  onMuteChanged: (callback) => {
    ipcRenderer.on("mute-changed", (_event, muted) => callback(muted));
  },
});

// 登录窗口渲染进程使用：获取当前平台地址、提交用户名密码与平台地址（网络请求与令牌由主进程处理）。
contextBridge.exposeInMainWorld("companionLogin", {
  getServerUrl: () => ipcRenderer.invoke("login:get-server-url"),
  submit: (username, password, serverUrl) =>
    ipcRenderer.invoke("login:submit", { username, password, serverUrl }),
});
