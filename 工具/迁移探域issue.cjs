#!/usr/bin/env node
"use strict";
/**
 * 把硅基仓里标题含「探域」的 open issue 迁到木婉清仓（customer-service-office-tools），
 * 迁完在硅基仓原单留一条指向评论并关闭。断点续跑：进度写 .state/探域迁移-进度.json。
 *
 * 口径（2026-11-21 与 09 号核对后定）：原单评论整段写进新单**正文**「## 原单评论（按时间，原文照搬）」，
 * 不逐条建成工单评论；**迁仓指引那条评论（「已迁到木婉清仓 #新号…」）不收录，属正常**——
 * 对账时「新单正文里的 ### 评论 N 条数」应等于「旧单评论数 − 1（指引）」。
 * 用法：node 工具/迁移探域issue.cjs [--干] [--号 888,848,…]   （不给 --号 就迁标题含「探域」的）
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const 硅 = "c34601512-cpu/silicon-company";
const 木 = "b34601512/customer-service-office-tools";
const 根 = path.resolve(__dirname, "..");
const 进度文件 = path.join(根, "工具/.state/探域迁移-进度.json");
const 干跑 = process.argv.includes("--干");

function gh(args, 输入) {
  return execFileSync("gh", args, { encoding: "utf8", input: 输入, maxBuffer: 64 * 1024 * 1024 });
}
function 读进度() {
  try { return JSON.parse(fs.readFileSync(进度文件, "utf8")); } catch { return { 完成: [], 失败: [] }; }
}
function 写进度(p) { fs.writeFileSync(进度文件, JSON.stringify(p, null, 1)); }

// 1) 取清单：--号 888,848 指定；不给就按标题含「探域」筛
const 号参 = process.argv.find((a) => a.startsWith("--号"));
const 指定 = 号参 ? (process.argv[process.argv.indexOf(号参) + 1] || "").split(",").map((x) => Number(x.trim())).filter(Boolean) : [];
const 全部 = JSON.parse(gh(["issue", "list", "-R", 硅, "--state", "open", "--limit", "300", "--json", "number,title"]));
const 目标 = 指定.length ? 指定 : 全部.filter((i) => /探域/.test(i.title)).map((i) => i.number);
const 进度 = 读进度();

// 幂等：木仓里已有正文带「迁自 silicon-company #N」的，直接复用
const 木单 = JSON.parse(gh(["issue", "list", "-R", 木, "--state", "all", "--limit", "300", "--json", "number,body"]));
const 已有映射 = new Map();
for (const x of 木单) {
  const m = (x.body || "").match(/迁自 silicon-company #(\d+)/);
  if (m) 已有映射.set(Number(m[1]), x.number);
}
const 已完成号 = new Set(进度.完成.map((x) => x.旧));

console.log(JSON.stringify({ 进度事件: "开始", 待迁: 目标.filter((n) => !已完成号.has(n)).length, 总: 目标.length }));

for (const 旧号 of 目标) {
  if (已完成号.has(旧号)) continue;
  try {
    const d = JSON.parse(
      gh(["issue", "view", String(旧号), "-R", 硅, "--json", "title,body,author,createdAt,comments,url"])
    );
    let 正文 = `> 迁自 silicon-company #${旧号}（${d.url}）｜原开单人 ${d.author && d.author.login}｜原开单时间 ${d.createdAt}\n> 迁单：木婉清 2026-11-21（老板令：探域问题全部开到本仓，硅基仓原单关闭，交探域专员跟进）\n\n`;
    正文 += d.body || "（原单无正文）";
    if (d.comments && d.comments.length) {
      正文 += "\n\n---\n\n## 原单评论（按时间，原文照搬）\n";
      d.comments.forEach((c, i) => {
        正文 += `\n### 评论 ${i + 1} · ${c.author && c.author.login} · ${c.createdAt}\n\n${c.body}\n`;
      });
    }
    let 新号 = 已有映射.get(旧号) || null;
    const 临时 = path.join(根, `工具/.state/迁单-${旧号}-${process.pid}-${Date.now()}.md`);
    fs.writeFileSync(临时, 正文);

    if (干跑) {
      console.log(JSON.stringify({ 进度事件: "干跑", 旧号, 标题: d.title, 正文字节: Buffer.byteLength(正文) }));
      fs.unlinkSync(临时);
      continue;
    }

    if (!新号) {
      const 出 = gh(["issue", "create", "-R", 木, "--title", d.title, "--body-file", 临时]).trim();
      const m = 出.match(/\/issues\/(\d+)/);
      if (!m) throw new Error("创建返回认不出新号：" + 出);
      新号 = Number(m[1]);
    }
    fs.unlinkSync(临时);

    gh(["issue", "comment", String(旧号), "-R", 硅, "--body",
      `已迁到木婉清仓：${木}#${新号}（老板 2026-11-21 令：探域问题全部开到客户服务办公工具仓，硅基仓原单关闭，交探域专员跟进）。本单关闭，后续跟进看新单。`]);
    gh(["issue", "close", String(旧号), "-R", 硅]);

    进度.完成.push({ 旧: 旧号, 新: 新号, 标题: d.title });
    写进度(进度);
    console.log(JSON.stringify({ 进度事件: "完成", 旧号, 新号, 标题: d.title }));
  } catch (e) {
    进度.失败.push({ 旧: 旧号, 错误: String(e && e.message || e).slice(0, 300) });
    写进度(进度);
    console.log(JSON.stringify({ 进度事件: "失败", 旧号, 错误: String(e && e.message || e).slice(0, 200) }));
  }
}
console.log(JSON.stringify({ 进度事件: "结束", 完成: 进度.完成.length, 失败: 进度.失败.length }));
