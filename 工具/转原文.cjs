#!/usr/bin/env node
"use strict";

/**
 * 转原文：把收件箱里某条消息的**原始正文**原样写成文件，供 --file 直接发送。
 *
 * 为什么要有这个：2026-11-19 11:47 我手工转韩某某的答案给岳灵珊时，把最后一行截掉了，
 * 差点让她的判分少算一个得分点。手抄就会出错，工具不会。
 *
 * 用法：
 *   node 工具/转原文.cjs --msgid <msgid> --前缀 "韩某某 第 25 题作答（原样）："   ← 转发一律优先用这个
 *   node 工具/转原文.cjs --人 邓某某 --前缀 "邓某某 第 19 题作答（原样）："       ← 按发件人取最新一条
 *   node 工具/转原文.cjs --条 -1 --打印        # 只打印不写文件
 *
 * 为什么要 --msgid / --人（2026-11-19 13:39 事故）：转发别人答案时图省事用了「最后一条」，
 * 结果那一条是陈某某刚发来的另一个问题，我把她的话当成邓某某的答案转给了岳灵珊，还转了两遍。
 * 收件箱永远在长，"最后一条"不等于"要转的那一条"。
 *
 * 输出：文件路径（可直接给 发企微.cjs --file / 私信.cjs --从文件）
 * 退出码：0 成功；1 找不到消息；2 参数错
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const 收件箱 = path.join(__dirname, "企微", "收件箱", "inbox.jsonl");

function 取参数(argv) {
  const o = { 条: -1, msgid: "", 人: "", 前缀: "", 打印: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--条") o.条 = Number(argv[++i]);
    else if (k === "--msgid") o.msgid = String(argv[++i] || "");
    else if (k === "--人") o.人 = String(argv[++i] || "");
    else if (k === "--前缀") o.前缀 = String(argv[++i] || "");
    else if (k === "--打印") o.打印 = true;
    else if (k === "--help" || k === "-h") o.help = true;
    else throw new Error(`不认识的参数：${k}`);
  }
  return o;
}

function main() {
  const o = 取参数(process.argv.slice(2));
  if (o.help) {
    console.log("node 工具/转原文.cjs --msgid <msgid>|--人 <发件人>|--条 -1 --前缀 \"谁 第几题作答（原样）：\" [--打印]");
    console.log("  转发优先用 --msgid 或 --人；--条 -1 = 收件箱最后一条，容易被别人的新消息顶掉。");
    return 0;
  }
  if (!fs.existsSync(收件箱)) {
    console.error(`收件箱不存在：${收件箱}`);
    return 1;
  }
  const 行 = fs.readFileSync(收件箱, "utf8").split("\n").filter(Boolean);
  if (!行.length) {
    console.error("收件箱是空的");
    return 1;
  }
  let 记录 = null;
  const 全部 = 行.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (o.msgid) {
    记录 = 全部.find((r) => r.msgid === o.msgid) || null;
  } else if (o.人) {
    // 按发件人取最新一条（名字做包含匹配，兼容「韩某某（售前）」这种带岗位的写法）
    const 命中 = 全部.filter((r) => String(r.fromName || r.from || "").includes(o.人));
    记录 = 命中.length ? 命中[命中.length - 1] : null;
  } else {
    const idx = o.条 < 0 ? 行.length + o.条 : o.条 - 1;
    try { 记录 = JSON.parse(行[idx]); } catch { 记录 = null; }
  }
  if (!记录) {
    console.error("没找到那条消息（msgid / 条号 / 发件人 不对）。转发请用 --msgid：收件箱不少记录 fromName 是空的、只有 fromUserId，--人 匹配不到。");
    return 1;
  }
  const 正文 = String(记录.text ?? "");
  const 全文 = o.前缀 ? `${o.前缀}\n${正文}` : 正文;

  if (o.打印) {
    console.log(全文);
    return 0;
  }

  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "转原文-"));
  const 文件 = path.join(目录, "正文.txt");
  fs.writeFileSync(文件, 全文.endsWith("\n") ? 全文 : 全文 + "\n", "utf8");
  const 回读 = fs.readFileSync(文件, "utf8");
  if (回读 !== (全文.endsWith("\n") ? 全文 : 全文 + "\n")) {
    console.error("写文件后回读不一致，别发");
    return 1;
  }
  console.log(文件);
  console.error(`（来自 ${记录.at} ${记录.fromName || "未知"}｜原文 ${正文.length} 字｜文件 ${回读.length} 字，已回读一致）`);
  return 0;
}

process.exitCode = main();
