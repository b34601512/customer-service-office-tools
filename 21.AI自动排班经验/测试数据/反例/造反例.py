# -*- coding: utf-8 -*-
"""造反例：从主表生成「验排班表.py」的负向/边界测试表（专门用来证明校验工具真的能抓到错）。

用法：
    cd "D:\\桌面\\办公软件\\21.AI自动排班经验"
    python "测试数据\\反例\\造反例.py"

生成（就地覆盖本目录）：
    bad.xlsx      统计/汇总/小计/上班人数 全改成写死的数值，且故意写错一处（韩欢欢晚班 99）
    bad2.xlsx     6 处公式篡改：去 OFFSET、应到写数值、小计/汇总/天数/上班人数写死
    month30.xlsx  清掉 31 号列 → 模拟 30 天的月份（验公式的范围会不会把 31 号空白算成休息）

生成的 xlsx 按仓库约定不入库（.gitignore 排除 *.xlsx），需要时重跑本脚本即可。
"""
from __future__ import annotations

import shutil
from pathlib import Path

from openpyxl import load_workbook

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
    """6 处公式篡改：结构不对/写死数值/口径不对。"""
    path = copy("bad2.xlsx")
    wb = load_workbook(path)
    ws = wb.active
    ws["AK4"] = "=COUNTBLANK(C4:AG4)"          # 去掉 OFFSET：不按当月天数取范围
    ws["AO4"] = 24                             # 应到写死数值
    ws["AK9"] = 99                             # 小计不求和
    ws["C19"] = 1                              # 汇总行写死
    ws["AM19"] = 30                            # 本月天数写死错值
    ws["E26"] = 0                              # 上班人数写死
    wb.save(path)
    return path


def make_month30() -> str:
    """清掉 31 号整列：模拟只有 30 天的月份（本月天数公式应自动变 30）。"""
    path = copy("month30.xlsx")
    wb = load_workbook(path)
    ws = wb.active
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
    for fn in (make_bad, make_bad2, make_month30):
        print("已生成", fn())
