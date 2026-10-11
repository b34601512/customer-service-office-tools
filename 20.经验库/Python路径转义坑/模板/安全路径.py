#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""安全路径 —— 写 Windows 路径的正确姿势模板（复制走，改路径就行）。"""
import sys

from pathlib import Path

try:  # 输出统一走 UTF-8：管道/日志/上层程序读中文都不乱
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ✅ 姿势 1：raw 字符串 —— \ 就是 \，不转义
基础 = Path(r"D:\数据")
# ✅ 姿势 2：pathlib 用 / 拼路径，每一段都是普通字符串，不写反斜杠
文件 = 基础 / "2026" / "7月" / "报告.txt"
print("拼出来：", 文件)


# ✅ 姿势 3：从别处拿到的路径「原样」用，别凭记忆重新打一遍
原始 = r"C:\temp\tab.txt"
assert "\\t" in 原始, "这里应该是一个真的反斜杠加字母 t"
assert "\t" not in 原始, "这里是制表符——说明原始路径已经被转义吃过了"


def 回读验证(p) -> str:
    """生成路径后回读一次：repr 会把看不见的字符打出来（\x82、\r、\t…）"""
    s = str(p)
    print("repr 回读：", repr(s))
    return s


回读验证(文件)

# 需要「双反斜杠」的场合：写 JSON、写正则、拼命令行参数
命令行版 = str(文件).replace("\\", "\\\\")
print("要转义时：", 命令行版)

# ❌ 反例（别这么写——下次运行或换台机器就炸，而且不报错）：
#    坏 = "D:\数据\2026\7月\报告.txt"    # \2026 变 0x82 …（看 复现\转义现场.py）
#    坏 = "C:\reports\new"               # \r \n 变成回车换行，路径断成两截
#    坏 = "C:\temp\task.txt"             # \t 变成制表符

print("自检通过：路径没有被转义吃掉。")
