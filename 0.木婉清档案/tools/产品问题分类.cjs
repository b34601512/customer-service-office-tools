#!/usr/bin/env node
// 33号《产品问题反馈表》→ 标准分类 + 帕累托图（按同类问题量排序）
// 用途：黎路遥 2026-10-30 13:11「售后问题做一个标准分类，登记客户问题的时候就选，然后做一个柏拉图或柱形图，按同类问题量排序」。
// 本脚本只读：读表 → 按关键词归类 → 出 PNG。不改表、不写表。
// 用法：node 产品问题分类.cjs            读表出图（默认 A1:M400）
//       node 产品问题分类.cjs --行 800   读到第 800 行
//       node 产品问题分类.cjs --导出     只出分类明细 md，不画图
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CLI = "C:/Users/b3460/AppData/Roaming/npm/node_modules/@wecom/cli/bin/wecom.js";
const DOCID = "e3_AFMAdwb9AAYCNWqYmWTycQumhjFGA";
const SHEET = "BB08J2";
const 输出目录 = path.join(__dirname, "..", "outputs", "产品问题分类");

// 一级分类：关键词命中即归类；顺序即优先级（越具体越靠前）
const 分类表 = [
  ["安全/合规隐患", ["着火", "火灾", "燃烧", "明火", "助燃", "三无", "警示", "漏电", "熔化", "融化", "安全隐患", "断电"]],
  ["配件·吸氧管/鼻氧管", ["吸氧管", "鼻氧管", "拔不下", "管子有水"]],
  ["配件·湿化瓶/水箱", ["湿化瓶", "湿化水", "水箱", "加水", "水位"]],
  ["配件·过滤棉/过滤器", ["过滤棉", "过滤器", "滤芯", "滤网"]],
  ["配件·遥控器/其他", ["遥控器", "红外", "电源线", "插头", "底盘", "绳子", "电池"]],
  ["故障·漏水漏气", ["漏水", "漏气", "密封"]],
  ["故障·不出氧/浓度低", ["浓度下降", "浓度低", "达不到", "不出氧", "没氧气", "氧浓度", "出气量", "流量不足"]],
  ["故障·噪音异响", ["噪音", "异响", "滴滴", "吵", "声音大", "抖动", "震动", "振动", "嗡嗡", "噗呲"]],
  ["故障·异味/发热", ["异味", "烧焦", "臭味", "发热", "高温", "散热", "烫"]],
  ["故障·报警/停机/按键", ["报警", "警报", "停机", "关机", "开不了机", "不能启动", "按键", "按钮", "失灵"]],
  ["显示/语音/提示", ["屏幕", "显示屏", "计时器", "开机音", "播报", "语音", "看不见", "提示"]],
  ["外观/出厂质检", ["刮花", "划痕", "二手机", "出厂前", "质检", "褶皱", "脏"]],
  ["使用/说明不清", ["不会用", "不知道", "说明书", "接法", "看不懂", "误解", "以为", "怎么用"]],
  ["包装/物流", ["破损", "少件", "发错", "包装", "物流", "快递"]],
  ["售后流程", ["退换", "退货", "换货", "维修", "运费", "发票", "退款", "补发"]],
  ["设计改进建议", ["建议", "应设计", "应做", "能不能", "希望", "改为", "独立", "内置", "外置", "顶部", "侧面", "供应商"]],
];
const 兜底 = "其他/待归类";

// 细类 → 登记用的 8 个大类（黎路遥 2026-10-30 13:15「可以，按你建议」）
const 大类映射 = {
  "配件·吸氧管/鼻氧管": "配件耗材", "配件·湿化瓶/水箱": "配件耗材", "配件·过滤棉/过滤器": "配件耗材", "配件·遥控器/其他": "配件耗材",
  "故障·漏水漏气": "机器故障", "故障·不出氧/浓度低": "机器故障", "故障·噪音异响": "机器故障", "故障·异味/发热": "机器故障", "故障·报警/停机/按键": "机器故障",
  "安全/合规隐患": "安全合规", "显示/语音/提示": "显示与提示", "外观/出厂质检": "外观与质检",
  "使用/说明不清": "使用与退换流程", "售后流程": "使用与退换流程", "包装/物流": "使用与退换流程",
  "设计改进建议": "设计改进建议", "其他/待归类": "待归类",
};
const 下拉项 = ["配件耗材", "机器故障", "安全合规", "显示与提示", "使用与退换流程", "设计改进建议", "外观与质检", "待归类"];
const 大类 = (细) => 大类映射[细] || "待归类";

function 归类(描述) {
  const t = String(描述 || "");
  for (const [名, 词] of 分类表) {
    if (词.some((w) => t.includes(w))) return 名;
  }
  return 兜底;
}

function 读表(末行) {
  const out = execFileSync(process.execPath, [
    CLI, "sheet", "ranges", "get",
    "--docid", DOCID, "--sheet-id", SHEET,
    "--range", `A1:M${末行}`, "--mode", "default",
  ], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const j = JSON.parse(out);
  const rows = (j.grid_data && j.grid_data.rows) || [];
  const 值 = (r, i) => (((r.values || [])[i] || {}).cell_value || {}).text || "";
  return rows.slice(1).map((r, i) => ({
    行号: i + 2,
    登记日期: 值(r, 0), 反馈人: 值(r, 1), 型号: 值(r, 2), 描述: 值(r, 3), 进度: 值(r, 6),
  })).filter((x) => x.描述.trim());
}

function 统计(明细) {
  const m = new Map();
  for (const d of 明细) {
    const k = 归类(d.描述);
    d.分类 = k;
    m.set(k, (m.get(k) || 0) + 1);
  }
  const list = [...m.entries()].map(([名, 数]) => ({ 名, 数 })).sort((a, b) => b.数 - a.数);
  const 总 = list.reduce((s, x) => s + x.数, 0);
  let 累计 = 0;
  for (const x of list) {
    x.占比 = 总 ? x.数 / 总 : 0;
    累计 += x.占比;
    x.累计 = 累计;
  }
  return { list, 总 };
}

function 出图(统计结果, 文件) {
  const { list, 总 } = 统计结果;
  const W = 1180, H = 560, L = 70, R = 60, T = 60, B = 130;
  const 内宽 = W - L - R, 内高 = H - T - B;
  const max = Math.max(1, list[0] ? list[0].数 : 1);
  const bw = 内宽 / Math.max(1, list.length);
  const y = (v) => T + 内高 - (v / max) * 内高;
  const y2 = (p) => T + 内高 - p * 内高;
  const bars = list.map((x, i) => {
    const h = (x.数 / max) * 内高;
    const x0 = L + i * bw + bw * 0.15;
    return `<rect x="${x0.toFixed(1)}" y="${(T + 内高 - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" fill="#2b6cf5" rx="2"/>
<text x="${(x0 + bw * 0.35).toFixed(1)}" y="${(T + 内高 - h - 6).toFixed(1)}" text-anchor="middle" font-size="12" fill="#1f2937">${x.数}</text>`;
  }).join("");
  const pts = list.map((x, i) => `${(L + i * bw + bw / 2).toFixed(1)},${y2(x.累计).toFixed(1)}`).join(" ");
  const labels = list.map((x, i) => {
    const cx = L + i * bw + bw / 2;
    const 名 = x.名.length > 9 ? x.名.slice(0, 9) + "…" : x.名;
    return `<text x="${cx.toFixed(1)}" y="${T + 内高 + 18}" text-anchor="end" font-size="11" fill="#374151" transform="rotate(-35 ${cx.toFixed(1)} ${T + 内高 + 18})">${名}</text>`;
  }).join("");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const yy = T + p * 内高;
    return `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W - R}" y2="${yy.toFixed(1)}" stroke="#e5e7eb"/>
<text x="${L - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b7280">${Math.round(max * (1 - p))}</text>
<text x="${W - R + 8}" y="${(yy + 4).toFixed(1)}" font-size="11" fill="#6b7280">${Math.round((1 - p) * 100)}%</text>`;
  }).join("");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>body{margin:0;background:#fff;font-family:"Microsoft YaHei",SimSun,sans-serif}
.wrap{padding:24px 28px}h1{font-size:20px;margin:0 0 6px}.sub{font-size:13px;color:#6b7280;margin-bottom:8px}</style></head><body><div class="wrap">
<h1>产品问题反馈 · 分类帕累托图</h1>
<div class="sub">数据源：《产品问题反馈表》（企业微信）｜有描述的记录 ${总} 条｜按同类问题量降序｜柱＝条数，折线＝累计占比</div>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${grid}${bars}
<polyline points="${pts}" fill="none" stroke="#f59e0b" stroke-width="2"/>
${list.map((x, i) => `<circle cx="${(L + i * bw + bw / 2).toFixed(1)}" cy="${y2(x.累计).toFixed(1)}" r="3" fill="#f59e0b"/>`).join("")}
${labels}
<text x="${L}" y="${T - 26}" font-size="12" fill="#2b6cf5">■ 条数</text>
<text x="${L + 70}" y="${T - 26}" font-size="12" fill="#f59e0b">— 累计占比</text>
</svg></div></body></html>`;
  fs.mkdirSync(path.dirname(文件.replace(/\.png$/, "")), { recursive: true });
  const htmlPath = 文件.replace(/\.png$/, ".html");
  fs.writeFileSync(htmlPath, html, "utf8");
  const chrome = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  ].find((p) => fs.existsSync(p));
  if (!chrome) throw new Error("找不到 Chrome");
  execFileSync(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--window-size=1240,660", `--screenshot=${文件}`, `file:///${htmlPath.replace(/\\/g, "/")}`,
  ], { encoding: "utf8", timeout: 120000 });
  return 文件;
}

function 出明细md(明细, 统计结果) {
  const lines = ["# 产品问题反馈 · 标准分类（草案）", "", `有描述记录 ${统计结果.总} 条。分类按关键词自动标注，供黎路遥确认口径用。`, "", "| 一级分类 | 条数 | 占比 | 累计 |", "|---|---|---|---|"];
  for (const x of 统计结果.list) lines.push(`| ${x.名} | ${x.数} | ${(x.占比 * 100).toFixed(1)}% | ${(x.累计 * 100).toFixed(1)}% |`);
  lines.push("", "## 明细", "", "| 行 | 登记日期 | 型号 | 分类 | 描述（前 60 字） |", "|---|---|---|---|---|");
  for (const d of 明细) lines.push(`| ${d.行号} | ${d.登记日期} | ${d.型号} | ${d.分类} | ${String(d.描述).replace(/\|/g, "／").replace(/\s+/g, " ").slice(0, 60)} |`);
  return lines.join("\n");
}

function 写分类列(明细, 真写) {
  // 列 N；明细里 行号 已算好
  const 末行 = Math.max(...明细.map((d) => d.行号)) + 1;
  const cells = Array.from({ length: 末行 - 1 }, () => []);
  for (const d of 明细) cells[d.行号 - 2] = [大类(d.分类)];
  console.log(`[计划] N1=问题分类；N2:N${末行} 填 ${明细.length} 行大类`);
  const 计数 = {};
  for (const d of 明细) 计数[大类(d.分类)] = (计数[大类(d.分类)] || 0) + 1;
  console.log("[大类]", JSON.stringify(计数, null, 0));
  if (!真写) { console.log("干跑：加 --写 才真写表。"); return; }
  const 基 = ["--docid", DOCID, "--sheet-id", SHEET];
  // 表头
  execFileSync(process.execPath, [CLI, "sheet", "cells", "batchset", ...基, "--json", JSON.stringify({ range: "N1", cells: [["问题分类"]] })], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // 整列数据（空行用空串，避免把别人的格子清掉：这里只写有明细的行）
  for (const d of 明细) {
    execFileSync(process.execPath, [CLI, "sheet", "cells", "batchset", ...基, "--json", JSON.stringify({ range: `N${d.行号}`, cells: [[大类(d.分类)]] })], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  }
  // 下拉（整列模式，忽略表头 1 行 → 新行自动继承）
  execFileSync(process.execPath, [CLI, "sheet", "validation", "set", ...基, "--json", JSON.stringify({
    range: "N", validation_type: "list", ignore_rows: 1,
    styled_options: 下拉项.map((t) => ({ text: t })),
  })], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // 回读
  const chk = JSON.parse(execFileSync(process.execPath, [CLI, "sheet", "ranges", "get", ...基, "--range", `N1:N${末行}`, "--mode", "default"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const got = (chk.grid_data.rows || []).map((r) => (((r.values || [])[0] || {}).cell_value || {}).text || "");
  const 差 = [];
  if (got[0] !== "问题分类") 差.push(`表头=${got[0]}`);
  for (const d of 明细) if (got[d.行号 - 1] !== 大类(d.分类)) 差.push(`N${d.行号}=${got[d.行号 - 1]}（应 ${大类(d.分类)}）`);
  console.log(差.length ? `[回读] ${差.length} 处不一致：${差.slice(0, 5).join("；")}` : `[回读] 全对（${明细.length} 行 + 表头）`);
}

function main() {
  const argv = process.argv.slice(2);
  const 行 = Number((argv[argv.indexOf("--行") + 1] || 400)) || 400;
  const 明细 = 读表(行);
  if (!明细.length) { console.log("表里没有带描述的记录，先别画图。"); return; }
  const 统计结果 = 统计(明细);
  fs.mkdirSync(输出目录, { recursive: true });
  const 戳 = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  fs.writeFileSync(path.join(输出目录, `分类明细-${戳}.md`), 出明细md(明细, 统计结果), "utf8");
  console.log(`[统计] ${统计结果.总} 条`);
  统计结果.list.forEach((x) => console.log(`  ${x.名}：${x.数}（${(x.占比 * 100).toFixed(1)}%，累计 ${(x.累计 * 100).toFixed(1)}%）`));
  if (argv.includes("--写分类列")) { 写分类列(明细, argv.includes("--写")); return; }
  if (argv.includes("--导出")) return;
  const png = 出图(统计结果, path.join(输出目录, `帕累托-${戳}.png`));
  console.log(`[图] ${png}`);
}

main();
