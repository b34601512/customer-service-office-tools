# -*- coding: utf-8 -*-
"""检查「本机时间偏移」：本机 vs 多个公共 HTTP Date 服务器（只读、无第三方依赖）。

用法：python 查时间偏移.py   （Windows / 有网即可）

判定：任一源 |差| ≤ 3 秒视为正常（含网络往返误差）；
      都明显偏大 → 别急着修服务器，先查本机时间服务（w32time）。
"""
import email.utils
import sys
import urllib.request
from datetime import datetime, timezone

try:  # 防 GBK 控制台打印崩溃
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

源 = ["https://www.cloudflare.com", "https://www.baidu.com", "https://www.google.com"]


def 拿Date(网址):
    req = urllib.request.Request(网址, method="HEAD", headers={"User-Agent": "Mozilla/5.0 (checker)"})
    with urllib.request.urlopen(req, timeout=8) as r:
        d = r.headers.get("Date")
    if not d:
        raise RuntimeError("响应里没有 Date 头")
    return email.utils.parsedate_to_datetime(d).astimezone(timezone.utc)


本机 = datetime.now(timezone.utc)
print("本机 UTC >", 本机.strftime("%Y-%m-%d %H:%M:%S"))
好源 = 0
for u in 源:
    try:
        t = 拿Date(u)
        差 = (datetime.now(timezone.utc) - t).total_seconds()
        print("%+7.1fs  %s" % (差, u))
        好源 += 1
    except Exception as e:
        print("   跳过   %s  （%s）" % (u, e))
print()
if 好源 == 0:
    print("没有任何可用源（网络问题？）——换个网或手工对表。")
else:
    print("看完上表：全部接近 0 就没事；有一条持续偏差大，先查本机 w32time（见 README）。")
