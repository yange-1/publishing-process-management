// electron-builder 配置（含 afterPack：用独立 rcedit 设置 exe 图标与版本信息，不做代码签名）
"use strict";

const { join } = require("path");
const { rcedit } = require("rcedit");

const config = {
  appId: "com.xiaolemao.desktop-companion",
  productName: "校了么桌面伴侣",
  asar: true,
  directories: {
    output: "dist",
    buildResources: "build",
  },
  files: [
    "main.cjs",
    "preload.cjs",
    "window-size.js",
    "settings.cjs",
    "server-url.cjs",
    "tray-icon.png",
    "renderer/**/*",
  ],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build/icon.ico",
    // 关闭 electron-builder 内置的 exe 编辑/签名（避免 winCodeSign 符号链接解压失败），
    // 改由 afterPack 用独立 rcedit 设置 exe 图标与版本信息。
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: true,
    shortcutName: "校了么桌面伴侣",
    installerIcon: "build/icon.ico",
    uninstallerIcon: "build/icon.ico",
    include: "build/installer.nsh",
    deleteAppDataOnUninstall: true,
  },
  afterPack: async (context) => {
    const exePath = join(context.appOutDir, "校了么桌面伴侣.exe");
    const iconPath = join(__dirname, "build", "icon.ico");
    await rcedit(exePath, {
      icon: iconPath,
      "version-string": {
        ProductName: "校了么桌面伴侣",
        FileDescription: "校了么桌面伴侣",
        InternalName: "校了么桌面伴侣",
        OriginalFilename: "校了么桌面伴侣.exe",
        CompanyName: "校了么",
      },
      "file-version": "0.1.0",
      "product-version": "0.1.0",
    });
    console.log("afterPack: 已设置 exe 图标与版本信息");
  },
};

module.exports = config;
