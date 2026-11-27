"""巡检结论 → 直接打在终端（木婉清本窗）的**带框表格**，自动带序号。

用法：
  python 工具/巡检结论打印.py                 # 打 .state 里最新的那份
  python 工具/巡检结论打印.py <数据.json> [--宽 96]
  python 工具/巡检结论打印.py --自检 [<数据.json>]   # 只校验数据合不合口径，不打印

口径（黎路遥 2026-11-23 陆续定的，脚本里已写死，不用每次再说）：
  ① 打在本窗，不另开窗、不发截图、不发 Excel；
  ② 带框表格，中文按双宽，超长在标点处折行；
  ③ **每行有序号**，全篇连续编号，方便他说「第 7 项」；
  ④ 分板块，每块写负责人（谁跑的）；
  ⑤ 结论列只用三种符号：✔ 过关／✘ 没做成／⏳ 处理中（还没出结果、不是「未确认」）；
  ⑥ 结果一列只写一行结论，不写过程、不写 issue 编号；
  ⑦ 末尾一行合计：多少项、几个 √、几个 ×、几个 …。
数据不合口径 → 直接报错退出（2），不许打出半成品。
"""
import json
import sys
import unicodedata
from pathlib import Path

# Windows 控制台默认 GBK，遇到 ✔/⏳ 会 UnicodeEncodeError 并打出半截表
# （2026-11-25 实际撞上，得手动加 PYTHONIOENCODING=utf-8 才能出全）。这里自己抬成 UTF-8，别再让调用方记参数。
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
标记 = ("✔", "✘", "⏳")
断点 = "；，。、：!？ ／/）】」"


def 宽(s: str) -> int:
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in str(s))


def 补(s: str, n: int) -> str:
    s = str(s)
    return s + " " * max(0, n - 宽(s))


def 折行(s: str, n: int) -> list:
    """按显示宽度折行；能在标点处断开就断在标点后，不把数字/词劈开。"""
    s = str(s)
    out = []
    while 宽(s) > n:
        acc, w, cut = "", 0, None
        for i, ch in enumerate(s):
            cw = 2 if unicodedata.east_asian_width(ch) in "WF" else 1
            if w + cw > n:
                break
            acc += ch
            w += cw
            if ch in 断点 and i + 1 < len(s):
                cut = i + 1
        切 = cut if cut and 宽(acc[:cut]) >= n // 2 else len(acc)
        out.append(s[:切].rstrip())
        s = s[切:].lstrip()
    out.append(s)
    return out or [""]


def 最新() -> Path:
    候选 = sorted((ROOT / ".state").glob("巡检结论-*.json"))
    if not 候选:
        sys.exit("没找到 .state/巡检结论-*.json")
    return 候选[-1]


def 校验(d: dict) -> list:
    """按口径检查数据，返回问题清单。"""
    问题 = []
    if not d.get("标题"):
        问题.append("缺「标题」")
    for bi, b in enumerate(d.get("板块", []), 1):
        if not b.get("名"):
            问题.append(f"第 {bi} 个板块缺「名」")
        if not b.get("负责人"):
            问题.append(f"板块「{b.get('名', bi)}」缺「负责人」（谁跑的）")
        for ri, r in enumerate(b.get("行", []), 1):
            if len(r) < 3:
                问题.append(f"板块「{b.get('名', bi)}」第 {ri} 行不足三列（项目/结论/结果）")
                continue
            if str(r[1]).strip() not in 标记:
                问题.append(f"板块「{b.get('名', bi)}」第 {ri} 行结论是「{r[1]}」，只许 {'/'.join(标记)}")
            if not str(r[2]).strip():
                问题.append(f"板块「{b.get('名', bi)}」第 {ri} 行结果为空")
    if not d.get("板块"):
        问题.append("一个板块都没有")
    return 问题


def 画表(表头: list, 行: list, 总宽: int) -> list:
    内宽 = 总宽 - 4 * 2
    列宽 = [0, 0, 3, 0]
    列宽[1] = max(4, max(宽(str(r[1])) for r in [表头] + 行))
    列宽[2] = max(4, max(宽(str(r[2])) for r in [表头] + 行))
    剩 = 内宽 - 列宽[1] - 列宽[2]
    列宽[0] = 4
    列宽[3] = max(20, 剩 - 列宽[0])

    折 = []
    for r in 行:
        c0 = 折行(r[0], 列宽[0])
        c3 = 折行(r[3], 列宽[3])
        n = max(len(c0), 1, len(c3))
        c0 += [""] * (n - len(c0))
        c3 += [""] * (n - len(c3))
        折.append([(a, r[1] if i == 0 else "", r[2] if i == 0 else "", b)
                  for i, (a, b) in enumerate(zip(c0, c3))])

    线 = lambda l, m, r: l + m.join("─" * (w + 2) for w in 列宽) + r
    行文 = lambda c: "│ " + " │ ".join(补(x, 列宽[i]) for i, x in enumerate(c)) + " │"
    出 = [线("┌", "┬", "┐"), 行文(表头), 线("├", "┼", "┤")]
    for ri, 段 in enumerate(折):
        for a, m, h, b in 段:
            出.append(行文([a, m, h, b]))
        if ri != len(折) - 1:
            出.append(线("├", "┼", "┤"))
    出.append(线("└", "┴", "┘"))
    return 出


def main() -> int:
    argv = sys.argv[1:]
    总宽 = 100
    if "--宽" in argv:
        i = argv.index("--宽")
        总宽 = int(argv[i + 1])
        del argv[i:i + 2]
    自检 = "--自检" in argv
    argv = [a for a in argv if not a.startswith("--")]
    p = Path(argv[0]) if argv else 最新()
    d = json.loads(p.read_text(encoding="utf-8"))

    问题 = 校验(d)
    if 问题:
        print("数据不合口径，不打表：", file=sys.stderr)
        for x in 问题:
            print("  · " + x, file=sys.stderr)
        return 2
    if 自检:
        n = sum(len(b.get("行", [])) for b in d["板块"])
        print(f"合口径：{len(d['板块'])} 个板块、{n} 行、{p.name}")
        return 0

    print(d["标题"])
    if d.get("副标题"):
        print(d["副标题"])

    序号 = 0
    计 = {m: 0 for m in 标记}
    for b in d["板块"]:
        行 = []
        for r in b.get("行", []):
            序号 += 1
            m = str(r[1]).strip()
            计[m] = 计.get(m, 0) + 1
            行.append([序号, r[0], m, r[2]])
        print(f"\n【{b['名']}】　负责人：{b['负责人']}")
        for ln in 画表(["号", "项目", "结论", "结果"], 行, 总宽):
            print(ln)

    合计 = f"合计 {序号} 项：✔ {计.get('✔', 0)}　✘ {计.get('✘', 0)}　⏳ {计.get('⏳', 0)}"
    print()
    print(合计)
    return 0


if __name__ == "__main__":
    sys.exit(main())
