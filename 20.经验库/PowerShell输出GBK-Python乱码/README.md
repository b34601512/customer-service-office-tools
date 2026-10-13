# 经验包：PowerShell 输出是 GBK，Python 按 UTF-8 读会乱码

> **一句话**：中文 Windows 上 PowerShell 默认按本机代码页（GBK）写 stdout；
> Python 用 `encoding="utf-8"` 直接读 → 中文变乱码，而且**不报错、静默匹配失败**，最难查。
> 修法：先让 PowerShell `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`，再按 UTF-8 读。
>
> 用法：把本文件夹交给你的 AI，说「照这个包，把我代码里读 PowerShell 输出的地方收口」。

---

## 一、症状（真实案例）

一个用 `subprocess` 读 PowerShell 输出的脚本（扫描进程命令行里的中文路径/名字）：

- 中文全变乱码（见第五节实测第 1 项）；
- 英文、数字正常——**所以不报错**；`名字 in 命令行` 永远匹配不上：
  - 第一次误判「没有这个人」；
  - 第二次误判「进程没了」——其实程序活得好好的，只是「认不出它」；
- 结论：**静默的混乱比崩溃更危险**（会顺着错误结论动手）。

## 二、根因

Windows 上 PowerShell 默认按**本机代码页**（中文机 = GBK/cp936）写 stdout；
Python 若按 UTF-8 解，中文就烂：

```
PowerShell stdout ──GBK 字节──▶ Python 按 UTF-8 解 ──▶ 乱码（还静默！）
```

同理的另一个方向：Python 往 GBK 控制台打印 `✅`/`⬜` 这类非 GBK 字符会
`UnicodeEncodeError` 直接掐断脚本（老坑，别忽略）。

## 三、修法（两条）

1. **标准做法**：让 PowerShell 先吐 UTF-8，Python 按 UTF-8 读：

   ```python
   [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; <原命令>
   ```

   配套封装见 `模板\安全读PowerShell.py`。
   （按 GBK 解也能用，但绑定本机代码页、跨机器不保险，不推荐。）
2. **别只靠一个信号下结论**：文本匹配认不出时，退一步用独立信号交叉验证
   （PID、心跳文件、端口…），两个信号对上再动手；「宁可跳过，也别乱动」。

## 四、给 AI 的执行说明（照做）

1. 搜代码里 `subprocess` **读 PowerShell 输出**的地方；
2. 加引导串 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; `，
   解码固定 `utf-8`，失败信息放异常/日志、别静默；
3. 验证：
   - 跑 `复现\乱码现场.py`，对照三项输出（乱 → 可用 → 推荐）；
   - 跑 `模板\安全读PowerShell.py`，能原样拿回中文＝好；
4. Python 自己打印非 GBK 符号（✅/⬜）时：加 `PYTHONIOENCODING=utf-8` 环境变量，
   或干脆用 `[OK]`/`[--]` 这种 ASCII 标记。

## 五、包里有什么

| 文件 | 干嘛 |
|---|---|
| `复现\乱码现场.py` | 三项对照：utf-8 读（乱）→ gbk 读（能用）→ 先切 UTF-8 再读（推荐） |
| `模板\安全读PowerShell.py` | 安全读封装（复制即用；失败抛错、不静默） |

## 六、实测记录（本机 Python 3.10.11，2026-10-13）

`python 复现\乱码现场.py`：

```
== 1. 默认 PowerShell，按 utf-8 读（典型踩坑） ==
    '���ԣ��ļ� D:\����\����.txt �Ѵ���'
== 2. 默认 PowerShell，按 gbk 读（能用，但绑定本机代码页） ==
    '测试：文件 D:\资料\报告.txt 已处理'
== 3. 先让 PowerShell 吐 UTF-8，再按 utf-8 读（推荐做法） ==
    '测试：文件 D:\资料\报告.txt 已处理'
```

`python 模板\安全读PowerShell.py`（自测）：

```
拿到： 中文测试：一切正常
```
