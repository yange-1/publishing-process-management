; 卸载时清理开机启动项（与 main.cjs 中 setLoginItemSettings 的 name 一致）。
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "校了么桌面伴侣"
!macroend
