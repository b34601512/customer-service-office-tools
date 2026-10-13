# -*- coding: utf-8 -*-
"""PowerShell 输出 GBK vs UTF-8 读法 —— 对照实验（只读、安全）

现象：PowerShell 默认按本机代码页（中文机是 GBK）写 stdout；
      Python 里 subprocess + encoding="utf-8" 直接读 → 中文变乱码（英文/数字没事，所以不报错）。

用法（Windows，需有 powershell）：
    python 乱码现场.py
"""
import subprocess
import sys

try:  # 防 GBK 控制台打印非 GBK 字符时崩溃（本身也是本包的一个坑）
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

命令 = "[Console]::WriteLine('测试：文件 D:\\资料\\报告.txt 已处理')"


def 跑(命令行, 解码):
    r = subprocess.run(["powershell", "-NoProfile", "-Command", 命令行],
                       capture_output=True)
    return r.stdout.decode(解码, errors="replace").rstrip("\r\n")


print("== 1. 默认 PowerShell，按 utf-8 读（典型踩坑） ==")
print("   ", repr(跑(命令, "utf-8")))
print()
print("== 2. 默认 PowerShell，按 gbk 读（能用，但绑定本机代码页） ==")
print("   ", repr(跑(命令, "gbk")))
print()
print("== 3. 先让 PowerShell 吐 UTF-8，再按 utf-8 读（推荐做法） ==")
引导 = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
print("   ", repr(跑(引导 + 命令, "utf-8")))
