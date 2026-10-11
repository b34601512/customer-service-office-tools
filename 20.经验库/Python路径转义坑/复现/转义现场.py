#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""转义现场 —— 重现「路径里的反斜杠被转义吃掉」的真实现场（纯字符串演示，不碰磁盘）。

跑法：python 复现\\转义现场.py
"""
import sys

try:  # 输出统一走 UTF-8：管道/日志/上层程序读中文都不乱
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def 展示(值: str) -> str:
    """把看不见的控制字符标出来（用 ASCII 记号，任何控制台都能显示）"""
    出 = []
    for ch in 值:
        o = ord(ch)
        if o < 32 or o == 127 or 0x80 <= o <= 0x9F:
            出.append(f"[0x{o:02X}]")
        else:
            出.append(ch)
    return "".join(出)


def 现场(标题: str, 源码里这么写: str, 实际值: str, 修好的写法: str) -> None:
    print("-" * 66)
    print("现场：" + 标题)
    print("  源码里这么写 ：", 源码里这么写)
    print("  Python 实际拿到：", repr(实际值))
    print("  （肉眼所见的怪串）：", 展示(实际值))
    print("  修好的写法 ：", 修好的写法)
    print()


print("=" * 66)
print("转义现场 —— 路径里的 \\ 是怎么被吃掉的")
print("=" * 66)

现场(
    "路径里的 \\2026 —— 被当成「八进制转义」",
    '"D:\\2026\\7"  <- 目录名是 2026、7',
    "D:\2026\7",
    'r"D:\\2026\\7"',
)

现场(
    "路径里的 \\27 —— 八进制 27 = 控制字符 0x17（看不见；ESC 是八进制 33）",
    '"C:\\27.清单.txt"  <- 目录名是 27.清单.txt',
    "C:\27.清单.txt",
    'r"C:\\27.清单.txt"',
)

现场(
    "路径里的 \\7 —— 八进制 7 = 响铃（屏幕上看不见，还会嘀一声）",
    '"E:\\7月数据"  <- 目录名是 7月数据',
    "E:\7月数据",
    'r"E:\\7月数据"',
)

现场(
    "路径里的 \\t —— 变成制表符，字符被吃",
    '"C:\\temp\\task.txt"  <- 目录 temp、文件 task.txt',
    "C:\temp\task.txt",
    'r"C:\\temp\\task.txt"',
)

现场(
    "路径里的 \\r \\n —— 变成回车+换行，路径断成两截",
    '"C:\\reports\\new"  <- 目录 reports、子目录 new',
    "C:\reports\new",
    'r"C:\\reports\\new"',
)

print("三条规矩：")
print("  1. 路径字符串一律带 r：r\"C:\\…\"")
print("  2. 拼路径用 pathlib：Path(r\"C:\\…\") / \"子目录\" / \"文件.txt\"")
print("  3. 写完必须回读验证：print(repr(路径)) —— 看不见的字符会现形")
