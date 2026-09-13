# -*- coding: utf-8 -*-
"""单用途工具：按《验收清单.md》逐项校验一份排班表（只读，不改文件）。

吃两种输入：排班 xlsx（能读底色）和导出/快照 TSV（无底色，跳过值班检查）。
上月用 --prev 传入（xlsx 或快照 TSV 都行），用于跨月衔接校验。

用法：
    python 验排班表.py --xlsx "测试数据\\2026年10月客服排班表.xlsx" --lead 李守耀
    python 验排班表.py --xlsx 本月.xlsx --prev "……\\2026年9月.tsv" --lead 李守耀 --json 报告.json

只负责“判”；怎么改还是人（或别的单一用途小工具）的事。
"""
from __future__ import annotations

import argparse
import csv
import importlib
import json
import math
import re
import sys
from pathlib import Path

from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parent))
_reader = importlib.import_module("读排班表")
SKIP_NAMES = set(_reader.SKIP_NAMES)

GREEN = "E2F0D9"
WORK = ("早", "晚", "行")
KINDS = ("早班", "晚班", "休息")


# ---------------------------------------------------------------- 读表

class XlsxGrid:
    def __init__(self, path: str, sheet: str | None = None):
        wb = load_workbook(path, data_only=True)
        self.ws = wb[sheet] if sheet else wb.active
        self.max_row, self.max_col = self.ws.max_row, self.ws.max_column

    def get(self, r: int, c: int):
        return self.ws.cell(r, c).value

    def color(self, r: int, c: int) -> str:
        fill = self.ws.cell(r, c).fill
        if not fill or fill.fill_type != "solid":
            return ""
        rgb = fill.start_color.rgb
        text = str(rgb) if rgb else ""
        return text[-6:].upper() if len(text) >= 6 else ""


class TsvGrid:
    def __init__(self, path: str):
        with open(path, encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.reader(handle, delimiter="\t"))
        self.rows = [[(c or "").strip() for c in row] for row in rows]
        self.max_row = len(self.rows)
        self.max_col = max((len(r) for r in self.rows), default=0)

    def get(self, r: int, c: int):
        row = self.rows[r - 1] if 0 < r <= self.max_row else []
        value = row[c - 1] if 0 < c <= len(row) else ""
        return value if value != "" else None

    def color(self, r: int, c: int) -> str:
        return ""


def load_grid(path: str, sheet: str | None = None):
    return TsvGrid(path) if path.lower().endswith((".tsv", ".txt")) else XlsxGrid(path, sheet)


def text(value) -> str:
    return str(value).strip() if value is not None else ""


def parse(grid) -> dict:
    header = name_col = None
    day_col: dict[int, int] = {}
    for r in range(1, min(grid.max_row, 20) + 1):
        vals = [text(grid.get(r, c)) for c in range(1, grid.max_col + 1)]
        if "日期" in vals:
            header = r
            name_col = vals.index("日期") + 1
            for i, v in enumerate(vals, start=1):
                if v.isdigit() and 1 <= int(v) <= 31:
                    day_col.setdefault(int(v), i)
            break
    if header is None:
        raise SystemExit("没找到含「日期」的表头行")
    days = sorted(day_col)

    stat_col: dict[str, int] = {}
    for r in range(1, min(grid.max_row, 8) + 1):
        for c in range(name_col + 1, grid.max_col + 1):
            v = text(grid.get(r, c))
            if v in ("剩余", "年假", "休息", "早班", "晚班", "实到", "应到"):
                stat_col.setdefault(v, c)

    employees, group = [], ""
    for r in range(header + 1, grid.max_row + 1):
        g = text(grid.get(r, 1))
        if g in ("售前", "售后"):
            group = g
        name = text(grid.get(r, name_col))
        if not name or name in SKIP_NAMES or name in KINDS or "小计" in name or "汇总" in name:
            continue
        employees.append({
            "row": r, "name": name, "group": group,
            "shifts": {d: text(grid.get(r, day_col[d])) for d in days},
            "colors": {d: grid.color(r, day_col[d]) for d in days},
            "stats": {k: grid.get(r, c) for k, c in stat_col.items()},
        })

    summary: dict[tuple[str, str], dict[int, int]] = {}
    head_count: dict[int, int] = {}
    subtotal: dict[str, dict[str, object]] = {}
    marks = []
    current = ""
    for r in range(header + 1, grid.max_row + 1):
        g1, g2 = text(grid.get(r, 1)), text(grid.get(r, 2))
        if g1 in ("售前", "售后") and g2 in KINDS:
            current, kind = g1, g2
        elif g2 in KINDS:
            kind = g2
        else:
            kind = ""
        if kind and current:
            summary[(current, kind)] = {d: grid.get(r, day_col[d]) for d in days}
        if g2 == "上班人数":
            head_count = {d: grid.get(r, day_col[d]) for d in days}
        whole = [text(grid.get(r, c)) for c in range(1, grid.max_col + 1)]
        for c, v in enumerate(whole, start=1):
            if v.endswith("小计"):
                group_name = v[:-2]
                subtotal[group_name] = {k: grid.get(r, col) for k, col in stat_col.items()}
        for c, v in enumerate(whole, start=1):
            if re.fullmatch(r"\d{1,2}月", v):
                marks.append((r, c, grid.color(r, c)))

    return {"days": days, "employees": employees, "summary": summary,
            "head_count": head_count, "subtotal": subtotal, "marks": marks,
            "stat_col": stat_col}


# ---------------------------------------------------------------- 校验

class Report:
    def __init__(self):
        self.items: list[tuple[str, str, str]] = []

    def add(self, section, level, msg):
        self.items.append((section, level, msg))

    def errors(self):
        return [i for i in self.items if i[1] == "error"]


def groups_of(employees):
    out: dict[str, list[dict]] = {}
    for e in employees:
        out.setdefault(e["group"], []).append(e)
    return out


def check_cross(cur, prev, report, max_streak):
    days, pdays = cur["days"], prev["days"]
    pmap = {e["name"]: e for e in prev["employees"]}
    last = pdays[-1]
    lines = []
    for e in cur["employees"]:
        pe = pmap.get(e["name"])
        if not pe:
            report.add("〇 跨月衔接", "warn", f"{e['name']} 在上月表里没找到，跨月无法核对")
            continue
        pv = pe["shifts"][last]
        trail = 0
        for d in reversed(pdays):
            if pe["shifts"][d] in WORK:
                trail += 1
            else:
                break
        lead = 0
        for d in days:
            if e["shifts"][d] in WORK:
                lead += 1
            else:
                break
        first = e["shifts"][days[0]]
        if pv == "晚" and first == "早":
            report.add("〇 跨月衔接", "error", f"{e['name']} 跨月晚转早（上月末晚 → 本月 1 号早）")
        if pv == "晚" and first not in ("晚", "休", ""):
            pass
        total = trail + lead
        if lead == 0:
            pass  # 本月一上班就休，上月遗留的连上已截止，不再报
        elif total > max_streak + 1:
            report.add("〇 跨月衔接", "error",
                       f"{e['name']} 跨月连上 {trail}(上月) + {lead}(本月) = {total} > {max_streak + 1}")
        elif total > max_streak:
            report.add("〇 跨月衔接", "warn",
                       f"{e['name']} 跨月连上 {trail}+{lead} = {total}（上限 {max_streak}，需说明）")
        lines.append(f"{e['name']} 上月{last}日{pv or '休'}(连{trail}) → 本月头{lead}")
    report.add("〇 跨月衔接", "info", "；".join(lines))


def check_coverage(cur, report, lead):
    for group, members in groups_of(cur["employees"]).items():
        for d in cur["days"]:
            cnt = {code: sum(1 for e in members if e["shifts"][d] == code) for code in ("早", "晚")}
            rest = sum(1 for e in members if e["shifts"][d] == "")
            if group == "售前":
                if cnt["早"] != 2 or cnt["晚"] != 2 or rest != 1:
                    report.add("一 在岗覆盖", "error",
                               f"售前 d{d}: 早{cnt['早']} 晚{cnt['晚']} 休{rest}（应为 2/2/1）")
            else:
                if cnt["早"] < 2:
                    report.add("一 在岗覆盖", "error", f"售后 d{d}: 早{cnt['早']}（保底 2 早）")
                if not 1 <= cnt["晚"] <= 2:
                    report.add("一 在岗覆盖", "warn", f"售后 d{d}: 晚{cnt['晚']}（一般 1~2）")
                others = [e for e in members if e["name"] != lead]
                if lead and any(e["shifts"][d] == "" for e in members if e["name"] == lead):
                    idle = [e["name"] for e in others if e["shifts"][d] == ""]
                    if idle:
                        report.add("一 在岗覆盖", "error",
                                   f"售后 d{d} {lead}休，但 {('、'.join(idle))} 也休（应 4 人全上）")
    if lead:
        work = [e for e in cur["employees"] if e["name"] == lead]
        if work:
            if any(e["shifts"][d] == "晚" for e in work for d in cur["days"]):
                report.add("一 在岗覆盖", "error", f"{lead} 出现晚班（应全早）")


def check_shifts(cur, report, max_streak):
    for e in cur["employees"]:
        days = cur["days"]
        run = 0
        block = 0
        block_start = days[0]
        for i, d in enumerate(days):
            v = e["shifts"][d]
            run = run + 1 if v in WORK else 0
            if run > max_streak + 1:
                report.add("三 连上与休息", "error", f"{e['name']} d{d} 连上 {run} 天（上限 {max_streak}）")
            elif run > max_streak:
                report.add("三 连上与休息", "warn", f"{e['name']} d{d} 连上 {run} 天（需说明）")
            if v == "晚":
                block += 1
            else:
                if block > 4:
                    report.add("二 晚班", "warn",
                               f"{e['name']} d{block_start}~d{days[i - 1]} 连续晚班 {block} 天（一般 ≤4）")
                block = 0
                block_start = d
            if i and e["shifts"][days[i - 1]] == "晚" and v == "早":
                report.add("二 晚班", "error", f"{e['name']} d{d} 晚接早")
        if block > 4:
            report.add("二 晚班", "warn", f"{e['name']} d{block_start}~d{days[-1]} 连续晚班 {block} 天")


def check_duty(cur, report, green):
    if all(not c for e in cur["employees"] for c in e["colors"].values()):
        report.add("四 值班", "warn", "输入没有底色数据（TSV），值班检查跳过")
        return
    sellers = [e for e in cur["employees"] if e["group"] == "售前"]
    if not sellers:
        return
    duty = {}
    for d in cur["days"]:
        duty[d] = [e["name"] for e in sellers if e["colors"][d] == green]
    bad_days = [d for d in cur["days"] if len(duty[d]) != 2]
    for d in bad_days:
        report.add("四 值班", "error", f"d{d} 绿标 {len(duty[d])} 个（每天早、晚各 1）：{duty[d]}")
    for d in cur["days"]:
        if len(duty[d]) == 2:
            shifts = sorted(e["shifts"][d] for e in sellers if e["name"] in duty[d])
            if shifts != ["早", "晚"]:
                report.add("四 值班", "error",
                           f"d{d} 值班班次 {shifts}（应一早在岗、一晚在岗）")
    if not bad_days:
        total = len(cur["days"]) * 2
        n = len(sellers)
        lo, hi = math.floor(total / n), math.ceil(total / n)
        for e in sellers:
            ds = [d for d in cur["days"] if e["name"] in duty[d]]
            for a, b in zip(ds, ds[1:]):
                if b == a + 1:
                    report.add("四 值班", "error", f"{e['name']} d{a}→d{b} 连续两天值班")
            if not lo - 1 <= len(ds) <= hi + 1:
                report.add("四 值班", "error", f"{e['name']} 值班 {len(ds)} 次（应 {lo}~{hi}）")
            elif not lo <= len(ds) <= hi:
                report.add("四 值班", "warn", f"{e['name']} 值班 {len(ds)} 次（一般 {lo}~{hi}）")


def check_marks(cur, report):
    for e in cur["employees"]:
        if any(e["shifts"][d] == "年" for d in cur["days"]):
            report.add("五 特殊标记", "error", f"{e['name']} 出现「年」（年假不主动排）")
    for e in cur["employees"]:
        for d in cur["days"]:
            if e["shifts"][d] in ("行", "年") and e["colors"][d] not in ("", None):
                if e["colors"][d] == GREEN:
                    report.add("五 特殊标记", "error", f"{e['name']} d{d} 休息却带值班绿")
    if not cur["marks"]:
        report.add("五 特殊标记", "warn", "没找到「X月」月份标记")
    else:
        for r, c, color in cur["marks"]:
            if color and color not in ("FF0000",):
                report.add("五 特殊标记", "warn", f"月份标记（行{r}列{c}）颜色 {color} 不是红")


def check_stats(cur, report):
    if not cur["stat_col"]:
        report.add("六 数据统计", "warn", "没找到统计列（剩余/年假/休息/早班/晚班/实到/应到）")
        return
    days = cur["days"]
    for e in cur["employees"]:
        want = {
            "年假": sum(1 for d in days if e["shifts"][d] == "年"),
            "休息": sum(1 for d in days if e["shifts"][d] == ""),
            "早班": sum(1 for d in days if e["shifts"][d] == "早"),
            "晚班": sum(1 for d in days if e["shifts"][d] == "晚"),
            "实到": sum(1 for d in days if e["shifts"][d] in WORK),
            "应到": sum(1 for d in days if e["shifts"][d] not in ("", "年")),
        }
        for key, value in want.items():
            got = e["stats"].get(key)
            if got is None:
                report.add("六 数据统计", "warn", f"{e['name']} 统计「{key}」为空")
            elif str(got).strip() != str(value):
                report.add("六 数据统计", "error",
                           f"{e['name']} 统计「{key}」={got}，矩阵实际 {value}")
    # 汇总行
    for group, members in groups_of(cur["employees"]).items():
        kinds = {"早班": "早", "晚班": "晚", "休息": ""}
        for kind, code in kinds.items():
            row = cur["summary"].get((group, kind))
            if not row:
                report.add("六 数据统计", "warn", f"缺{group}{kind}汇总行")
                continue
            for d in days:
                want = sum(1 for e in members if e["shifts"][d] == code)
                got = row.get(d)
                if got is None or str(got).strip() != str(want):
                    report.add("六 数据统计", "error", f"{group}{kind}汇总 d{d}={got}，实际 {want}")
    # 上班人数
    if not cur["head_count"]:
        report.add("六 数据统计", "warn", "没找到「上班人数」行")
    else:
        for d in days:
            want = sum(1 for e in cur["employees"] if e["shifts"][d] in ("早", "晚"))
            got = cur["head_count"].get(d)
            if got is None or str(got).strip() != str(want):
                report.add("六 数据统计", "error", f"上班人数 d{d}={got}，实际（早+晚）{want}")
    # 小计
    for group, cells in cur["subtotal"].items():
        members = [e for e in cur["employees"] if e["group"] == group]
        if not members:
            continue
        for key in ("年假", "休息", "早班", "晚班"):
            got = cells.get(key)
            if got is None:
                continue
            want = sum(1 for e in members for d in days
                       if e["shifts"][d] == {"年假": "年", "休息": "", "早班": "早", "晚班": "晚"}[key])
            if str(got).strip() != str(want):
                report.add("六 数据统计", "error", f"{group}小计「{key}」={got}，实际 {want}")


def check_carry(cur, prev, report):
    if not prev:
        report.add("六 数据统计", "info", "未给上月表，剩余假继承无法自动核对（人工看清单）")
        return
    pmap = {e["name"]: e for e in prev["employees"]}
    lines = []
    for e in cur["employees"]:
        pe = pmap.get(e["name"])
        now = text(e["stats"].get("剩余"))
        before = text(pe["stats"].get("剩余")) if pe else "?"
        lines.append(f"{e['name']} {before or '—'} → {now or '—'}")
    report.add("六 数据统计", "info", "剩余假继承（上月 → 本月，人工核对）：" + "；".join(lines))


# ---------------------------------------------------------------- 主流程

def main() -> None:
    parser = argparse.ArgumentParser(description="按验收清单校验排班表（只读）")
    parser.add_argument("--xlsx", required=True, help="本月排班表（xlsx 或 TSV）")
    parser.add_argument("--sheet", help="工作表名（默认活动表）")
    parser.add_argument("--prev", help="上月表（xlsx 或快照 TSV），用于跨月衔接校验")
    parser.add_argument("--lead", default="李守耀", help="售后组长（全早、休日全员上班）")
    parser.add_argument("--green", default=GREEN, help=f"值班绿标颜色，默认 {GREEN}")
    parser.add_argument("--max-streak", type=int, default=5, help="连续上班上限（默认 5）")
    parser.add_argument("--json", help="把问题清单写到 JSON")
    args = parser.parse_args()

    cur = parse(load_grid(args.xlsx, args.sheet))
    prev = parse(load_grid(args.prev)) if args.prev else None

    report = Report()
    if prev:
        check_cross(cur, prev, report, args.max_streak)
    else:
        report.add("〇 跨月衔接", "warn", "未给 --prev，跨月衔接未校验（务必人工看）")
    check_coverage(cur, report, args.lead)
    check_shifts(cur, report, args.max_streak)
    check_duty(cur, report, args.green.upper())
    check_marks(cur, report)
    check_stats(cur, report)
    check_carry(cur, prev, report)

    symbol = {"error": "✗", "warn": "!", "info": "·"}
    section = None
    for sec, level, msg in report.items:
        if sec != section:
            print(f"\n== {sec} ==")
            section = sec
        print(f"  {symbol[level]} {msg}")

    errors = report.errors()
    warns = [i for i in report.items if i[1] == "warn"]
    print(f"\n验收结果：{'全部通过（自动项）' if not errors else f'{len(errors)} 项未通过'}"
          + (f"，{len(warns)} 项提醒" if warns else ""))
    print("提醒：剩余假口径、备注、请假/制度类条目请对照《验收清单.md》人工确认。")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump({"errors": [i[2] for i in errors],
                       "warns": [i[2] for i in warns],
                       "items": report.items}, handle, ensure_ascii=False, indent=2)
        print(f"已写出 JSON: {args.json}")


if __name__ == "__main__":
    main()
