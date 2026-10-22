#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
冒烟测试.py —— 验两件事：
  ① 该抓的抓得到：临时目录里种一份「看着干净、其实有敏感信息」的文件，逐条断言命中
  ② 不该报的不报：整个包自己扫一遍，medium 门槛必须 0 命中（否则包自己就泄漏了）

跑法：python 测试/冒烟测试.py
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOOL = os.path.join(ROOT, "工具", "查敏感.py")

# 故意拆开拼，免得这份测试文件自己被扫描器命中
SK = "sk-" + "A1b2C3d4E5f6G7h8I9j0"
GH = "ghp_" + "abcdefghijklmnopqrstuvwx"
PHONE = "138" + "12345678"
ID = "4403" + "0019" + "9001" + "0112" + "34"
PW = "Pass" + "w0rd!"
MAIL = "zhang" + "san@example.com"
WINPATH = "D:" + "\\Users\\" + "zhangsan" + "\\Desktop\\订单.xlsx"
INNER = "192" + ".168.1.23"
PLANTED = f"""# 一份「看着很正常」的交接文档
交接人：张三
联系方式：{PHONE}
邮箱：{MAIL}
身份证：{ID}
文件在 {WINPATH}
服务器：{INNER}
接口密钥：{SK}
GitHub 令牌：{GH}
数据库 password={PW}
占位写法（不该报）：密码：<密码>
"""

EXPECT = ["手机号", "邮箱", "身份证号", "本机用户名路径", "内网IP", "OpenAIKey",
          "GitHubToken", "疑似口令"]


def run(paths, *extra):
    cmd = [sys.executable, TOOL, *paths, "--json", *extra]
    env = dict(os.environ, PYTHONIOENCODING="utf-8")  # Windows 管道下子进程默认 GBK，会解不开
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env=env)
    data = json.loads(p.stdout) if (p.stdout or "").strip() else {"hits": [], "total": 0}
    return p.returncode, data


def main():
    ok = True
    with tempfile.TemporaryDirectory() as td:
        f = os.path.join(td, "交接说明.md")
        with open(f, "w", encoding="utf-8") as fh:
            fh.write(PLANTED)

        code, data = run([td])
        rules = {h["rule"] for h in data["hits"]}
        print(f"① 种了 {len(EXPECT)} 类，工具报出 {len(rules)} 类：")
        for name in EXPECT:
            hit = name in rules
            print(f"   {'PASS' if hit else 'FAIL'}  {name}")
            ok &= hit
        placeholder_ok = True  # 占位符逻辑在下一行断言里一并验
        # 占位符那行不该产生口令命中：命中数应与种下的口令行数一致（1 条）
        pw_hits = [h for h in data["hits"] if h["rule"] == "疑似口令"]
        one_pw = len(pw_hits) == 1
        print(f"   {'PASS' if one_pw else 'FAIL'}  占位符 <密码> 不算命中（口令命中 {len(pw_hits)} 条，应为 1）")
        ok &= one_pw and placeholder_ok

        # 掩码：报出来的片段不能含完整手机号
        leak = any(PHONE in h["sample"] for h in data["hits"])
        print(f"   {'PASS' if not leak else 'FAIL'}  输出已掩码（不含完整手机号）")
        ok &= not leak

        exit_ok = code == 1
        print(f"   {'PASS' if exit_ok else 'FAIL'}  有命中时退出码 1（实际 {code}）")
        ok &= exit_ok

    code, data = run([ROOT, "--min", "medium"])
    # 扫描器的规则字面量、以及测试里的故意样本，必然会被自己命中——只断言「其余文件干净」
    own = (os.path.join(ROOT, "工具"), os.path.join(ROOT, "测试"))
    stray = [h for h in data["hits"] if not h["file"].startswith(own)]
    print(f"② 本包自扫（medium）：命中 {len(data['hits'])} 条，其中规则字面量/测试样本 {len(data['hits']) - len(stray)} 条")
    for h in stray[:5]:
        print(f"   ✗ {os.path.relpath(h['file'], ROOT)}:{h['line']} {h['rule']} → {h['sample']}")
    clean = not stray
    print(f"   {'PASS' if clean else 'FAIL'}  除工具与测试目录外，其余文件 0 命中")
    ok &= clean

    print("\n结果：", "全 PASS" if ok else "有 FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
