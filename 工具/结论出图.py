#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
巡检结论出图（2026-11-26 黎路遥令：「结论以后改成图发企业微信」）

为什么要它：以前结论打在 TUI 里、企微只发一句「往上翻最新一条」，他还得回来翻窗；
现在直接出图、企微看一眼就够。数据仍是唯一真源 `.state/巡检结论-YYYY-MM-DD.json`，
本脚本只做「把同一份数据画成图」，不改口径、不重新算数。

用法：
  python 工具/结论出图.py                 # 出最新一天
  python 工具/结论出图.py --日 2026-11-26 # 指定某天
  python 工具/结论出图.py --宽 1240       # 调宽度（默认 1200）

口径照 `0.木婉清档案/规矩/巡检结论.md`：带序号、分板块写负责人、结论只用 ✔/✘/⏳、结果只写一行、末行合计。
"""
import argparse
import datetime as dt
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
from PIL import Image, ImageDraw, ImageFont

根 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
状态目录 = os.path.join(根, ".state")
字体常规 = "C:/Windows/Fonts/msyh.ttc"
字体加粗 = "C:/Windows/Fonts/msyhbd.ttc"
字体符号 = "C:/Windows/Fonts/seguisym.ttf"

结论色 = {"✔": (22, 138, 66), "✘": (198, 40, 40), "⏳": (196, 120, 16)}


def 读数据(日):
    if 日:
        路径 = os.path.join(状态目录, f"巡检结论-{日}.json")
    else:
        候选 = sorted(
            [f for f in os.listdir(状态目录) if f.startswith("巡检结论-") and f.endswith(".json")],
            key=lambda f: os.path.getmtime(os.path.join(状态目录, f)),
        )
        if not 候选:
            raise SystemExit("没有找到任何 .state/巡检结论-*.json")
        路径 = os.path.join(状态目录, 候选[-1])
    with open(路径, "r", encoding="utf-8") as f:
        return json.load(f), 路径


def 载字体(字号, 粗=False):
    return ImageFont.truetype(字体加粗 if 粗 else 字体常规, 字号)


class 画布:
    def __init__(self, 宽):
        self.宽 = 宽
        self.左边距 = 40
        self.右内边距 = 40
        self.图 = Image.new("RGB", (宽, 4000), (255, 255, 255))
        self.画 = ImageDraw.Draw(self.图)
        self.y = 32

    def 行高(self, 字):
        b = self.画.textbbox((0, 0), "测A", font=字)
        return b[3] - b[1]

    def 换行(self, 文本, 字, 可用宽):
        行, 当前 = [], ""
        for ch in str(文本):
            if self.画.textlength(当前 + ch, font=字) <= 可用宽:
                当前 += ch
            else:
                行.append(当前)
                当前 = ch
        if 当前:
            行.append(当前)
        return 行 or [""]

    def 写(self, 文本, 字, 色=(28, 28, 28), x=None, 可用宽=None):
        x = self.左边距 if x is None else x
        可用宽 = 可用宽 if 可用宽 is not None else (self.宽 - x - self.右内边距)
        for 段 in self.换行(文本, 字, 可用宽):
            self.画.text((x, self.y), 段, font=字, fill=色)
            self.y += self.行高(字) + 6

    def 留白(self, 高):
        self.y += 高


def 出图(数据, 宽=1200):
    标头 = 载字体(30, True)
    副标 = 载字体(17)
    板块 = 载字体(20, True)
    正文 = 载字体(16)
    序号 = 载字体(15)
    结论字 = ImageFont.truetype(字体符号, 20)
    合计 = 载字体(19, True)

    c = 画布(宽)
    c.写(数据.get("标题", "巡检结论"), 标头, (17, 17, 17))
    if 数据.get("副标题"):
        c.写(数据["副标题"], 副标, (90, 90, 90))
    c.留白(8)

    左内 = c.左边距
    列号 = 54
    列项 = 200
    列结论 = 66
    x项 = 左内 + 列号
    x结论 = x项 + 列项 + 10
    x结果 = x结论 + 列结论 + 14

    n = 0
    计数 = {"✔": 0, "✘": 0, "⏳": 0}

    for 板 in 数据.get("板块", []):
        c.留白(6)
        c.写(f"【{板.get('名','')}】　负责人：{板.get('负责人','')}", 板块, (196, 30, 30))
        行 = 板.get("行", [])
        # 表头线
        c.画.line([(左内, c.y), (宽 - c.右内边距, c.y)], fill=(200, 200, 200), width=1)
        c.y += 8

        for 项目, 结论, 结果 in 行:
            n += 1
            开始y = c.y
            行高临时 = c.行高(正文)
            结果行 = c.换行(结果, 正文, 宽 - c.右内边距 - x结果)
            块高 = max(len(结果行) * (行高临时 + 6), 行高临时 + 6) + 8

            c.画.text((左内, 开始y + 2), str(n), font=序号, fill=(120, 120, 120))
            for i, 段 in enumerate(c.换行(项目, 正文, 列项 - 6)):
                c.画.text((x项, 开始y + i * (行高临时 + 6)), 段, font=正文, fill=(28, 28, 28))
            c.画.text((x结论, 开始y), 结论, font=结论字, fill=结论色.get(结论, (60, 60, 60)))
            for i, 段 in enumerate(结果行):
                c.画.text((x结果, 开始y + i * (行高临时 + 6)), 段, font=正文, fill=(60, 60, 60))
            计数[结论] = 计数.get(结论, 0) + 1
            c.y += 块高
            c.画.line([(左内, c.y - 6), (宽 - c.右内边距, c.y - 6)], fill=(235, 235, 235), width=1)

    c.留白(10)
    段 = [
        (f"合计 {n} 项：", 合计, (20, 20, 20)),
        ("✔", ImageFont.truetype(字体符号, 20), 结论色["✔"]),
        (f" {计数.get(chr(10004),0)}　", 合计, (20, 20, 20)),
    ]
    c.画.text((左内, c.y), 段[0][0], font=段[0][1], fill=段[0][2])
    x = 左内 + c.画.textlength(段[0][0], font=段[0][1])
    for 文本, 字, 色 in 段[1:]:
        c.画.text((x, c.y), 文本, font=字, fill=色)
        x += c.画.textlength(文本, font=字)
    for 符号, 键 in (("✘", "✘"), ("⏳", "⏳")):
        字 = ImageFont.truetype(字体符号, 20)
        c.画.text((x, c.y), 符号, font=字, fill=结论色[键])
        x += c.画.textlength(符号, font=字)
        文本 = f" {计数.get(键,0)}" + ("" if 键 == "⏳" else "　")
        c.画.text((x, c.y), 文本, font=合计, fill=(20, 20, 20))
        x += c.画.textlength(文本, font=合计)
    c.y += c.行高(合计) + 14
    c.画.text(
        (左内, c.y),
        dt.datetime.now().strftime("出图 %Y-%m-%d %H:%M") + "　数据源：.state/巡检结论-*.json",
        font=载字体(14),
        fill=(150, 150, 150),
    )
    c.y += 30

    成品 = c.图.crop((0, 0, 宽, int(c.y)))
    return 成品


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--日", default="")
    p.add_argument("--宽", type=int, default=1200)
    p.add_argument("--出", default="")
    a = p.parse_args()

    数据, 源 = 读数据(a.日 or "")
    日 = a.日 or os.path.basename(源).replace("巡检结论-", "").replace(".json", "")
    输出 = a.出 or os.path.join(状态目录, f"巡检结论-{日}.png")
    图 = 出图(数据, a.宽)
    图.save(输出, "PNG")
    print(f"已出图：{输出}（{图.width}×{图.height}，源 {os.path.basename(源)}）")


if __name__ == "__main__":
    main()
