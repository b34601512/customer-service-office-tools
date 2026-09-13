# -*- coding: utf-8 -*-
"""单用途工具：对比两张排班表（改前/改后、AI 版/人工版、本月/上月、快照对真表）。

用法：
    cd "D:\\桌面\\办公软件\\21.AI自动排班经验"
    python "工具\\对比排班表.py" --a "旧表.xlsx" --b "新表.xlsx"
    python "工具\\对比排班表.py" --a "上月.tsv" --b "本月.xlsx" --only 韩欢欢,麦诺谦 --quiet

- 两边都支持 xlsx / tsv（tsv 没有底色，会自动跳过底色对比）。
- 只读，不改文件；有差异时退出码 1（方便串到别的脚本里）。

看的是六件事：结构（天数/人数）、逐格班次、底色、每日覆盖、统计列、值班次数。
"""
from __future__ import annotations

import argparse
import importlib
import sys
from pathlib import Path

from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parent))
checker = importlib.import_module("验排班表")   # 复用它的读表/parse，别再写一遍

COLORS = {"E2F0D9": "绿(值班)", "FFFF00": "黄(组长)", "BDD7EE": "蓝(售后)",
          "FBE5D6": "橙(公休)", "FFFFFF": "白(显式)"}


class CachedValueGrid:
    """统计/汇总列可能是公式：对比时用缓存值，否则 xlsx 会比出满屏假差异。"""

    def __init__(self, grid, path: str, sheet: str | None = None):
        self.grid = grid
        self.ws = None
        if not isinstance(grid, checker.TsvGrid):
            wb = load_workbook(path, data_only=True)
            self.ws = wb[sheet] if sheet else wb.active
        self.max_row, self.max_col = grid.max_row, grid.max_col

    def get(self, r: int, c: int):
        value = self.grid.get(r, c)
        if self.ws is not None and checker.is_formula(value):
            return self.ws.cell(r, c).value
        return value

    def color(self, r: int, c: int) -> str:
        return self.grid.color(r, c)

    def font_color(self, r: int, c: int) -> str:
        return self.grid.font_color(r, c)

    @property
    def merged(self):
        return getattr(self.grid, "merged", [])


def label(color: str) -> str:
    if not color:
        return "无底色"
    return COLORS.get(color, color)


def counts_of(data, group: str, day: int) -> tuple[int, int, int]:
    people = [e for e in data["employees"] if e["group"] == group]
    early = sum(1 for e in people if e["shifts"].get(day) == "早")
    late = sum(1 for e in people if e["shifts"].get(day) == "晚")
    rest = len(people) - early - late - sum(1 for e in people if e["shifts"].get(day) in ("年", "行"))
    return early, late, rest


def main() -> None:
    ap = argparse.ArgumentParser(description="对比两张排班表（只读）")
    ap.add_argument("--a", required=True, help="A 表：xlsx 或 tsv（旧/基准）")
    ap.add_argument("--b", required=True, help="B 表：xlsx 或 tsv（新/对照）")
    ap.add_argument("--only", help="只比这些人（逗号分隔）")
    ap.add_argument("--quiet", action="store_true", help="只输出汇总")
    args = ap.parse_args()

    grid_a, grid_b = checker.load_grid(args.a), checker.load_grid(args.b)
    data = {"A": checker.parse(CachedValueGrid(grid_a, args.a)),
            "B": checker.parse(CachedValueGrid(grid_b, args.b))}
    color_mode = not isinstance(grid_a, checker.TsvGrid) and not isinstance(grid_b, checker.TsvGrid)
    note = "" if color_mode else "(有 TSV，跳过底色对比)"
    print(f"A = {args.a}\nB = {args.b} {note}")
    print(f"天数 A/B = {len(data['A']['days'])}/{len(data['B']['days'])}   "
          f"人数 A/B = {len(data['A']['employees'])}/{len(data['B']['employees'])}")

    days = sorted(set(data["A"]["days"]) & set(data["B"]["days"]))
    ea = {e["name"]: e for e in data["A"]["employees"]}
    eb = {e["name"]: e for e in data["B"]["employees"]}
    names = [n for n in ea if n in eb]
    if args.only:
        want = {s.strip() for s in args.only.split(",")}
        names = [n for n in names if n in want]

    shift_diff, color_diff = [], []
    for n in names:
        for d in days:
            va, vb = ea[n]["shifts"].get(d, ""), eb[n]["shifts"].get(d, "")
            if va != vb:
                shift_diff.append((n, d, va or "休", vb or "休"))
            ca, cb = ea[n]["colors"].get(d, ""), eb[n]["colors"].get(d, "")
            if color_mode and ca != cb:
                color_diff.append((n, d, label(ca), label(cb)))

    def show(title, rows, line):
        print(f"\n【{title}】{len(rows)} 处")
        if args.quiet or not rows:
            return
        for item in rows[:40]:
            print("  " + line(item))
        if len(rows) > 40:
            print(f"  … 还有 {len(rows) - 40} 处（用 --quiet 只看汇总）")

    show("班次差异", shift_diff,
         lambda t: f"{t[0]:<5} {t[1]:>2}日  {t[2]:>2} → {t[3]:<2}")
    show("底色差异", color_diff,
         lambda t: f"{t[0]:<5} {t[1]:>2}日  {t[2]:<8} → {t[3]}")

    cover = []
    for d in days:
        row = {}
        for g in ("售前", "售后"):
            row[g] = (counts_of(data["A"], g, d), counts_of(data["B"], g, d))
        ha, hb = data["A"]["head_count"].get(d), data["B"]["head_count"].get(d)
        if any(a != b for a, b in row.values()) or str(ha or "") != str(hb or ""):
            cover.append((d, row, ha, hb))
    show("每日覆盖差异", cover,
         lambda t: (f"{t[0]:>2}日  "
                    f"售前早{t[1]['售前'][0][0]}→{t[1]['售前'][1][0]} 晚{t[1]['售前'][0][1]}→{t[1]['售前'][1][1]} 休{t[1]['售前'][0][2]}→{t[1]['售前'][1][2]} | "
                    f"售后早{t[1]['售后'][0][0]}→{t[1]['售后'][1][0]} 晚{t[1]['售后'][0][1]}→{t[1]['售后'][1][1]} 休{t[1]['售后'][0][2]}→{t[1]['售后'][1][2]} | "
                    f"上班人数 {t[2]}→{t[3]}"))

    stat_diff, style_diff = [], []
    keys = sorted(set(data["A"]["stat_col"]) & set(data["B"]["stat_col"]))
    for n in names:
        for k in keys:
            va, vb = ea[n]["stats"].get(k), eb[n]["stats"].get(k)
            if str(va) != str(vb):
                stat_diff.append((n, k, va, vb))
    if color_mode:   # 两边都是 xlsx：看统计列是公式还是写死的数值
        for n in names:
            for k in keys:
                fa = checker.is_formula(grid_a.get(ea[n]["row"], data["A"]["stat_col"][k]))
                fb = checker.is_formula(grid_b.get(eb[n]["row"], data["B"]["stat_col"][k]))
                if fa != fb:
                    style_diff.append((n, k, "公式" if fa else "数值", "公式" if fb else "数值"))
    show("统计列差异", stat_diff, lambda t: f"{t[0]:<5} {t[1]}  {t[2]} → {t[3]}")
    show("统计列写法差异（公式/数值）", style_diff, lambda t: f"{t[0]:<5} {t[1]}  {t[2]} → {t[3]}")

    print("\n【值班次数（绿标）】")
    if not color_mode:
        print("  （有 TSV，无底色可比）")
    for n in names:
        ca = sum(1 for d in days if color_mode and ea[n]["colors"].get(d) == "E2F0D9")
        cb = sum(1 for d in days if color_mode and eb[n]["colors"].get(d) == "E2F0D9")
        flag = "" if ca == cb else "   ← 变了"
        print(f"  {n:<5} {ca:>2} → {cb:>2}{flag}")

    total = len(shift_diff) + len(color_diff) + len(cover) + len(stat_diff) + len(style_diff)
    print(f"\n差异合计：{total} 处（班次 {len(shift_diff)} / 底色 {len(color_diff)} / "
          f"覆盖 {len(cover)} 天 / 统计 {len(stat_diff)} / 写法 {len(style_diff)}）")
    print("结论：" + ("两表一致" if total == 0 else "有差异，见上"))
    sys.exit(0 if total == 0 else 1)


if __name__ == "__main__":
    main()
