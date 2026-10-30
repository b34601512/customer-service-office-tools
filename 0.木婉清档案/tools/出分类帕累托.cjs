// 33号《产品问题反馈表》→ 按「问题分类」列出帕累托图（8 个标准分类）
// 只读表；不写表。用法：node 出分类帕累托.cjs
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const CLI = "C:/Users/b3460/AppData/Roaming/npm/node_modules/@wecom/cli/bin/wecom.js";
const DOCID = "e3_AFMAdwb9AAYCNWqYmWTycQumhjFGA";
const SHEET = "BB08J2";
const 末行 = Number(process.argv[2] || 93);

const j = JSON.parse(execFileSync(process.execPath, [
  CLI, "sheet", "cells", "get", "--docid", DOCID, "--sheet", SHEET, "--range", `N1:N${末行}`,
], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const 值 = (j.cells || []).map((r) => (r[0] == null ? "" : String(r[0]))).slice(1).filter(Boolean);

const m = new Map();
值.forEach((x) => m.set(x, (m.get(x) || 0) + 1));
const list = [...m.entries()].map(([名, 数]) => ({ 名, 数 })).sort((a, b) => b.数 - a.数);
const 总 = list.reduce((s, x) => s + x.数, 0);
let acc = 0;
list.forEach((x) => { x.占比 = x.数 / 总; acc += x.占比; x.累计 = acc; });

const W = 1180, H = 560, L = 70, R = 60, T = 60, B = 140;
const iw = W - L - R, ih = H - T - B;
const max = list[0].数, bw = iw / list.length;
const y = (p) => T + ih - p * ih;

const grid = [0, 0.25, 0.5, 0.75, 1].map((p) =>
  `<line x1="${L}" y1="${y(p).toFixed(1)}" x2="${W - R}" y2="${y(p).toFixed(1)}" stroke="#e5e7eb"/>` +
  `<text x="${L - 8}" y="${(y(p) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b7280">${Math.round(max * p)}</text>` +
  `<text x="${W - R + 8}" y="${(y(p) + 4).toFixed(1)}" font-size="11" fill="#6b7280">${Math.round(p * 100)}%</text>`).join("");

const bars = list.map((x, i) => {
  const h = (x.数 / max) * ih;
  const x0 = L + i * bw + bw * 0.15;
  return `<rect x="${x0.toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" fill="#2b6cf5" rx="2"/>` +
    `<text x="${(x0 + bw * 0.35).toFixed(1)}" y="${(T + ih - h - 6).toFixed(1)}" text-anchor="middle" font-size="12" fill="#1f2937">${x.数}</text>`;
}).join("");

const pts = list.map((x, i) => `${(L + i * bw + bw / 2).toFixed(1)},${y(x.累计).toFixed(1)}`).join(" ");
const dots = list.map((x, i) => `<circle cx="${(L + i * bw + bw / 2).toFixed(1)}" cy="${y(x.累计).toFixed(1)}" r="3" fill="#f59e0b"/>`).join("");
const labels = list.map((x, i) => {
  const cx = L + i * bw + bw / 2;
  return `<text x="${cx.toFixed(1)}" y="${T + ih + 22}" text-anchor="end" font-size="12" fill="#374151" transform="rotate(-30 ${cx.toFixed(1)} ${T + ih + 22})">${x.名}</text>`;
}).join("");

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>body{margin:0;font-family:"Microsoft YaHei",SimSun}h1{font-size:20px;margin:20px 28px 4px}.sub{font-size:13px;color:#6b7280;margin:0 28px 6px}</style></head><body>
<h1>产品问题反馈 · 标准分类帕累托图</h1>
<div class="sub">《产品问题反馈表》｜有描述记录 ${总} 条｜8 个标准分类｜柱＝条数，折线＝累计占比</div>
<svg width="${W}" height="${H}">${grid}${bars}<polyline points="${pts}" fill="none" stroke="#f59e0b" stroke-width="2"/>${dots}${labels}
<text x="${L}" y="${T - 26}" font-size="12" fill="#2b6cf5">■ 条数</text>
<text x="${L + 70}" y="${T - 26}" font-size="12" fill="#f59e0b">— 累计占比</text></svg></body></html>`;

const 输出目录 = path.join(__dirname, "..", "outputs", "产品问题分类");
fs.mkdirSync(输出目录, { recursive: true });
const htmlPath = path.join(输出目录, "帕累托-8类.html");
fs.writeFileSync(htmlPath, html, "utf8");
const png = path.join(输出目录, "帕累托-8类-20261030.png");
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1240,660", `--screenshot=${png}`, `file:///${htmlPath.replace(/\\/g, "/")}`], { encoding: "utf8", timeout: 120000 });

list.forEach((x) => console.log(`${x.名}: ${x.数}（${(x.占比 * 100).toFixed(1)}%，累计 ${(x.累计 * 100).toFixed(1)}%）`));
console.log("图：", png);
