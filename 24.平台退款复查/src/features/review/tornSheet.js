// 金山《撕单表》只读加载 + 订单号匹配（2026-09-27 抽出来，pipeline 与京东仅退款脚本共用）
//
// 为什么必须查：**撕单 = 快递面单撕掉、货没发走 = 安全**。
//   实测教训（2026-09-27 用户点出）：京东仅退款 44 单「漏退回」里 **28 单其实撕过单**
//   （27 单「已撕」+ 1 单「货发走了，通知客服拦截」）——少查这张表会把安全的判成风险。
//
// 表结构：read-kdocs 产物是 `matrix`（**不是 rows**），17 列；
//   表头含「登记日期 / 登记人 / 型号规格 / 数量 / 购买店铺 / 客户 / 平台单号 / 快单单号 / 撕单理由 / 撕单状态 / 处理人 / 撕单时间」。
//   「撕单状态」是自由文本（已撕 / 货发走了，通知客服拦截 / …）→ **原文交模型读，脚本不判关键词**。
//
// 用法：
//   const { loadTornRows, matchTornRows } = require("./tornSheet");
//   const rows = loadTornRows();                       // 12h 内复用上次读的产物
//   const hit = matchTornRows(rows, "3547463001710841");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { projectPath } = require("../../config/stores");
const { normalizeOrderNo } = require("./orderNoMatch");
const { log } = require("../../engine/log");

const TORN_SHEET_URL = readLocalKdocsUrl("sidanTable", "https://www.kdocs.cn/l/<撕单表分享ID>");
const TORN_SHEET_NAME = "撕单表";
const DEFAULT_REUSE_SECONDS = 12 * 3600;

function readLocalKdocsUrl(key, fallback) {
  // 这里从本机 project-config/kdocs-links.local.json 读真实表链接（该文件已 gitignore）；没配置时返回占位值。
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(projectPath("project-config"), "kdocs-links.local.json"), "utf8"));
    const value = String(payload[key] || "").trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function stampNow() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function latestTornFile(dir) {
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter((name) => name.startsWith("撕单表-") && name.endsWith(".json")).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : "";
}

// 读《撕单表》→ 结构化行。file 指定就直接用；否则 12h 内复用上次产物，过期才重新读（读一次约 1 分钟）。
function loadTornRows(options = {}) {
  const dir = projectPath("runtime", "review");
  const reuseSeconds = options.reuseSeconds === undefined ? DEFAULT_REUSE_SECONDS : options.reuseSeconds;
  let file = options.file || "";
  if (!file && reuseSeconds > 0) {
    const candidate = latestTornFile(dir);
    if (candidate && Date.now() - fs.statSync(candidate).mtimeMs < reuseSeconds * 1000) file = candidate;
  }
  if (!file) {
    file = projectPath("runtime", "review", `撕单表-${stampNow()}.json`);
    log("撕单表", "开始", "只读整表（网页可整表读，实测 5608 行）");
    execFileSync(process.execPath, ["src/tools/read-kdocs.js", "--url", TORN_SHEET_URL, "--sheet", TORN_SHEET_NAME, "--out", path.relative(projectPath(), file)], { cwd: projectPath(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  const matrix = JSON.parse(fs.readFileSync(file, "utf8")).matrix || [];
  const header = (matrix[0] || []).map((x) => String(x || "").trim());
  const index = (...names) => {
    for (const name of names) {
      const hit = header.findIndex((h) => h.includes(name));
      if (hit >= 0) return hit;
    }
    return -1;
  };
  const cols = {
    date: index("登记日期"), people: index("登记人"), model: index("型号"), count: index("数量"), shop: index("购买店铺"),
    customer: index("客户"), code: index("平台单号"), express: index("快单单号"), reason: index("撕单理由"),
    status: index("撕单状态"), handler: index("处理人"), tornAt: index("撕单时间")
  };
  const rows = [];
  for (const row of matrix.slice(1)) {
    const pick = (i) => (i >= 0 && row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : "");
    const code = pick(cols.code);
    if (!code) continue;
    rows.push({
      code, codeKey: normalizeOrderNo(code),
      date: pick(cols.date), people: pick(cols.people), model: pick(cols.model), count: pick(cols.count),
      shop: pick(cols.shop), customer: pick(cols.customer), express: pick(cols.express),
      reason: pick(cols.reason), status: pick(cols.status), handler: pick(cols.handler), tornAt: pick(cols.tornAt),
      file: path.basename(file)
    });
  }
  log("撕单表", "完成", `${rows.length} 行`, path.relative(projectPath(), file));
  return rows;
}

// 一行「平台单号」单元格里可能塞多个单号（用 、/ ，/ 空格分隔）→ 逐个归一化比对。
function matchTornRows(rows, orderNo) {
  const target = normalizeOrderNo(orderNo);
  if (!target) return [];
  const hits = [];
  for (const row of rows) {
    const parts = String(row.code || "").split(/[、,，;；\s/|]+/).filter(Boolean);
    if (parts.some((part) => normalizeOrderNo(part) === target) || row.codeKey === target) hits.push(row);
  }
  return hits;
}

module.exports = { loadTornRows, matchTornRows, TORN_SHEET_URL };
