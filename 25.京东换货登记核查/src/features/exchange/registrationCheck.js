// 25号 判定核心：京东「上门换新取件」登记是否规范（纯函数，方便反向断言测试）
//
// 业务（用户 2026-09-27 交代 + 当天二次修正口径）：
//   京东上门换新 = 京东仓直接给客户换出新机，客户的故障机要寄回我们工厂；
//   客服在《怀化对接表》→「换货维修登记表」登记一条，工厂才知道这台机器是谁寄回的。
//
//   **要防的是「重复换货」：登记里填多了（尤其是客户地址），工厂就可能照着又寄一台。**
//   所以口径（用户 2026-09-27 明确：「空着没事，主要是反而填多了反而有问题」）：
//     ✅ 规范 = 地址列**空** + 三个选项列**空或「无需处理」**
//     ⚠ 风险 = 地址列填了内容（最危险：工厂可能照着寄）
//     ⚠ 待核 = 三个选项列填了别的值（不是「无需处理」也不空 → 看是不是给工厂布置了动作，原文交人/模型读）
//     ⚠ 风险 = 压根没登记
//   注意：**空值不算问题**（2026-09-27 前的老口径把空值当问题，已按用户修正）。
//
// 为什么要抽成纯函数：这段判定是「防止白亏一台机器」的唯一闸门，
//   用 tests/exchangeRegistration.test.js 把口径钉死（改回「空值=问题」、漏判地址非空，测试都会红）。
const NO_ACTION = "无需处理";
// 需要留意的列（与金山表列号对齐，见 scripts/复查京东上门换新登记.js 的 COLUMN）
const OPTION_COLUMNS = [
  { index: 17, name: "质保标准" },
  { index: 18, name: "客户寄给厂家的运费" },
  { index: 19, name: "厂家寄给客户的运费" }
];
const ADDRESS_COLUMN = { index: 10, name: "地址" };
const INFORMATIONAL_COLUMNS = [
  { index: 16, name: "处理方式" },
  { index: 23, name: "备注" }
];

// 从一行的 cells（[{c,v}]）里取某列文字；拿不到列号（老版脚本）返回 null
function cellText(cells, columnIndex) {
  if (!Array.isArray(cells) || !cells.length) return null;
  const hit = cells.find((item) => Number(item.c) === Number(columnIndex));
  return hit ? String(hit.v === undefined || hit.v === null ? "" : hit.v).trim() : "";
}

function clip(text, length) {
  const limit = length || 30;
  return String(text).slice(0, limit);
}

// 判定一条登记行 → { problems: [{level,text}], coarse }
function judgeRow(row) {
  const cells = row && row.cells;
  if (!Array.isArray(cells) || !cells.length) {
    // 老版脚本：只有非空值，列位置丢失 → 退化为粗判（调用方会标出来）
    return { problems: [], coarse: true };
  }
  const problems = [];
  const address = cellText(cells, ADDRESS_COLUMN.index);
  if (address) {
    problems.push({ level: "risk", text: `地址列填了「${clip(address)}」—— 填了工厂可能照着又寄一台` });
  }
  for (const column of OPTION_COLUMNS) {
    const value = cellText(cells, column.index);
    if (!value) continue;                 // 空着没事（用户 2026-09-27 拍板）
    if (value === NO_ACTION) continue;    // 「无需处理」= 规范
    problems.push({ level: "warn", text: `${column.name}=「${clip(value, 40)}」（不是「无需处理」，核对是不是给工厂布置了动作）` });
  }
  return { problems, coarse: false };
}

// 判定一个订单：rows = 匹配到的登记行（可能多行/0 行）
//   返回 { verdict: ok | warn | risk | missing | coarse, problems: [文字] }
function judgeOrder(rows) {
  if (!rows || !rows.length) {
    return { verdict: "missing", problems: ["未登记（工厂不知道这台机器是谁寄回的）"] };
  }
  const problems = [];
  let hasRisk = false;
  let hasWarn = false;
  let coarseOnly = true;
  for (const row of rows) {
    const judged = judgeRow(row);
    if (judged.coarse) continue;
    coarseOnly = false;
    for (const problem of judged.problems) {
      if (problem.level === "risk") hasRisk = true;
      else hasWarn = true;
      problems.push(`第 ${row.row} 行：${problem.text}`);
    }
  }
  if (coarseOnly) return { verdict: "coarse", problems: [] };
  if (hasRisk) return { verdict: "risk", problems };
  if (hasWarn) return { verdict: "warn", problems };
  return { verdict: "ok", problems };
}

// 报告用：把「处理方式 / 备注」这类只看不判的列抓原文（自由文本交模型读，别用关键词判）
function informationalOf(cells) {
  const out = {};
  for (const column of INFORMATIONAL_COLUMNS) out[column.name] = cellText(cells, column.index);
  return out;
}

module.exports = { judgeOrder, judgeRow, cellText, informationalOf, OPTION_COLUMNS, ADDRESS_COLUMN, INFORMATIONAL_COLUMNS, NO_ACTION };
