# 经验包：Windows 进程与占用排查

> **一句话**：文件删不掉 / 目录搬不动 / 端口被占——**不用重启电脑**，查清「谁占着」，再定点处理。
> 用法：把本文件夹交给你自己的 AI，说一句「按这个包帮我查是谁占着 XXX」——它照着就能干。
> 全用 Windows 自带 PowerShell，不用装任何东西。

---

## 一、什么时候用

- 删文件 / 搬目录报「正在使用」「Permission denied」「设备或资源忙」；
- 启动服务报「端口已被占用」（如 3000、8080、9222）；
- 想知道电脑上哪个程序在偷跑（node / python / 浏览器自动化）。

## 二、包里的工具

| 文件 | 干嘛 |
|---|---|
| `工具\查进程.ps1` | 列出 node / python / cmd / 浏览器进程的 PID ＋ 命令行（`-Match 关键字` 过滤，`-Full` 看完整命令行） |
| `工具\结束进程.ps1` | 按 PID 或命令行关键字结束进程（**必须给条件**；支持 `-WhatIf` 先预览） |

## 三、给 AI 的执行说明（照做）

> ⚠️ **安全铁规矩**：先查后杀；**杀之前必须让用户确认**；绝不允许无参数全杀，也绝不用
> `taskkill /F /IM node.exe`（会把别的项目一起杀掉）。

1. **查**（二选一）：

```powershell
# 用包里的脚本（可加 -Match 关键字过滤；-Full 看完整命令行）
powershell -NoProfile -ExecutionPolicy Bypass -File "工具\查进程.ps1" -Match <关键字>

# 或原生查法：
Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='python.exe'" |
  Select-Object ProcessId, @{n='cmd';e={$_.CommandLine}}          # 谁占着目录/文件
Get-NetTCPConnection -LocalPort 9222 -State Listen | Select-Object OwningProcess   # 谁占着端口
Get-CimInstance Win32_Process -Filter "ProcessId=12345" | Select-Object Name, CommandLine  # 看身份
```

2. **认人**：看**命令行**确认是哪个项目哪个脚本（别只看进程名）；
3. **预览**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "工具\结束进程.ps1" -Match <关键字> -WhatIf
```

给用户看「将结束 PID=…」；**用户确认后**再去掉 `-WhatIf` 真杀（或 `-Id <PID>`）；
4. **收尾**：等 1~2 秒再重试被占用的操作（Windows 释放句柄有延迟）。

## 四、为什么不能只按名字杀

`Stop-Process -Name node` 会把**所有** node 进程杀掉——可能包括：用户正在跑的项目、浏览器自动化、
甚至**正在帮用户干活的 AI 自己**。所以：先看命令行，按 PID 杀。

## 五、常见坑

- 目录被占用时，先查**浏览器自动化**进程：`msedge.exe` / `chrome.exe` 起的持久化画像
  （形如 `.xxx-edge-auto`）会占住目录——主程序退了它还在，要一起处理；
- 结束进程后立刻重试可能仍失败：等 1~2 秒；仍失败说明还有别的句柄（换个查法找）；
- `.ps1` 写中文必须存 **UTF-8 带 BOM**，不然 PowerShell 5.1 按本地编码读，中文乱码甚至语法报错
  ——本包两个脚本已按规范存好，可直接用；
- 别用 `taskkill /F /IM`：等价于全杀；
- 两个脚本开头已把控制台切到 UTF-8（`chcp 65001`），中文结果可以直接看、被 AI 读、存成文件也不乱（老系统上只有字体不支持中文时才会显示方块）。

## 六、出处与许可

- 来自「**硅基公司**」的实践沉淀（原始整理：木婉清）。
- 对外改写：推广专员·钟灵（2026-10-11）。
- 随便用、随便改、随便分享。
