# -*- coding: utf-8 -*-
"""造反例：从主表生成「验排班表.py」的负向/边界测试表（专门用来证明校验工具真的能抓到错）。

用法：
    cd "D:\\桌面\\办公软件\\21.AI自动排班经验"
    python "测试数据\\反例\\造反例.py"

生成（就地覆盖本目录）：
    bad.xlsx      统计/汇总/小计/上班人数 全改成写死的数值 + 5 处错（含韩欢欢晚班 99）
    bad2.xlsx     公式/口径改坏：休息不引用天数、年假写成本月计数、应到/小计/天数/上班人数写死
    bad3.xlsx     售后把当班每个人都涂浅蓝（当班≠值班；每班只能标 1 人）
    bad4.xlsx     结转列写错：剩余不按「上月结转 + 应休 − 实休」、年假余额清零
    bad5.xlsx     表头错：月份横幅没合并 + 周六全标红（大小周不交替）、周日没标红
    month30.xlsx  清掉 31 号列 → 模拟 30 天的月份（验公式的范围会不会把 31 号空白算成休息）

生成的 xlsx 按仓库约定不入库（.gitignore 排除 *.xlsx），需要时重跑本脚本即可。
"""
from __future__ import annotations

import shutil
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "2026年10月客服排班表.xlsx"
STAT_COLS = range(35, 42)      # AI..AO 剩余/年假/休息/早班/晚班/实到/应到
PEOPLE_ROWS = [4, 5, 6, 7, 8, 11, 12, 13, 14, 15]
SUM_ROWS = [18, 19, 20, 22, 23, 24]
HEAD_ROW = 26


def copy(name: str) -> str:
    out = HERE / name
    shutil.copyfile(SRC, out)
    return str(out)


def make_bad() -> str:
    """统计/汇总/小计/上班人数全写死数值（缓存值），其中一处故意写错。"""
    path = copy("bad.xlsx")
    values = load_workbook(SRC, data_only=True).active
    wb = load_workbook(path)
    ws = wb.active
    for r in PEOPLE_ROWS:
        for c in STAT_COLS:
            ws.cell(r, c).value = values.cell(r, c).value
    for c in range(3, 34):                     # 汇总行 + 上班人数：数值
        for r in SUM_ROWS + [HEAD_ROW]:
            ws.cell(r, c).value = values.cell(r, c).value
    for c in range(36, 40):                    # 小计：数值
        ws.cell(9, c).value = values.cell(9, c).value
    ws["AM4"] = 99                             # ① 韩欢欢晚班 99 天
    ws["C18"] = 3                              # ② 售前早班汇总 d1 写 3（实际 2）
    ws["G26"] = 9                              # ③ 上班人数 d5 写 9（实际 7）
    ws["AK9"] = 30                             # ④ 售前小计休息 30（实际 31）
    for r in PEOPLE_ROWS:                      # ⑤ 应到全组写 24（政策口径应为 25）
        ws.cell(r, 41).value = 24
    wb.save(path)
    return path


def make_bad2() -> str:
    """公式/口径篡改：结构不对、写死数值、年假写成计数。"""
    path = copy("bad2.xlsx")
    wb = load_workbook(path)
    ws = wb.active
    ws["AK4"] = "=COUNTBLANK(C4:AG4)"          # ① 休息不引用「本月天数」：30 天月份会把空白列算成休息
    ws["AJ4"] = '=COUNTIF($C4:$AG4,"年")'     # ② 年假写成本月计数（应为上月结转的余额）
    ws["AO4"] = 24                             # ③ 应到写死数值
    ws["AK9"] = 99                             # ④ 小计不求和
    ws["AM19"] = 30                            # ⑤ 本月天数写死错值
    ws["E26"] = 0                              # ⑥ 上班人数写死
    ws.unmerge_cells("C10:AG10")                # ⑦ 月份横幅拆开（应合成 1 格）
    wb.save(path)
    return path


def make_bad5() -> str:
    """表头大小周错：所有周六都标红（不交替：连续两个大周），周日反而没标。"""
    path = copy("bad5.xlsx")
    wb = load_workbook(path)
    ws = wb.active
    red = Font(color="FFFF0000")
    black = Font(color="FF000000")
    for c in range(3, 34):                      # 星期行（第 3 行）
        cell = ws.cell(3, c)
        if cell.value == "六":
            cell.font = red                     # 全标红 → 不交替
        elif cell.value == "日":
            cell.font = black                   # 周日没标红
    wb.save(path)
    return path


def make_bad4() -> str:
    """结转列错：剩余没按「上月结转 + 应休 − 实休」算；年假余额被写成 0。"""
    path = copy("bad4.xlsx")
    wb = load_workbook(path)
    ws = wb.active
    ws["AI4"] = "1天"        # ① 韩欢欢上月 0 + (6−6) 应为 0
    ws["AI8"] = "5天"        # ② 刘秀文上月 3天4小时 + (6−7) 应为 2天4小时
    ws["AJ6"] = 0            # ③ 叶炳辉年假余额被清零（结转应为 2天5小时）
    wb.save(path)
    return path


def make_bad3() -> str:
    """售后把当班的每个人都涂浅蓝（曾经的真实错误：当班 ≠ 值班）。"""
    path = copy("bad3.xlsx")
    wb = load_workbook(path)
    ws = wb.active
    blue = PatternFill("solid", fgColor="BDD7EE")
    for r in range(11, 16):
        for c in range(3, 34):
            if ws.cell(r, c).value in ("早", "晚"):
                ws.cell(r, c).fill = blue
    wb.save(path)
    return path


def make_month30() -> str:
    """清掉 31 号整列：模拟只有 30 天的月份（本月天数公式应自动变 30，月份横幅也跟着只盖 30 列）。"""
    path = copy("month30.xlsx")
    wb = load_workbook(path)
    ws = wb.active
    if "C10:AG10" in [str(m) for m in ws.merged_cells.ranges]:
        ws.unmerge_cells("C10:AG10")
        ws.merge_cells("C10:AF10")              # 横幅只盖 1 号~30 号
        ws["C10"] = "10月"
    for r in range(1, 28):
        cell = ws.cell(r, 33)                   # AG 列 = 31 号
        try:
            cell.value = None
        except AttributeError:                  # 合并格里不能直接赋值
            pass
    wb.save(path)
    return path


if __name__ == "__main__":
    if not SRC.exists():
        raise SystemExit(f"找不到主表：{SRC}")
    for fn in (make_bad, make_bad2, make_bad3, make_bad4, make_bad5, make_month30):
        print("已生成", fn())
