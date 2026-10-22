#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
查敏感.py —— 公开仓库/对外交付前的脱敏扫描（只读，不改文件）

用法：
    python 查敏感.py <文件或目录> [更多路径...] [选项]

选项：
    --json            输出 JSON（给程序读）
    --min high|medium|low   报告门槛（默认 medium；带 --strict 等同 high）
    --allow 规则名,规则名   忽略某几条规则
    --max-size 2M     超过这个大跳过（默认 2MB）
    -q / --quiet      只报汇总数字

退出码：0 干净；1 有命中（达到门槛）；2 参数/路径错误

设计约定：
  1. 只读：绝不修改被扫文件。
  2. 命中片段一律**掩码**后再打印——工具本身不能把密码再抄进日志。
  3. 默认跳过 .git / node_modules / 二进制文件（含 \\x00 即跳过）。
"""
import argparse
import json
import os
import re
import sys

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
             ".next", ".idea", ".vs", "target", "vendor"}
TEXT_EXT = {".md", ".txt", ".py", ".js", ".cjs", ".mjs", ".ts", ".json", ".yml", ".yaml",
            ".ini", ".cfg", ".conf", ".ps1", ".bat", ".cmd", ".vbs", ".sh", ".html",
            ".css", ".sql", ".env", ".log", ".csv", ".xml", ".toml", ".gitignore", ""}

HIGH, MEDIUM, LOW = "high", "medium", "low"
RANK = {HIGH: 3, MEDIUM: 2, LOW: 1}

PLACEHOLDER = {"<密码>", "<password>", "***", "********", "xxx", "xxxxxx", "你的密码",
               "your_password", "$PASSWORD", "%PASSWORD%", "", "null", "none"}


def mask(token, keep=2):
    """中间打码：保留首尾各 keep 个字符。"""
    token = token.strip()
    if len(token) <= keep * 2:
        return "*" * len(token)
    return token[:keep] + "*" * max(3, len(token) - keep * 2) + token[-keep:]


def mask_user(m):
    return "***"


def mask_password(m):
    return m.group(0).replace(m.group(2), "<已隐去>")


# (规则名, 严重度, 正则, 掩码函数, 说明)
RULES = [
    ("私钥块", HIGH, re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), None, "整块私钥不要入库"),
    ("OpenAIKey", HIGH, re.compile(r"sk-[A-Za-z0-9_\-]{16,}"), None, "sk- 开头的模型密钥"),
    ("GitHubToken", HIGH, re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"), None, "ghp_/gho_ 等令牌"),
    ("AWSKey", HIGH, re.compile(r"AKIA[0-9A-Z]{16}"), None, "AWS Access Key"),
    ("SlackToken", HIGH, re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"), None, "Slack 令牌"),
    ("身份证号", HIGH, re.compile(r"(?<![\dXx])\d{17}[\dXx](?![\dXx])"), None, "18 位身份证"),
    ("银行卡号", HIGH, re.compile(r"(?<!\d)\d{16,19}(?!\d)"), None, "16–19 位连续数字"),
    ("疑似口令", HIGH,
     re.compile(r"(?i)(password|passwd|pwd|密码|口令)\s*[:=：]\s*([^\s`|]+)"), mask_password,
     "赋值语句里的口令（占位符不算）"),
    ("本机用户名路径", MEDIUM, re.compile(r"[A-Za-z]:\\Users\\([^\\\s\"'<>|]+)"), None,
     "带真实用户名的绝对路径"),
    ("macOS-Linux家目录", MEDIUM, re.compile(r"/(?:Users|home)/([A-Za-z0-9._\-]+)"), None, "/home/xxx 路径"),
    ("手机号", MEDIUM, re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"), None, "大陆手机号"),
    ("邮箱", MEDIUM, re.compile(r"[\w.+\-]+@[\w\-]+\.[\w.\-]+"), None, "真实邮箱"),
    ("内网IP", MEDIUM,
     re.compile(r"(?<![\d.])(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?![\d.])"),
     None, "内网地址暴露拓扑"),
    ("公网IP", MEDIUM,
     re.compile(r"(?<![\d.])(?!10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}(?:\.\d{1,3}){3}(?![\d.])"),
     None, "服务器公网 IP"),
    ("金额", LOW, re.compile(r"[¥￥]\s?\d[\d,]*(?:\.\d+)?"), None, "报价/余额（低危，人工看一眼）"),
]


def iter_files(paths, max_size):
    for p in paths:
        p = os.path.abspath(p)
        if os.path.isfile(p):
            yield p
            continue
        if not os.path.isdir(p):
            print(f"路径不存在：{p}", file=sys.stderr)
            sys.exit(2)
        for root, dirs, files in os.walk(p):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                yield os.path.join(root, f)


def is_text(path, max_size):
    ext = os.path.splitext(path)[1].lower()
    if ext not in TEXT_EXT:
        return False
    try:
        if os.path.getsize(path) > max_size:
            return False
        with open(path, "rb") as fh:
            return b"\x00" not in fh.read(8192)
    except OSError:
        return False


def scan_line(line, allow):
    hits = []
    for name, sev, rx, masker, note in RULES:
        if name in allow:
            continue
        for m in rx.finditer(line):
            raw = m.group(0)
            # 口令占位符不算（去掉反引号/引号/标点再比）
            if name == "疑似口令":
                cap = m.group(2).strip().strip("`\"'.,;:。，、")
                placeholder = (cap.lower() in PLACEHOLDER
                               or re.fullmatch(r"[*xX.·]+", cap) is not None
                               or (cap.startswith("<") and cap.endswith(">"))
                               or cap in {"值", "xxx", "VALUE", "value"})
                if placeholder:
                    continue
            # 银行卡号让位给身份证号（18 位会被两边同时命中）
            if name == "银行卡号" and re.fullmatch(r"\d{17}[\dXx]", raw):
                continue
            shown = masker(m) if masker else mask(raw)
            hits.append({"rule": name, "severity": sev, "sample": shown, "note": note})
    return hits


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--min", default=MEDIUM, choices=[HIGH, MEDIUM, LOW])
    ap.add_argument("--allow", default="")
    ap.add_argument("--max-size", default="2M")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args()

    allow = {s.strip() for s in args.allow.split(",") if s.strip()}
    raw = args.max_size.strip().upper()
    max_size = int(float(raw[:-1]) * 1024 * 1024) if raw.endswith("M") else int(raw)

    results, files, scanned = [], 0, 0
    for path in iter_files(args.paths, max_size):
        files += 1
        if not is_text(path, max_size):
            continue
        scanned += 1
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                for no, line in enumerate(fh, 1):
                    hits = scan_line(line, allow)
                    if hits:
                        for h in hits:
                            h.update(file=path, line=no)
                            results.append(h)
        except OSError as e:
            print(f"读不了：{path}（{e}）", file=sys.stderr)

    threshold = RANK[args.min]
    red = [r for r in results if RANK[r["severity"]] >= threshold]

    if args.json:
        print(json.dumps({"scanned": scanned, "hits": red, "total": len(results)},
                         ensure_ascii=False, indent=2))
    elif not args.quiet:
        for r in red:
            print(f"{r['file']}:{r['line']}: [{r['severity']}] {r['rule']} → {r['sample']}")
        if not red:
            print(f"干净：扫了 {scanned} 个文本文件（跳过 {files - scanned} 个非文本/超大），"
                  f"达到 {args.min} 门槛的命中 0 条。")
        else:
            print(f"\n共 {len(red)} 条达到 {args.min} 门槛（全部 {len(results)} 条，"
                  f"扫了 {scanned} 个文本文件）。上面片段已掩码，照行号去改。")
    else:
        print(f"{scanned} 文件 / {len(red)} 命中")

    sys.exit(1 if red else 0)


if __name__ == "__main__":
    main()
