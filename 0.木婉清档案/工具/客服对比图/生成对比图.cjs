#!/usr/bin/env node
/**
 * 客服对比图（售前 vs 售前 / 售后 vs 售后）
 * 用法：
 *   node 生成对比图.cjs                          # 默认取表里最新一批统计区间
 *   node 生成对比图.cjs --start 2026-10-01 --end 2026-10-21
 *   node 生成对比图.cjs --src <xlsx> --out <png> --keep-html
 * 只读：源表只读不写；出图用本机 Chrome 无头渲染本地 HTML，不登录任何平台。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const XLSX_PATH = 'D:/桌面/木婉清/12.店铺指标数据自动更新/node_modules/xlsx';
const XLSX = require(XLSX_PATH);

const DIR = __dirname;
const DEFAULT_SRC = 'D:/桌面/办公文件/客服数据复盘/客服数据总表.xlsx';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const has = (name) => argv.includes('--' + name);
const SRC = arg('src', DEFAULT_SRC);
const OUT = arg('out', '');
const KEEP_HTML = has('keep-html');
const RANGE = { start: arg('start', null), end: arg('end', null) };

// ---------- 日期工具（Excel 序列号） ----------
const EPOCH = Date.UTC(1899, 11, 30);
const serialToISO = (n) => new Date(EPOCH + Number(n) * 86400000).toISOString().slice(0, 10);
const isoToSerial = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
};

// ---------- 读表 ----------
const wb = XLSX.readFile(SRC);
const sheetName = wb.SheetNames.includes('数据明细') ? '数据明细' : wb.SheetNames[0];
const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
// 表头是第 4 行（0 基 index 3）
const HEADER_ROW = 3;
const head = raw[HEADER_ROW].map((h) => (h == null ? '' : String(h).trim()));
const col = {};
head.forEach((h, i) => { if (h) col[h] = i; });
const need = ['客服姓名', '客服岗位', '店铺名称', '平台', '销售额', '询单人数', '下单人数', '接待会话量', '响应总秒数', '3分钟内响应会话量', '满意评价量', '评价量', '统计开始日', '统计结束日'];
const missing = need.filter((k) => col[k] === undefined);
if (missing.length) throw new Error('表头缺列: ' + missing.join(','));

let rows = raw.slice(HEADER_ROW + 1).filter((r) => r && r[col['客服姓名']] != null && String(r[col['客服姓名']]).trim() !== '');

// ---------- 选定统计区间 ----------
const ranges = new Map();
for (const r of rows) {
  const k = serialToISO(r[col['统计开始日']]) + '~' + serialToISO(r[col['统计结束日']]);
  ranges.set(k, (ranges.get(k) || 0) + 1);
}
let startISO, endISO;
if (RANGE.start || RANGE.end) {
  const latest = [...ranges.keys()].pop().split('~');
  startISO = RANGE.start || latest[0];
  endISO = RANGE.end || latest[1];
} else {
  // 取行数最多的一批
  const best = [...ranges.entries()].sort((a, b) => b[1] - a[1])[0][0].split('~');
  startISO = best[0];
  endISO = best[1];
}
const sSerial = isoToSerial(startISO), eSerial = isoToSerial(endISO);
rows = rows.filter((r) => Number(r[col['统计开始日']]) === sSerial && Number(r[col['统计结束日']]) === eSerial);
if (!rows.length) throw new Error(`区间 ${startISO}~${endISO} 没有数据`);

// ---------- 按客服姓名汇总（跨店 / 跨平台） ----------
const num = (r, k) => { const v = r[col[k]]; const n = Number(v); return Number.isFinite(n) ? n : 0; };
const agg = new Map();
for (const r of rows) {
  const name = String(r[col['客服姓名']]).trim();
  const post = String(r[col['客服岗位']] || '').trim();
  if (!agg.has(name)) agg.set(name, { name, posts: new Set(), sales: 0, ask: 0, order: 0, ctrAsk: 0, ctrOrder: 0, sess: 0, rt: 0, fast: 0, good: 0, evals: 0, stores: new Set() });
  const a = agg.get(name);
  a.posts.add(post);
  a.stores.add(String(r[col['店铺名称']] || ''));
  a.sales += num(r, '销售额');
  a.ask += num(r, '询单人数');
  a.order += num(r, '下单人数');
  // 黎路遥 2026-10-23：转化率剔掉拼多多平台行（业绩/接待量等照旧含拼多多）
  const platform = String(r[col['平台']] == null ? '' : r[col['平台']]).trim();
  if (!/拼多多|pdd/i.test(platform)) {
    a.ctrAsk += num(r, '询单人数');
    a.ctrOrder += num(r, '下单人数');
  }
  a.sess += num(r, '接待会话量');
  a.rt += num(r, '响应总秒数');
  a.fast += num(r, '3分钟内响应会话量');
  a.good += num(r, '满意评价量');
  a.evals += num(r, '评价量');
}

const badPost = [...agg.values()].filter((a) => a.posts.size > 1);
if (badPost.length) {
  console.log('[需确认] 同一个名字出现两个岗位：' + badPost.map((a) => a.name + '(' + [...a.posts].join('/') + ')').join('、'));
}

const people = [...agg.values()].map((a) => {
  const post = [...a.posts][0];
  const div = (x, y) => (y > 0 ? x / y : null);
  return {
    name: a.name, post, stores: a.stores.size,
    sales: a.sales, ask: a.ask, order: a.order, sess: a.sess,
    ctr: div(a.ctrOrder, a.ctrAsk),
    art: div(a.rt, a.sess),
    fast: div(a.fast, a.sess),
    sat: div(a.good, a.evals),
  };
});

const pre = people.filter((p) => p.post === '售前');
const post = people.filter((p) => p.post === '售后');
if (!pre.length) throw new Error('没有售前数据');

// 售后是否有销售类数据（售价 + 询单都为空/0 → 视为没有）
const postHasSales = post.some((p) => p.sales > 0 || p.ask > 0);
// 售后销售额是否只来自部分平台（天猫售后无分摊）→ 用于脚注
const postStoresWithSales = new Set(rows.filter((r) => String(r[col['客服岗位']]).trim() === '售后' && num(r, '销售额') > 0).map((r) => String(r[col['店铺名称']] || '')));

// ---------- 格式化 ----------
const pct = (v) => (v == null ? '' : (v * 100).toFixed(2) + '%');
const money = (v) => Math.round(v).toLocaleString('en-US');
const sec = (v) => (v == null ? '' : v.toFixed(2));
const int = (v) => Math.round(v).toLocaleString('en-US');

// ---------- 卡片定义 ----------
// 终版（黎路遥 2026-10-23 三条合并）：售前 6 张 + 售后 4 张 + 统计时间 1 张。
const cards = [];
if (pre.length) {
  cards.push({ title: '售前转化率排名', rows: pre, key: 'ctr', dir: 'desc', fmt: pct });
  cards.push({ title: '售前业绩排名', rows: pre, key: 'sales', dir: 'desc', fmt: money });
  cards.push({ title: '售前平均响应时间', rows: pre, key: 'art', dir: 'asc', fmt: sec });
  cards.push({ title: '售前满意度', rows: pre, key: 'sat', dir: 'desc', fmt: pct });
  cards.push({ title: '售前3分钟响应率', rows: pre, key: 'fast', dir: 'desc', fmt: pct });
  cards.push({ title: '售前接待量', rows: pre, key: 'sess', dir: 'desc', fmt: int });
}
if (post.length) {
  // 售后不出转化率、不出业绩
  cards.push({ title: '售后平均响应时间', rows: post, key: 'art', dir: 'asc', fmt: sec });
  cards.push({ title: '售后满意度', rows: post, key: 'sat', dir: 'desc', fmt: pct });
  cards.push({ title: '售后3分钟响应率', rows: post, key: 'fast', dir: 'desc', fmt: pct });
  cards.push({ title: '售后接待量', rows: post, key: 'sess', dir: 'desc', fmt: int });
}

// ---------- SVG 柱状图 ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CARD_W = 380, CARD_H = 290, COLS = 4, GAP = 16, PAD = 56;
const SVG_W = 346, SVG_H = 230;
const BASE_Y = 186, MAX_BAR = 140;

function barCard(card) {
  const list = card.rows
    .filter((p) => p[card.key] != null && Number(p[card.key]) >= 0)
    .sort((a, b) => (card.dir === 'asc' ? a[card.key] - b[card.key] : b[card.key] - a[card.key]))
    .slice(0, 8);
  if (!list.length) return `<div class="card"><h3>${esc(card.title)}</h3><div class="empty">无数据</div></div>`;
  const max = Math.max(...list.map((p) => Number(p[card.key]))) || 1;
  const slot = SVG_W / list.length;
  const bw = Math.min(38, Math.max(14, slot * 0.52));
  const grid = [0, 1, 2, 3].map((i) => {
    const y = BASE_Y - (MAX_BAR * i) / 3;
    return `<line x1="0" y1="${y.toFixed(1)}" x2="${SVG_W}" y2="${y.toFixed(1)}" stroke="#eef0f3" stroke-width="1"${i === 0 ? ' stroke="#e3e6ea"' : ''}/>`;
  }).join('');
  const bars = list.map((p, i) => {
    const v = Number(p[card.key]);
    const h = Math.max(2, (v / max) * MAX_BAR);
    const x = i * slot + (slot - bw) / 2;
    const y = BASE_Y - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#2b6cf5"/>`
      + `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" class="val">${esc(card.fmt(v))}</text>`
      + `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${BASE_Y + 22}" class="name">${esc(p.name)}</text>`;
  }).join('');
  return `<div class="card"><h3>${esc(card.title)}</h3><svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">${grid}${bars}</svg></div>`;
}

function timeCard() {
  const label = (iso) => iso.replace(/-/g, '/');
  const items = [
    { x: SVG_W * 0.28, text: label(startISO) },
    { x: SVG_W * 0.72, text: label(endISO) },
  ];
  const bw = 44, h = MAX_BAR;
  const bars = items.map((it) => {
    const y = BASE_Y - h;
    return `<rect x="${(it.x - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${h}" rx="2" fill="#2b6cf5"/>`
      + `<text x="${it.x.toFixed(1)}" y="${(y - 10).toFixed(1)}" class="date">${esc(it.text)}</text>`;
  }).join('');
  return `<div class="card"><h3>统计时间</h3><svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">${bars}</svg></div>`;
}

const cardHTML = cards.map(barCard).join('') + timeCard();

// ---------- 脚注 ----------
const notes = [];
notes.push('售后不出转化率和业绩（黎路遥 2026-10-23 定）；售前业绩照旧含拼多多。');
notes.push(`口径：按客服姓名汇总跨店数据；转化率=下单人数÷询单人数（不含拼多多平台行），平均响应时长=响应总秒数÷接待会话量，3分钟响应率与满意度按会话/评价量加权。`);
const noteHTML = `<div class="foot">${notes.map(esc).join('<br>')}</div>`;

const rowCount = Math.ceil((cards.length + 1) / COLS);
const PAGE_H = PAD * 2 + rowCount * CARD_H + (rowCount - 1) * GAP + 40;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>客服对比图 ${startISO}~${endISO}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:1680px;background:#f5f6f8;font-family:"Microsoft YaHei","微软雅黑",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{width:1680px;padding:${PAD}px;display:grid;grid-template-columns:repeat(${COLS},${CARD_W}px);gap:${GAP}px;align-items:start}
.card{width:${CARD_W}px;height:${CARD_H}px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 16px 10px}
.card h3{font-size:14px;font-weight:700;color:#111827;line-height:20px;margin-bottom:10px}
.card svg{display:block}
.empty{font-size:12px;color:#9ca3af;padding-top:60px;text-align:center}
text.val{font-size:13px;font-weight:600;fill:#1f2937;text-anchor:middle}
text.name{font-size:12px;fill:#6b7280;text-anchor:middle}
text.date{font-size:14px;font-weight:600;fill:#e5484d;text-anchor:middle}
.foot{grid-column:1 / -1;font-size:12px;line-height:20px;color:#9ca3af;padding-top:4px}
</style></head>
<body><div class="wrap">${cardHTML}${noteHTML}</div></body></html>`;

const htmlPath = path.join(DIR, `对比图-${startISO}_${endISO}.html`);
fs.writeFileSync(htmlPath, html, 'utf8');

// ---------- 截图 ----------
const outPath = OUT || path.join(DIR, `客服对比图-${startISO.replace(/-/g, '')}-${endISO.replace(/-/g, '')}.png`);
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/').replace(/^\//, '');
const args = [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--force-device-scale-factor=2', `--window-size=1680,${PAGE_H}`,
  `--screenshot=${outPath.replace(/\//g, '\\')}`, fileUrl,
];
const r = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 120000 });
if (r.status !== 0 || !fs.existsSync(outPath)) {
  console.error('[截图失败]', r.status, (r.stderr || '').slice(-800));
  process.exit(1);
}
if (!KEEP_HTML) fs.unlinkSync(htmlPath);

// ---------- 汇总（供回执） ----------
const f = (k, v) => (v == null ? '—' : v);
console.log(`数据区间：${startISO} ~ ${endISO}（Excel ${sSerial}/${eSerial}）`);
console.log(`参与人数：售前 ${pre.length} 人 / 售后 ${post.length} 人，明细 ${rows.length} 行`);
console.log(`售后销售类数据：${postHasSales ? '有（' + [...postStoresWithSales].join('、') + '）' : '没有'}`);
const summary = [
  ['转化率', 'ctr', 'desc', pct], ['业绩', 'sales', 'desc', money],
  ['平均响应时长', 'art', 'asc', sec], ['满意度', 'sat', 'desc', pct],
  ['3分钟响应率', 'fast', 'desc', pct], ['接待量', 'sess', 'desc', int],
];
for (const [label, key, dir, fmt] of summary) {
  for (const g of [pre, post]) {
    if (!g.length) continue;
    const ok = g.filter((p) => p[key] != null);
    if (!ok.length) { console.log(`${g[0].post}·${label}：无数据`); continue; }
    const s = ok.sort((a, b) => (dir === 'asc' ? a[key] - b[key] : b[key] - a[key]));
    console.log(`${g[0].post}·${label}：Top1 ${s[0].name} ${fmt(s[0][key])} ｜ 末位 ${s[s.length - 1].name} ${fmt(s[s.length - 1][key])}`);
  }
}
console.log('成品：' + outPath);
console.log('页面高度：' + PAGE_H + 'px，卡片数：' + (cards.length + 1));
console.log('截图命令：');
console.log(`"${CHROME.replace(/\//g, '\\')}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
