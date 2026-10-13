# 经验包：起子进程不带 windowsHide，屏幕上弹「空白黑窗」

> **一句话**：Windows 上起一个控制台子进程（Node `spawn`/`exec` 拉 python、cmd、服务脚本…），
> 默认会新开一扇控制台窗——进程不打印输出时，看着就是**一扇空白黑窗**（用户/老板会直接来问）。
> 修法：`spawn(..., { windowsHide: true })`；已经弹出来的窗**不必停服务**，用 `ShowWindow(hwnd, 0)` 藏掉。
>
> 用法：把本文件夹交给你的 AI，说「照这个包，把我启动脚本里的弹窗收掉」。
> 与已入库的《Windows计划任务黑窗一闪》**互补**：那篇治「计划任务拉 powershell 闪一下」，本篇治「程序自己起子进程多出窗」。

---

## 一、症状（真实案例）

一个本地服务的启动脚本一跑，屏幕上马上**多出两扇空白黑窗**（标题是 python.exe 的路径）；
用户 20:10 直接发问：「为什么启动了 2 个空白的黑窗？」

- 窗是空的：因为服务不往控制台打印；
- 服务本身是好的、功能都正常——纯观感事故，但**很扎眼**。

## 二、根因

Windows 的控制台程序默认有自己的控制台窗口；Node `spawn`/`exec` 默认**不隐藏**它。
`detached: true` 之类的启动方式也一样——不写 `windowsHide` 就按系统默认来。

```
node 父进程 ──spawn(无 windowsHide)──▶ 控制台子进程 ──▶ 新控制台窗（空白黑窗）
            └─spawn({windowsHide:true})──▶ 跑在后台，零窗
```

## 三、修法

**A. 以后不再弹**：起子进程时固定加 `windowsHide: true`，输出收进日志文件：

```js
const 子 = spawn(命令, 参数, {
  cwd: ...,
  detached: true,
  windowsHide: true,            // ★ 不弹可见黑窗
  stdio: ["ignore", 出, 错],     // 输出进文件，不顺端口漏
});
子.unref();                     // 父进程退出不带走它
```

**B. 已经弹出来的存量窗**：不用停服务——把窗**藏**掉即可（进程不动、服务不断）：

```powershell
# 找到目标窗句柄后（先按标题/类核对，宁漏勿错）：
[WinApi]::ShowWindow($hWnd, 0)   # 0 = SW_HIDE，藏窗
```

先列出窗口核对（含无标题的）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 工具\列可见窗.ps1
```

> ⚠️ 列全部窗要用 **EnumWindows**；`Get-Process` 的 `MainWindowTitle` 只给「活动页」的标题，
> 同进程多窗/多标签时看不全。工具脚本已备（纯 ASCII，防 PS 5.1 中文编码坑）。

## 四、给 AI 的执行说明（照做）

1. **找**：搜启动脚本里的 `spawn` / `exec` / `execFile`（尤其 `detached: true` 的）；
2. **改**：加 `windowsHide: true`，`stdio` 收口到日志文件（别静默丢，见《Node子进程stderr漏出》）；
3. **藏存量窗**：写「按标题关键字找窗→确认→ShowWindow(0)」的隐藏脚本；一次也别盲藏（先核对再动手）；
4. **验证**：
   - 重启服务，屏幕上零新增窗；
   - `工具\列可见窗.ps1` 前后对比数量/标题；
   - 服务端口照常可用。

## 五、包里有什么

| 文件 | 干嘛 |
|---|---|
| `复现\对比实验.js` | 不带/带 windowsHide 各起一个短命令，自动数可见窗（请盯屏幕看差异） |
| `模板\静默起进程.cjs` | 静默起进程封装（windowsHide＋日志文件＋unref，复制即用） |
| `工具\列可见窗.ps1` | EnumWindows 列出全部可见窗（句柄/类/标题），排查幽灵窗用 |

## 六、实测记录（本机 Windows，2026-10-13）

- `node 模板\静默起进程.cjs`：子进程起成功、全程无新窗；日志最后一行 `hidden-child-ok`。
- `powershell -File 工具\列可见窗.ps1`：正确列出全部 38 扇可见窗（含 `CASCADIA_HOSTING_WINDOW_CLASS` 等类名）；
  小提示：中文标题在 GBK 控制台可能显示乱码，用 UTF-8 终端看。
- `node 复现\对比实验.js`：本机在自动化（无交互控制台）上下文里，两轮「运行中」计数都是 38——
  **这种环境 Windows 不给弹窗，看不到对照**；要现场看差异，请从普通终端（或双击）跑。
  弹窗那一半的现场实证见来源案例（交互终端下启动服务，当场多出两扇空白黑窗）。
- 附带坑（来源实测）：给 Windows PowerShell 5.1 写 `.ps1` 脚本，文件要么**纯 ASCII**、要么**带 BOM**；
  无 BOM 的中文会被按 GBK 读、连引号都可能被撕坏。
