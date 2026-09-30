// 金山《2026年【交接&跟进】表》→「快递问题」工作表：**丢件/破损是否已理赔**（用户 2026-09-27 口径）
//
// 规则（用户原话）：「查丢件的看快递理赔没有，如果理赔了就不管了。」
//   → 命中且**理赔金额 > 0** = 已理赔 = **不用管**；「无需理赔」/ 0 元 = 还没赔，得看。
//
// 表结构（2026-09-27 实测，488 行 × 27 列，链接 https://www.kdocs.cn/l/<快递理赔表分享ID>）：
//   0 登记客服 | 1 登记时间 | 2 店铺名称 | 3 产品型号 | **4 订单号（表头误写「，」）** | 5 客户地址 |
//   6 发货时间 | 7 订单金额 | 8 快递公司 | 9 寄出运单（形如「圆通速递运单号:YT*********5762」）|
//   **10 理赔金额（元）** | **11 理赔方式**（圆通月结 / 无需理赔 / 顺丰月结 …）| 14 理赔截图 | 15 财务备注 |
//   16 客服备注理赔原因 | 17 客户订单最终处理方式 | **18 处理结果**（已完结 …）
//
// ⚠ 该表作者原本设了「需要登录查看」（匿名读不到）；2026-09-27 用户改成可只读分享后打通。
// ⚠ 另一个工作表「快递理赔分析」是**汇总透视表**（按年/月×快递公司的理赔金额），不是逐单表，别拿它匹配单号。
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { projectPath } = require("../../config/stores");
const { normalizeOrderNo } = require("./orderNoMatch");
const { log } = require("../../engine/log");

const HANDOVER_URL = readLocalKdocsUrl("courierClaimTable", "https://www.kdocs.cn/l/<快递理赔表分享ID>");
const HANDOVER_SHEET = "快递问题";
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
const COLUMNS = { orderNo: 4, express: 9, claimAmount: 10, claimWay: 11, reason: 16, result: 18, shop: 2, date: 1, product: 3, goodsValue: 7 };

function stampNow() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function latestFile(dir, prefix) {
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith(".json")).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : "";
}

// 读「快递问题」表 → 结构化行（12h 内复用上次产物，读一次约 40 秒）
function loadCourierClaims(options = {}) {
  const dir = projectPath("runtime", "review");
  const reuseSeconds = options.reuseSeconds === undefined ? DEFAULT_REUSE_SECONDS : options.reuseSeconds;
  let file = options.file || "";
  if (!file && reuseSeconds > 0) {
    const candidate = latestFile(dir, "快递问题-");
    if (candidate && Date.now() - fs.statSync(candidate).mtimeMs < reuseSeconds * 1000) file = candidate;
  }
  if (!file) {
    file = projectPath("runtime", "review", `快递问题-${stampNow()}.json`);
    log("交接跟进表", "开始", "只读「快递问题」工作表");
    execFileSync(process.execPath, ["src/tools/read-kdocs.js", "--url", HANDOVER_URL, "--sheet", HANDOVER_SHEET, "--out", path.relative(projectPath(), file)], { cwd: projectPath(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  const matrix = JSON.parse(fs.readFileSync(file, "utf8")).matrix || [];
  const rows = [];
  for (const row of matrix.slice(1)) {
    const cell = (index) => (row[index] === undefined || row[index] === null ? "" : String(row[index]).replace(/\s+/g, " ").trim());
    const orderNo = cell(COLUMNS.orderNo);
    if (!orderNo) continue;
    const claimText = cell(COLUMNS.claimAmount);
    const claimNumber = Number(String(claimText).replace(/[^\d.]/g, "")) || 0;
    rows.push({
      orderNo, orderKey: normalizeOrderNo(orderNo),
      shop: cell(COLUMNS.shop), date: cell(COLUMNS.date), product: cell(COLUMNS.product),
      goodsValue: cell(COLUMNS.goodsValue), express: cell(COLUMNS.express),
      claimAmount: claimText, claimAmountNumber: claimNumber, claimWay: cell(COLUMNS.claimWay),
      reason: cell(COLUMNS.reason), result: cell(COLUMNS.result),
      // 已理赔 = 理赔金额 > 0（「无需理赔」/0 元不算）
      claimed: claimNumber > 0,
      file: path.basename(file)
    });
  }
  log("交接跟进表", "完成", `${rows.length} 行（已理赔 ${rows.filter((r) => r.claimed).length} 行）`, path.relative(projectPath(), file));
  return rows;
}

// 订单号列可能带后缀/多单号（如「2111671981611541254」）；单元格里也可能混着文字 → 拆开逐个归一化比。
function matchCourierClaims(rows, orderNo) {
  const target = normalizeOrderNo(orderNo);
  if (!target) return [];
  return rows.filter((row) => {
    if (row.orderKey === target) return true;
    const parts = String(row.orderNo || "").split(/[、,，;；\s/|]+/).filter(Boolean);
    return parts.some((part) => normalizeOrderNo(part) === target);
  });
}

module.exports = { loadCourierClaims, matchCourierClaims, HANDOVER_URL };
