// 25号 判定核心：京东「上门换新取件」登记是否规范（纯函数，方便反向断言测试）
//
// 业务（用户 2026-09-27）：京东上门换新 = 京东仓直接给客户换出新机，客户的故障机要寄回我们工厂；
//   客服在《怀化对接表》→「换货维修登记表」登记，工厂才知道是谁寄回的。
//   **规范 = 地址列不填（填了工厂可能再寄一台）+ 质保标准/客户寄给厂家的运费/厂家寄给客户的运费 都选「无需处理」**。
//
// 为什么要抽成纯函数：这段判定是「防止白亏一台机器」的唯一闸门，
//   用 tests/exchangeRegistration.test.js 把口径钉死（少判一项、把空值当通过，测试都会红）。
const NO_ACTION = "无需处理";
// 需要等于「无需处理」的列（与金山表列号对齐，见 scripts/复查京东上门换新登记.js 的 COLUMN）
const OPTION_COLUMNS = [
  { index: 17, name: "质保标准" },
  { index: 18, name: "客户寄给厂家的运费" },
  { index: 19, name: "厂家寄给客户的运费" }
];
const ADDRESS_COLUMN = { index: 10, name: "地址" };

// 从一行的 cells（[{c,v}]）里取某列文字；拿不到列号（老版脚本）返回 null
function cellText(cells, columnIndex) {
  if (!Array.isArray(cells) || !cells.length) return null;
  const hit = cells.find((item) => Number(item.c) === Number(columnIndex));
  return hit ? String(hit.v === undefined || hit.v === null ? "" : hit.v).trim() : "";
}

// 判定一条登记行 → { ok, problems[] }
function judgeRow(row) {
  const problems = [];
  const cells = row && row.cells;
  const hasColumns = Boolean(Array.isArray(cells) && cells.length);
  if (hasColumns) {
    const address = cellText(cells, ADDRESS_COLUMN.index);
    if (address) problems.push(`地址列填了内容：「${address.slice(0, 30)}」`);
    for (const column of OPTION_COLUMNS) {
      const value = cellText(cells, column.index);
      if (value !== NO_ACTION) problems.push(`${column.name}=「${value || "(空)"}」（应为「${NO_ACTION}」）`);
    }
  } else {
    // 老版脚本：只有非空值，列位置丢失 → 退化为粗判（调用方会标出来）
    return { ok: null, problems: [], coarse: true };
  }
  return { ok: problems.length === 0, problems, coarse: false };
}

// 判定一个订单：rows = 匹配到的登记行（可能多行/0 行）
function judgeOrder(rows) {
  if (!rows || !rows.length) {
    return { verdict: "missing", problems: ["未登记（工厂不知道这台机器是谁寄回的）"] };
  }
  const problems = [];
  let coarseOnly = true;
  for (const row of rows) {
    const verdict = judgeRow(row);
    if (verdict.coarse) continue;
    coarseOnly = false;
    for (const problem of verdict.problems) problems.push(`第 ${row.row} 行：${problem}`);
  }
  if (coarseOnly) return { verdict: "coarse", problems: [] };
  return { verdict: problems.length ? "risk" : "ok", problems };
}

module.exports = { judgeOrder, judgeRow, cellText, OPTION_COLUMNS, ADDRESS_COLUMN, NO_ACTION };
