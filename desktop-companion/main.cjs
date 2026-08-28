// 校了么桌面伴侣 · Electron 主进程
// 完全透明悬浮窗（只显示动图）+ 系统托盘 + 登录小窗口 + 真实数据轮询。
const {
  app,
  BrowserWindow,
  screen,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  safeStorage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { computeWindowSize } = require("./window-size.js");
const M = require("./renderer/manuscripts.js");
const S = require("./renderer/states.js");
const { sanitizeSettings } = require("./settings.cjs");
const { DEFAULT_SERVER_URL, normalizeServerUrl } = require("./server-url.cjs");

const ASPECT_RATIO = 1.6;
const MARGIN = 24;
const POLL_INTERVAL_MS = 15 * 1000;

let win = null; // 悬浮窗
let loginWin = null; // 登录小窗口
let tray = null;
let muted = false;
let autoStart = true;
let serverUrl = DEFAULT_SERVER_URL;
let lastDisplayId = null;
let resizing = false;
let token = null;
let prevSnapshot = null;
let pollTimer = null;
let baselineEstablished = false;

function positionFile() {
  return path.join(app.getPath("userData"), "window-position.json");
}
function snapshotFile() {
  return path.join(app.getPath("userData"), "snapshot.json");
}
function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}
function tokenFilePath() {
  return path.join(app.getPath("userData"), "token.enc");
}

// ===== 位置 =====
function loadPosition() {
  try {
    const p = JSON.parse(fs.readFileSync(positionFile(), "utf-8"));
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
    return null;
  } catch {
    return null;
  }
}
function savePosition(bounds) {
  try {
    fs.writeFileSync(positionFile(), JSON.stringify({ x: bounds.x, y: bounds.y }), "utf-8");
  } catch {
    /* 忽略 */
  }
}
function displayForPoint(x, y) {
  return screen.getDisplayMatching({ x: x, y: y, width: 1, height: 1 });
}
function currentDisplay() {
  if (!win) return screen.getPrimaryDisplay();
  return screen.getDisplayMatching(win.getBounds());
}
function defaultPosition(display) {
  const wa = display.workArea;
  const size = computeWindowSize(wa, ASPECT_RATIO);
  return {
    x: wa.x + wa.width - size.width - MARGIN,
    y: wa.y + wa.height - size.height - MARGIN,
  };
}
function resizeForCurrentDisplay() {
  if (!win || resizing) return;
  resizing = true;
  try {
    const display = currentDisplay();
    const size = computeWindowSize(display.workArea, ASPECT_RATIO);
    win.setSize(size.width, size.height);
    lastDisplayId = display.id;
    clampToWorkArea(display);
  } finally {
    resizing = false;
  }
}
function clampToWorkArea(display) {
  if (!win) return;
  const wa = display.workArea;
  const b = win.getBounds();
  const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - b.width);
  const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height);
  if (x !== b.x || y !== b.y) win.setPosition(x, y);
}

// ===== 快照 / 静音（本地持久化，主进程安全读写）=====
function saveSnapshot(snap) {
  try {
    fs.writeFileSync(snapshotFile(), JSON.stringify(snap), "utf-8");
  } catch {
    /* 忽略 */
  }
}
function loadSettings() {
  try {
    const s = sanitizeSettings(JSON.parse(fs.readFileSync(settingsFile(), "utf-8")));
    if (typeof s.muted === "boolean") muted = s.muted;
    if (typeof s.autoStart === "boolean") autoStart = s.autoStart;
    if (typeof s.serverUrl === "string") {
      const norm = normalizeServerUrl(s.serverUrl);
      if (norm) serverUrl = norm;
    }
  } catch {
    /* 忽略 */
  }
}
function saveSettings() {
  try {
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify(sanitizeSettings({ muted, autoStart, serverUrl })),
      "utf-8",
    );
  } catch {
    /* 忽略 */
  }
}

// ===== 令牌（safeStorage 加密保存；不可用时仅内存，不降级明文）=====
function saveToken(t) {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(tokenFilePath(), safeStorage.encryptString(t));
    }
  } catch {
    /* 忽略 */
  }
}
function loadToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(tokenFilePath()));
  } catch {
    return null;
  }
}
function clearToken() {
  try {
    if (fs.existsSync(tokenFilePath())) fs.unlinkSync(tokenFilePath());
  } catch {
    /* 忽略 */
  }
}

// ===== 窗口 =====
function createFloatingWindow() {
  const saved = loadPosition();
  const display = saved ? displayForPoint(saved.x, saved.y) : screen.getPrimaryDisplay();
  const size = computeWindowSize(display.workArea, ASPECT_RATIO);
  const pos = saved || defaultPosition(display);
  lastDisplayId = display.id;

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => {
    if (win && token) {
      win.show();
      startPolling(); // 渲染层就绪后立即执行第一次请求，不等待轮询间隔
    }
  });
  win.on("moved", () => {
    if (!win || resizing) return;
    savePosition(win.getBounds());
    const display = currentDisplay();
    if (display.id !== lastDisplayId) resizeForCurrentDisplay();
  });
}

function createLoginWindow() {
  if (loginWin) {
    loginWin.focus();
    return;
  }
  loginWin = new BrowserWindow({
    width: 340,
    height: 300,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "校了么桌面伴侣 - 登录",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loginWin.loadFile(path.join(__dirname, "renderer", "login.html"));
  loginWin.on("closed", () => {
    loginWin = null;
  });
}

// ===== 轮询 =====
async function pollOnce() {
  if (!token) return;
  try {
    const res = await fetch(`${serverUrl}/api/companion/manuscripts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      token = null;
      clearToken();
      stopPolling();
      if (win) win.hide();
      createLoginWindow();
      return;
    }
    if (!res.ok) return; // 403/500 等：保持最后画面
    const data = await res.json();
    const manuscripts = Array.isArray(data.manuscripts) ? data.manuscripts : [];

    let voiceText = null;
    if (!baselineEstablished) {
      // 首次成功轮询：只建立 baseline，不比较、不播报，不把现有书稿识别为“新出现”。
      prevSnapshot = M.toSnapshot(manuscripts);
      baselineEstablished = true;
    } else {
      const changes = M.detectChanges(prevSnapshot, manuscripts);
      if (changes.length > 0 && !muted) {
        voiceText = M.changesSpeech(changes);
      }
      prevSnapshot = M.toSnapshot(manuscripts);
    }
    saveSnapshot(prevSnapshot);

    const counts = M.countByState(manuscripts);
    // 动画轮播只含数量大于 0 的状态，按固定顺序 overdue → delivering → proofreading → queued。
    const animationStates = S.CAROUSEL_ORDER.filter(function (id) {
      return (counts[id] || 0) > 0;
    });
    const states = animationStates.length > 0 ? animationStates : ["empty"];

    if (win && !win.isDestroyed()) {
      win.webContents.send("companion:data", { states, voiceText });
    }
  } catch {
    // 网络错误：保持最后画面，不播报
  }
}
function startPolling() {
  stopPolling();
  pollOnce();
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ===== 登录 =====
async function handleLoginSubmit(_event, input) {
  const username = typeof input?.username === "string" ? input.username.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  const inputUrl = typeof input?.serverUrl === "string" ? input.serverUrl.trim() : "";
  if (!username || !password) return { ok: false, message: "请输入用户名和密码" };

  // 平台地址：为空沿用当前；更换服务器则删除旧令牌与 baseline。
  let targetUrl = serverUrl;
  if (inputUrl) {
    const norm = normalizeServerUrl(inputUrl);
    if (!norm) {
      return { ok: false, message: "平台地址无效：仅支持 http://localhost、http://127.0.0.1 或 HTTPS 地址" };
    }
    targetUrl = norm;
  }
  if (targetUrl !== serverUrl) {
    serverUrl = targetUrl;
    token = null;
    clearToken();
    prevSnapshot = null;
    baselineEstablished = false;
    saveSettings();
  }

  try {
    const res = await fetch(`${serverUrl}/api/companion/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) {
      token = data.token;
      saveToken(data.token);
      prevSnapshot = null;
      baselineEstablished = false; // 重新登录后首次数据只建 baseline，不播报
      if (loginWin) loginWin.close();
      if (win) win.show();
      startPolling();
      return { ok: true };
    }
    return { ok: false, message: data.message || "登录失败" };
  } catch {
    return { ok: false, message: "无法连接服务，请稍后重试" };
  }
}

// ===== 托盘 =====
function toggleMute() {
  muted = !muted;
  saveSettings();
  if (win) win.webContents.send("mute-changed", muted);
}

function applyAutoStart() {
  // 仅正式安装版注册/注销开机启动；开发模式绝不注册。
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: autoStart, name: "校了么桌面伴侣" });
  }
}

function toggleAutoStart() {
  autoStart = !autoStart;
  saveSettings();
  applyAutoStart();
}

function startRelogin() {
  stopPolling();
  createLoginWindow();
}
function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: win && win.isVisible() ? "隐藏" : "显示",
      click: () => {
        if (!win) return;
        if (win.isVisible()) win.hide();
        else win.show();
        rebuildTrayMenu();
      },
    },
    {
      label: muted ? "恢复语音" : "静音",
      click: () => {
        toggleMute();
        rebuildTrayMenu();
      },
    },
    {
      label: "开机自动启动",
      type: "checkbox",
      checked: autoStart,
      click: () => {
        toggleAutoStart();
        rebuildTrayMenu();
      },
    },
    {
      label: "重新登录/更换服务器",
      click: () => {
        startRelogin();
      },
    },
    { type: "separator" },
    {
      label: "退出校了么桌面伴侣",
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "tray-icon.png"));
  tray = new Tray(icon);
  tray.setToolTip("校了么桌面伴侣");
  rebuildTrayMenu();
  tray.on("click", () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else win.show();
    rebuildTrayMenu();
  });
}

app.whenReady().then(() => {
  loadSettings(); // 读取 muted 与 autoStart（autoStart 默认 true）
  applyAutoStart(); // 首次安装默认开启开机自启；开发模式不注册

  ipcMain.handle("mute:get", () => muted);
  ipcMain.handle("login:get-server-url", () => serverUrl);
  ipcMain.handle("login:submit", handleLoginSubmit);

  token = loadToken();
  prevSnapshot = null;
  baselineEstablished = false;

  createFloatingWindow();
  createTray();

  if (!token) {
    createLoginWindow();
  }

  screen.on("display-metrics-changed", () => resizeForCurrentDisplay());
  screen.on("display-added", () => resizeForCurrentDisplay());
  screen.on("display-removed", () => resizeForCurrentDisplay());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createFloatingWindow();
      if (!token) createLoginWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // 托盘常驻，不自动退出；退出由托盘菜单触发。
});
