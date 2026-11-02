# 美化 Windows 命令行界面（黑底白字 → Windows Terminal 现代外观）

> 2026-11-02 本机实测。一台老 Windows 上的 cmd/PowerShell 默认是白底黑字的传统控制台，改成 Windows Terminal（毛玻璃、One Half Dark、等宽连字字体、竖线光标）。

## 一、先查，别急着装

```powershell
# 装没装、装的哪版
Get-AppxPackage -Name Microsoft.WindowsTerminal | Select-Object Version
# 有没有新版
winget list --id Microsoft.WindowsTerminal
# 配置文件在不在
Test-Path "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"
```

**本机实测结论**：Win10/11 大多已自带 Windows Terminal（本次是 1.24.12741.0，`winget` 里有 1.25）。直接 `winget install` 会走一遍安装但**版本号不一定变**——本机就遇到「已成功安装」但 `Get-AppxPackage` 仍是 1.24，属正常（覆盖安装未完成或需关掉终端后才切版本）。所以：

- **装之前先查**，装过了就别重复装；
- 版本没变**不要反复重试**（红线：失败不自动重试），继续做配置，配置和版本号无关。

## 二、配置文件在哪、只改哪一块

```
%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json
```

**只加 `profiles.defaults`**，别的键一律不动——`defaultProfile`、`profiles.list`、`keybindings` 都是用户自己的设置，动了会丢。

推荐值（本机采用）：

```json
"profiles": {
    "defaults": {
        "antialiasingMode": "cleartype",
        "colorScheme": "One Half Dark",
        "cursorShape": "bar",
        "font": { "face": "Cascadia Mono", "size": 14 },
        "opacity": 92,
        "padding": "8",
        "useAcrylic": true
    },
    "list": [ ...原样保留... ]
}
```

- `colorScheme` 内置可选：`Campbell`（默认）、`One Half Dark`、`One Half Light`、`Solarized Dark`、`Tango Dark`…不用自己写 schemes。
- `opacity` 要配 `useAcrylic: true` 才有毛玻璃；只改 opacity 是纯透明，字会糊。
- `font.face` 必须是**系统里真有的字体名**（下面第三节会验）。

## 三、两个坑（这次踩到的）

### 坑 1：改 JSON 用脚本改，别手改

手改容易少逗号。用 Node/PowerShell 读→改→写，写完整份再用 `JSON.parse` 读一遍当校验：

```javascript
const p = require('path').join(process.env.LOCALAPPDATA,
  'Packages','Microsoft.WindowsTerminal_8wekyb3d8bbwe','LocalState','settings.json');
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(p,'utf8'));           // 先备份原文件
j.profiles.defaults = Object.assign({}, j.profiles.defaults, { /* 上面那些键 */ });
fs.writeFileSync(p, JSON.stringify(j,null,4), 'utf8');
console.log(JSON.stringify(JSON.parse(fs.readFileSync(p,'utf8')).profiles.defaults)); // 回读
```

### 坑 2：查字体别看字体目录，看「已安装字体」列表

`Get-ChildItem C:\Windows\Fonts -Filter '*Cascadia*'` 在本机返回**空**——因为 Cascadia 是随 Windows Terminal 包发的，文件在 `C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_*\`，不在 `C:\Windows\Fonts`。文件不在那里不代表没装。

正确的验法：

```powershell
Add-Type -AssemblyName System.Drawing
(New-Object System.Drawing.Text.InstalledFontCollection).Families |
  Where-Object { $_.Name -like '*Cascadia*' } | Select-Object -ExpandProperty Name
```

本机实测有 `Cascadia Mono`（含 ExtraLight/Light/SemiBold 等字重）→ `font.face: "Cascadia Mono"` 可用。

## 四、把默认终端也换成 Windows Terminal

只装不改默认，双击 bat/exe 弹出来的还是老控制台。改这两个注册表值即可（**用户级，不需要管理员**）：

```powershell
$k = 'HKCU:\Console\%%Startup'
if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
Set-ItemProperty $k -Name DelegationConsole  -Value '{2EACA947-7F5F-4CFA-BA87-8F7FBEEFBE69}' -Type String
Set-ItemProperty $k -Name DelegationTerminal -Value '{E12CFF52-A866-4C77-9A90-F570A7AA2C6B}' -Type String
```

两个 GUID 是固定值：

| 值 | GUID | 含义 |
| --- | --- | --- |
| `DelegationConsole` | `{2EACA947-7F5F-4CFA-BA87-8F7FBEEFBE69}` | Windows Terminal |
| `DelegationTerminal` | `{E12CFF52-A866-4C77-9A90-F570A7AA2C6B}` | Windows Terminal |

**改前先记原值**（本机原值是空＝「让 Windows 决定」，等同于旧控制台）。要退回：把这两个值删掉或置空即可，无需卸载任何东西——这是它「可逆」的原因，改之前值得先 `Get-ItemProperty HKCU:\Console\%%Startup` 存一份。

## 五、验收（不看效果不算完）

1. `JSON.parse` 能过（脚本里已验）；
2. 回读 `profiles.defaults` 的值和你要的一致；
3. `profiles.list` 条数、`defaultProfile` 都没变（本机 7 条 profile 前后一致）；
4. **让人本人打开一次终端看**——字体、透明度、光标、配色是视觉的东西，脚本验不出来。

## 六、给 AI 的一句话

> 装软件先查已装版本；配置只动目标那一段；改注册表前存原值；验收靠人眼。

## 附带：本机当前生效值（2026-11-02）

| 项 | 值 |
| --- | --- |
| Windows Terminal | 1.24.12741.0（winget 有 1.25，装了但版本号未变） |
| 配色 | One Half Dark |
| 字体 | Cascadia Mono 14 |
| 光标 | 竖线（bar） |
| 透明度 | 92% + 毛玻璃 |
| 内边距 | 8 |
| 抗锯齿 | cleartype |
| 默认终端 | Windows Terminal（注册表两项已写） |
| 原配置备份 | `settings.json.bak-20261102`（同目录） |
