# 经验包：本机时间悄悄漂了——先查本机，再修「从未启动」的 w32time

> **一句话**：「服务器时间差 20 秒」别急着修服务器——先对表，很可能是**本机**漂了；
> Windows 时间服务 `w32time` 可能**从未启动**（默认 Manual）。
> 修法：启动＋设自启＋重注册＋逐 NTP 源对时；附「不弹 UAC 的静默提权」探针法与一串坑。
>
> 用法：把本文件夹交给你的 AI，说「照这个包排查／修复本机时间」。

---

## 一、症状（真实案例）

- 三方对表都觉得「服务器差 20 秒」，实测发现：**服务器是准的，是本机快了 19 秒**——修错对象就白忙；
- `Get-Service w32time`：**Stopped**（StartType=Manual），`sc qc` 显示**从未启动过**；
- 系统里校时任务还是「Ready」——但服务不跑，任务也拉不动。

## 二、先对表（只读，1 分钟）

用 `工具\查时间偏移.py`（本机 vs 多个公共 HTTP Date）：

```
本机 UTC > 2026-10-13 06:54:38
   +0.3s  https://www.cloudflare.com
   +0.3s  https://www.baidu.com
   +1.1s  https://www.google.com
```

再查服务与源状态（只读）：

```powershell
Get-Service w32time | Select Status,StartType
MSYS_NO_PATHCONV=1 w32tm /query /status    # git-bash 里要禁用路径转换；/query /source 需管理员
```

## 三、修法（需管理员）

```
1. sc config w32time start= auto        # 防它再赖床（注意 start= 后的空格）
2. w32tm /register                      # 重注册时间服务（幂等）
3. Restart-Service w32time
4. w32tm /config /manualpeerlist:"<NTP源>,0x9" /syncfromflags:manual /update
   w32tm /resync /force                 # 逐源试对时，第一个成功的就停
   w32tm /query /source                 # 确认当前源
5. 验收：再跑 工具\查时间偏移.py（≤3 秒为准）；sc qc 确认 AUTO_START
```

## 四、提权与坑（都踩过）

- **静默提权**：有的机器策略允许「无需提示提权」，`Start-Process -Verb RunAs` 直接生效、**不弹 UAC**；
  用探针确认（看 `consent.exe` 是否出现／提权进程写标记文件／`-PassThru -Wait` 拿 ExitCode），别靠猜。
  普通 UAC 机器才需要人工点「是」。
- **多层转义**：bash → `node -e` → PowerShell 内联命令，路径里的 `\t` 会变 TAB、引号层层剥——
  **写成 .cjs/.ps1 文件跑，别内联**。
- **PS 函数参数别叫 `$args`**：撞自动变量，参数乱飘。
- **.ps1 存 UTF-8 BOM**（或纯 ASCII）：丢了 BOM，PS 5.1 按 ANSI 读、中文全乱。
- **git-bash 吃斜杠参数**：`schtasks /tn`、`w32tm /query` 这类 `/xxx` 会被当路径转换——
  命令前缀 `MSYS_NO_PATHCONV=1` 即可。
- 时间类命令输出是 GBK；Python 读取按《PowerShell输出GBK-Python乱码》的口径处理。

## 五、包里有什么

| 文件 | 干嘛 |
|---|---|
| `工具\查时间偏移.py` | 本机 vs 公共 HTTP Date 多源对表（只读、零依赖） |

## 六、实测记录（本机，2026-10-13）

- `Get-Service w32time` → **Running / Automatic**（本机是修复后的状态，10-12 起保持）；
- `w32tm /query /status` → 源 `time.windows.com,0x9`、上次成功同步 `2026/10/13 11:21:46`；
  `w32tm /query /source` 非管理员跑会「拒绝访问 0x80070005」（需提权）；
- 偏移：+0.3s / +0.3s / +1.1s（修复前是 +19 秒，来源现场）。
