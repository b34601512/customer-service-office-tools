# 经验包：Windows 计划任务「黑窗一闪」

> **一句话**：定时任务每隔几分钟在屏幕上闪出一个黑色窗口又消失——那是任务计划**直接拉起**
> `powershell.exe` 的瞬间。用 wscript（无窗口的 GUI 程序）包一层当「隐藏娃」，闪窗就没了。
> 用法：把本文件夹交给你自己的 AI，说一句「照这个包，把我这些任务的闪窗治好」——它照着就能干。
> 纯 Windows 自带组件，不用装任何东西。

---

## 一、症状

- 屏幕每隔几分钟闪一个黑窗口，一闪就没；
- 定时任务越多（定时同步、巡检、备份、看门狗…），闪得越勤；
- 任务本身是「跑完就退」的短命令，不占前台，但闪窗很扎眼。

## 二、病根

Windows 任务计划**直接**拉起 `powershell.exe` 时，**即使**带了 `-WindowStyle Hidden`，
控制台窗口仍会**先被创建、再被隐藏**——那一瞬就是「黑窗一闪」。
治本 = 让启动它的「爹」本身就是个没有窗口的程序 → 用 `wscript.exe`。

## 三、治法（两步）

1. 在脚本同目录放一个 `run-hidden.vbs`（直接复制本包 `模板\run-hidden.vbs`）；
2. 任务计划里把「操作」从：

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\…\你的任务.ps1"
```

改成：

```
wscript.exe "C:\…\run-hidden.vbs" "C:\…\你的任务.ps1"
```

（也可以省掉第二个参数：把 `run-hidden.vbs` 放在脚本同目录、脚本命名为 `task.ps1` 即可。）

改完手动跑一次任务，**屏幕不闪、任务照常出结果** = 成功。

## 四、给 AI 的执行说明（照做）

1. **找出嫌疑人**（哪些任务会闪）：

```powershell
Get-ScheduledTask |
  Where-Object { $_.Actions.Execute -match 'powershell|pwsh' } |
  Select-Object TaskName, @{n='脚本';e={$_.Actions.Arguments}} |
  Format-Table -AutoSize
```

2. **改之前先备份**（每个任务一份 XML）：

```
schtasks /Query /TN "<任务名>" /XML > "备份目录\<任务名>.xml"
```

3. **改造该任务**（任务计划程序 GUI 或 PowerShell）：

- 「操作」的**程序**：`powershell.exe` → `wscript.exe`
- 「操作」的**参数**：改成 `"<vbs 完整路径>" "<ps1 完整路径>"`

4. **验证**：

```
schtasks /Run /TN "<任务名>"
schtasks /Query /TN "<任务名>" /V /FO LIST      ← 看「上次结果」= 0，且屏幕不闪
```

5. **不确定就先只改一个任务**，观察一晚，再铺开到全部。

## 五、坑（都踩过）

- `-WindowStyle Hidden` **单用不够**（窗口先创建后隐藏）——必须包一层 wscript；
- `.vbs` 文件**别存 UTF-8 无 BOM 的中文**（wscript 读它会乱码，行为都可能出错）：要么**纯 ASCII**（推荐），要么 UTF-16LE+BOM——本包模板是纯 ASCII，随便复制；
- `sh.Run` 第 3 个参数 `0` = 隐藏窗口；第 4 个 `False` = 不等它（任务立刻结束，不等脚本跑完）；
- 回滚：`schtasks /Create /TN "<任务名>" /XML "<备份.xml>" /F`；
- 自动化脚本里**别在命令行直接等 `wscript`**（可能把外层会话挂住）——用「分离启动」（如 `start`、`Start-Process`）或把 wscript 交给任务计划自己调。

## 六、出处与许可

- 「**硅基公司**」实践沉淀（原始整理：技术·王语嫣；我们的机器上几十个定时任务已全量静默化）。
- 对外改写：推广专员·钟灵（2026-10-11）。
- 随便用、随便改、随便分享。
