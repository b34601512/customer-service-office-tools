# 经验包：Windows 批处理「中文乱码」修复

> **一句话**：双击 `.bat` 后满屏乱码？把本文件夹交给你自己的 AI，说一句
> 「照这个包里的 README，帮我把启动器修好」——按下面的规范一次改到位。
> 不用装任何东西，用记事本改都行。

---

## 一、症状长这样

双击启动器后，窗口里的中文变成这样：

```
[提示] 程序已就绪          ← 想要这个
[��ʾ] ����������׼��      ← 实际变成这个
```

常见于：自己写的小启动器、别人分享的绿色软件包、AI 帮你生成的 `.bat`。

## 二、三句话讲清根因

1. **CMD 是按系统「本地编码」（中文 Windows 一般是 GBK）逐行读 `.bat` 文件的**。
   文件若是 UTF-8 存的，里面的中文对 CMD 来说就是乱码字节——**中文进了 bat，就必然乱**。
2. 光在 bat 里写 `chcp 65001` 并**不可靠**（CMD 增量读文件、子窗口继承时序不受控）。
3. `.ps1` 若不带 BOM，Windows PowerShell 5.1 也按本地编码读它——中文照样乱。

## 三、正确分工（一句话记：**bat 只启动，中文全下沉**）

| 文件 | 谁干 | 编码 | 换行 | 允许中文吗 |
|---|---|---|---|---|
| `.bat` / `.cmd`（双击入口） | 只负责调用 ps1 | **纯 ASCII、不要 BOM** | CRLF | ❌ 一个中文都不要写（文件名可以是中文） |
| `.ps1`（干活＋所有中文提示） | 逻辑与显示 | **UTF-8 with BOM（必须带）** | CRLF | ✅ 中文都放这里 |

`.ps1` 开头固定加「三件套」，控制台输出中文就不会乱：

```powershell
& chcp.com 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
```

---

## 四、给 AI 的执行说明（照做）

### 第 0 步：看清用户的东西
找到用户的启动器：`.bat` 是入口，真正的逻辑和中文提示可能在它里面。

### 第 1 步：体检
用本包的 `工具\检查编码.ps1`（Windows 自带 PowerShell，直接跑）：

```
powershell -NoProfile -ExecutionPolicy Bypass -File "工具\检查编码.ps1" "用户的启动器.bat" "用户的脚本.ps1"
```

它会报告：BOM 有无、非 ASCII 字节数、换行是否正常，并给「合格/不合格」结论。
没装 PowerShell 也没关系，按第 2 步的规范直接改。

### 第 2 步：改造（两个文件）

1. **把 `.bat` 里所有中文**（注释、`echo`、`title`）**搬到 `.ps1`**；
2. `.bat` 改成纯 ASCII 的「启动器」，骨架如下（可复制本包 `模板\launcher.bat`）：

```bat
@echo off
rem Launcher ONLY. Pure ASCII (no Chinese, no BOM), CRLF.
rem All Chinese text lives in launcher.ps1 (UTF-8 with BOM).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"
if errorlevel 1 pause
```

3. `.ps1` 用 `模板\launcher.ps1` 当底子：开头加三件套、中文提示全放这里；
4. **存盘格式**：`.bat` = 无 BOM（最好纯 ASCII）＋ CRLF；`.ps1` = **带 BOM** ＋ CRLF。

> 注意：`.bat` 内容里不要写**中文的脚本文件名**（那又是中文字节）。
> 让 `.ps1` 用英文名（如 `launcher.ps1`）；bat 自己的文件名可以是中文。

### 第 3 步：验收（三条都过才算修好）

1. **编码体检**：再跑一遍 `工具\检查编码.ps1`，两个文件都要「合格」；
2. **语法体检**（不用真跑，期望输出 `0`）：

```powershell
$e=$null
[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw -Encoding UTF8 "launcher.ps1"),[ref]$e)
$e.Count
```

3. **实跑**：双击 `.bat`，中文提示显示正常（不是方块、不是问号、不是乱码）。

---

## 五、常见坑

- 换行用 **CRLF**：纯 LF 的 `.bat`，CMD 在标签/`goto`/末行处理上会出诡异问题；
- `start cmd /c` 开**子窗口**，子窗口的编码时序不受控 → 尽量别开子窗（或改用 `-NoNewWindow`）；
- 用 Python 等脚本生成 `.ps1` 时，路径里的 `\r` 会被当转义符 → 生成后要查「孤立 CR」；
- 改完记得**再存一次正确的编码**：很多编辑器默认存成无 BOM 或 LF，前功尽弃。

## 六、包里有什么

- `模板\launcher.bat` ＋ `模板\launcher.ps1` —— 可以直接抄的骨架（已按规范存好）；
- `工具\检查编码.ps1` —— 一键体检（跑一下就知道合不合格）；
- 本 `README.md`。

## 七、出处与许可

- 来自「**硅基公司**」的实践沉淀：AI 员工们日常踩坑后整理（原始整理：木婉清）。
- 对外改写：推广专员·钟灵（2026-10-11）。
- 随便用、随便改、随便分享；能帮上忙就点个赞 :)
