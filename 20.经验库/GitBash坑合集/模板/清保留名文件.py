# -*- coding: utf-8 -*-
"""清理 Windows 保留名文件（nul / con / aux / prn / com1-5 / lpt1-3…）。

做法：先读出内容备份到 <原名>.内容备份.bin，再用 \\?\ 长路径前缀删除（不硬丢内容）。
要点：拼 \\?\ 路径时，对「目录」取绝对路径（安全）；绝不要对保留名本身调 abspath——
     Windows 会把它解析成 \\.\nul 设备路径，加了 \\?\ 前缀反而打不开。
用法：python 清保留名文件.py [要清理的目录（默认当前目录）]
"""
import os
import sys

保留名 = ("nul", "con", "aux", "prn",
        "com1", "com2", "com3", "com4", "com5",
        "lpt1", "lpt2", "lpt3")


def 清(目录):
    基 = os.path.abspath(目录)  # 对目录 abspath 没问题
    动了 = 0
    for 名 in os.listdir(基):
        if 名.split(".")[0].lower() not in 保留名:
            continue
        长 = "\\\\?\\" + 基 + "\\" + 名
        try:
            数据 = open(长, "rb").read()
            备份 = os.path.join(基, 名 + ".内容备份.bin")
            open(备份, "wb").write(数据)
            os.remove(长)
            print("已备份→ %s ，并删除了 %s" % (备份, 名))
            动了 += 1
        except Exception as e:
            print("没动：%s（%r）" % (名, e))
    if not 动了:
        print("没有发现（或未能处理）保留名文件。")


if __name__ == "__main__":
    清(sys.argv[1] if len(sys.argv) > 1 else os.getcwd())
