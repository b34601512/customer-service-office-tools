#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""查转义 —— 找出 Python 字符串里的「转义事故」（写 Windows 路径最常见的静默坑）。

用法：
  python 查转义.py 你的脚本.py [更多脚本.py ...]     # 扫源码里的字符串字面量
  python 查转义.py --文字 "C:\\2026\\7月"            # 体检「一条字面量」实际会变成什么

判定（简单说）：
  * 字符串【实际值】里出现「不会无缘无故出现」的控制字符
    （0x00-0x08、0x0B-0x0C、0x0E-0x1F、0x7F、0x80-0x9F）→ 一律算事故；
  * 只出现 \\n \\t \\r 等常见控制字符，但字符串长得像路径（盘符/反斜杠/扩展名）
    → 算疑似事故（路径里混进换行/回车/制表的经典现场）。

退出码：0＝没发现事故；1＝发现了（可以当检查门禁用）。
"""
import ast
import re
import sys

try:  # 输出统一走 UTF-8：管道/日志/上层程序读中文都不乱
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

常见 = {"\n": "换行 LF", "\t": "制表 TAB", "\r": "回车 CR", "\v": "垂直制表", "\f": "换页"}


def 是可疑控制(ch: str) -> bool:
    o = ord(ch)
    return o <= 0x08 or o == 0x7F or 0x0B <= o <= 0x0C or 0x0E <= o <= 0x1F or 0x80 <= o <= 0x9F


def 像路径(s: str) -> bool:
    if re.search(r"[A-Za-z]:[\\/]", s) or s.startswith("\\\\"):
        return True
    if re.search(r"[A-Za-z]:", s) and any(是可疑控制(ch) or ch in 常见 for ch in s):
        # 盘符后面直接撞上控制字符（如 "C:\temp" 里的 \t）——就是路径事故现场
        return True
    return bool(re.search(r"[\\/][^\\/\s]*\.[A-Za-z0-9]{1,5}$", s))


def 报字符(ch: str) -> str:
    o = ord(ch)
    if ch in 常见:
        return f"{常见[ch]}（0x{o:02X}）"
    return f"控制字符（0x{o:02X}）"


def 报一处(位置: str, 来源: str, 值: str) -> bool:
    """有事故就打印并返回 True；干净/仅正常换行返回 False。"""
    有控制 = [ch for ch in 值 if 是可疑控制(ch) or ch in 常见]
    if not 有控制:
        return False
    事故 = any(是可疑控制(ch) for ch in 有控制) or (像路径(值) and any(ch in 常见 for ch in 有控制))
    if not 事故:
        return False
    print(f"[发现] {位置}")
    if 来源:
        print(f"       源码：{来源}")
    print(f"       实际值：{值!r}")
    for ch in dict.fromkeys(有控制):
        print(f"         · {报字符(ch)}")
    print("       → 这多半是转义事故：路径字符串请用 r\"…\"（或 pathlib 拼）")
    print("         参考：模板\\安全路径.py；现场重现：复现\\转义现场.py")
    print()
    return True


def 扫文件(路径: str) -> bool:
    文本 = open(路径, encoding="utf-8", errors="replace").read()
    try:
        树 = ast.parse(文本)
    except SyntaxError as e:
        print(f"[跳过] {路径}：语法错误（{e}）——先修语法再看转义")
        return False
    出事 = False
    for 节点 in ast.walk(树):
        if isinstance(节点, ast.Constant) and isinstance(节点.value, str):
            片段 = ast.get_source_segment(文本, 节点) or ""
            if 报一处(f"{路径}:{节点.lineno}", 片段[:100], 节点.value):
                出事 = True
    return 出事


def 体检文字(文字: str) -> bool:
    # 模拟「把它当普通字符串字面量写进源码」，看会被转义成什么
    try:
        值 = ast.literal_eval('"' + 文字.replace('"', '\\"') + '"')
    except (ValueError, SyntaxError) as e:
        print(f"这条字样 Python 都解析不了：{e}")
        return False
    print(f"输入（原样）：{文字}")
    print()
    return 报一处("（--文字 体检）", "", 值)


def 入口(argv: list) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    出事 = False
    if argv[0] == "--文字":
        if len(argv) < 2:
            print('用法：python 查转义.py --文字 "C:\\2026\\7月"')
            return 2
        出事 = 体检文字(" ".join(argv[1:]))
    else:
        for 路径 in argv:
            出事 = 扫文件(路径) or 出事
        if not 出事:
            print("干净：没发现转义事故。")
    return 1 if 出事 else 0


if __name__ == "__main__":
    sys.exit(入口(sys.argv[1:]))
