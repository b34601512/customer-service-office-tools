# Windows 进程与占用排查

改文件/搬目录/重启服务时最常撞到的三件事：**目录被进程占用（`mv: Permission denied`、`文件正在使用`）、
端口被占、不知道该杀哪个 node/python**。这里记下直接能用的查法，配套两个脚本。

## 配套脚本

| 脚本 | 用途 |
| --- | --- |
| `查进程.ps1` | 列出 node / python / cmd 进程的 PID + 完整命令行（可 `-Match 关键字` 过滤） |
| `结束进程.ps1` | 按 `-Id` 或 `-Match` 关键字结束进程（先 `-WhatIf` 看一眼再真杀） |

```powershell
cd "D:\桌面\办公软件\20.经验大全\Windows进程与占用排查"
powershell -ExecutionPolicy Bypass -File .\查进程.ps1                 # 全部 node/python/cmd
powershell -ExecutionPolicy Bypass -File .\查进程.ps1 -Match 排班     # 只看跟排班有关的
powershell -ExecutionPolicy Bypass -File .\结束进程.ps1 -Match kdocs -WhatIf   # 只预览
powershell -ExecutionPolicy Bypass -File .\结束进程.ps1 -Match kdocs           # 真杀
```

## 为什么不能只按名字杀

`Stop-Process -Name node` 会**把别的项目正在跑的 node 一起杀掉**（本机同时跑着好几个项目的 CLI、
playwright、pi 自己）。所以一定要先看**命令行**，确认是哪个项目的哪个脚本，再按 PID 杀。

## 常用查法（不依赖脚本）

```powershell
# 1. 谁占着目录/文件：先看 node、python
Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='python.exe'" |
  Select-Object ProcessId, @{n='cmd';e={$_.CommandLine}}

# 2. 谁占着端口（比如 9222 浏览器调试端口）
Get-NetTCPConnection -LocalPort 9222 -State Listen | Select-Object OwningProcess
netstat -ano | findstr :9222

# 3. 拿到 PID 看它到底是谁
Get-CimInstance Win32_Process -Filter "ProcessId=12345" | Select-Object Name, CommandLine

# 4. 结束（先 3 确认过）
Stop-Process -Id 12345 -Force
```

## 实测经验

- **目录被占用时先查 playwright 的浏览器进程**：`msedge.exe` / `chrome.exe` 起的持久化画像（如
  `.pi-edge-auto`）会占住目录，node 退了它也还在，必须一起结束。
- `mv/mvdir: Permission denied`、`无法删除：设备或资源忙` 基本都是这个原因，不用重启电脑。
- 结束进程后**等 1~2 秒**再重试搬移/删除：Windows 释放句柄有延迟；仍失败说明还有别的句柄（换个查法找）。
- 找"是谁写的日志/缓存"：`Get-Item <文件> | Select LastWriteTime` 配合进程命令行里的路径对。
- 别用 `taskkill /F /IM node.exe`：等价于全杀，会打断别的项目（含 pi 自己）。
- **.ps1 写中文必须存 UTF-8 **带 BOM****：Windows PowerShell 5.1 没有 BOM 就按 ANSI（GBK）读，中文全变乱码，
  乱码里的引号还会把字符串截断、报“意外的标记”（2026-09-13 实测：`查进程.ps1` 直接语法错）。
  修法：用带 BOM 的 UTF-8 存盘（本目录两个 .ps1 已带）；或者干脆写英文提示避开这个坑。
