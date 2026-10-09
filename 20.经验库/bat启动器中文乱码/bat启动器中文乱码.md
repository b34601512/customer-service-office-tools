# bat 启动器中文乱码

配套脚本：同目录 `启动器示例.bat`、`启动器示例.ps1`（可直接复制改路径）。
实战出处：`D:\桌面\个人软件\21.Qwen-Image-Uncensored\`（ComfyUI 本地文生图启动器）。

## 症状

双击 `.bat` 启动器，窗口里的中文全是乱码，例如：

```
[提示] ComfyUI 已在运行  →  [��ʾ] ComfyUI �������У�
title / echo / 提示语全部花掉
```

## 根因（三个叠加）

1. **CMD 按系统 ANSI 码本（中文 Windows = GBK/936）解析批处理文件**，而文件是
   UTF-8 编码 → 中文字节被按 GBK 解码，必然乱码。`chcp 65001` 写在文件里也**不可靠**：
   CMD 是增量读文件的，首行解析、`title`、嵌套 `start cmd /c` 子窗口的码本时序各不相同。
2. **换行是 LF 不是 CRLF**（用脚本/编辑器默认写出的常见坑），CMD 对纯 LF 批处理的
   解析在标签、`goto`、末行无换行时会出现诡异行为。
3. **`title`、`echo` 里直接写中文 + `start "" /b cmd /c` 开子窗口**：子窗口继承码本
   的时机不受控，即使本窗口对了，子窗口照样乱。

## 规范（用户 2026-09-22 拍板，通用）

| 文件 | 编码 | 换行 | 内容 |
| --- | --- | --- | --- |
| `.bat` / `.cmd` | **UTF-8 无 BOM（尽量纯 ASCII）** | **CRLF** | 只做启动器；必须输出中文时开头加 `chcp 65001>nul` |
| `.ps1`（承载逻辑与中文） | **UTF-8 with BOM（必须带 BOM）** | **CRLF** | 复杂逻辑、所有中文提示都放这里 |

要点：

- bat 里**一个中文字都别写**，文件名可以是中文（NTFS 是 Unicode，没问题），内容不行；
- PowerShell 脚本**必须带 BOM**：无 BOM 的 UTF-8 ps1 在 PS 5.1 下按 ANSI 读，中文注释/字符串一样乱；
- ps1 开头固定三件套，保证控制台输出中文正常：

```powershell
& chcp.com 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
```

## 模板（启动器标准骨架）

`启动器示例.bat`（255 字节，纯 ASCII）：

```bat
@echo off
rem Launcher only. KEEP PURE ASCII - no Chinese here, no BOM.
rem All Chinese UI text lives in start_comfy.ps1 (UTF-8 with BOM, CRLF).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File start_comfy.ps1
if errorlevel 1 pause
```

`启动器示例.ps1` 关键骨架（全文见配套文件）：

```powershell
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
& chcp.com 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

# 1) 端口被占 → 服务已在运行：只开浏览器就退出（防重复启动）
if (Test-TcpPort $port) { Write-Host "[提示] 已在运行：$url" -ForegroundColor Yellow; Start-Process $url; exit 0 }

# 2) 同窗口启动目标 bat（-NoNewWindow 让日志与提示同窗，避免子窗口码本乱码）
$proc = Start-Process -FilePath $env:ComSpec -ArgumentList '/c', $runBat `
                      -WorkingDirectory $wd -NoNewWindow -PassThru

# 3) 轮询端口，就绪后自动开浏览器（比固定 timeout 稳，不会开早了白屏）
while ((Get-Date) -lt $deadline) { if (Test-TcpPort $port) { break }; Start-Sleep -Milliseconds 1500 }
Start-Process $url

# 4) 等服务结束再收尾
$proc.WaitForExit()
Write-Host '[已停止] 服务已关闭。' -ForegroundColor Cyan
```

## 验证方法（三步，都实测过）

1. **编码体检**：

```bash
file 启动器.bat     # 期望: ASCII text, with CRLF line terminators（bat 纯 ASCII）
file 启动器.ps1     # 期望: UTF-8 (with BOM) text, with CRLF line terminators
xxd 启动器.bat | head -1   # 首字节不能是 ef bb bf
```

2. **语法体检**（不用真跑）：

```powershell
$e=$null; [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw -Encoding UTF8 start.ps1),[ref]$e); $e.Count  # 期望 0
```

3. **实跑看中文**：运行后 `[提示]/[就绪]/[已停止]` 显示正常即通过。

## 本轮踩到的额外坑（写 ps1 时必查）

用 Python heredoc 生成 ps1 时，路径里的 `\r`（反斜杠+字母 r）**会被 Python 当成回车转义**，
文件里凭空多一个孤立 CR，PowerShell 拿到的路径直接断掉，而且 `file` 会报
`with CRLF, CR line terminators`（多出来的那个 CR）。规避任选其一：

- 用原始字符串：`r'''...'''`；
- 路径写双反斜杠或改用 `/`、`Join-Path`；
- 生成后必查：

```python
d = open("x.ps1","rb").read()
assert not [i for i,b in enumerate(d) if b==13 and (i+1>=len(d) or d[i+1]!=10)]  # 无孤立CR
assert d[:3] == b"\xef\xbb\xbf"                                                  # 有BOM
```

## 结论

- **bat 乱码 ≈ 中文进了 bat 文件**。一刀切：bat 纯 ASCII，中文全部下沉到带 BOM 的 ps1；
- 输出码本两件套（`chcp.com 65001` + `[Console]::OutputEncoding`）放在 ps1 开头；
- 用 `file`/`xxd` 把编码检查做成提交前的固定动作，别靠肉眼看窗口。
