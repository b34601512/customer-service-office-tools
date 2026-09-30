// 7号：写入验收（**写前记录 → 写后记录 → 逐行对比**）。
// 用户 2026-09-30 要求：「写前做一个记录，写后做个记录，对比一下，避免覆盖别的人」。
// 这里只做纯计算（快照抓取 + 对比），写入动作仍在 src/登记写入.js，闸门顺序不变。

/** 把只读脚本 dump 出来的 "A=46289 | J=xxx" 解析成 { A: "46289", J: "xxx" }。 */
function 解析行值(值列表) {
  const 结果 = {};
  for (const 项 of Array.isArray(值列表) ? 值列表 : []) {
    const 文本 = String(项 || "");
    const 位置 = 文本.indexOf("=");
    if (位置 <= 0) continue;
    const 字母 = 文本.slice(0, 位置).trim();
    let 值 = 文本.slice(位置 + 1).trim();
    // compactRow 可能带 " ⟵ 公式" 尾巴，对比时去掉
    const 箭头 = 值.indexOf(" ⟵ ");
    if (箭头 >= 0) 值 = 值.slice(0, 箭头).trim();
    if (!/^[A-Z]{1,2}$/.test(字母)) continue;
    结果[字母] = 值;
  }
  return 结果;
}

/** 归一化：数字串（≤15 位）按数值比，其余按文本比；空值统一成 ""。 */
function 归一(值) {
  const 文本 = String(值 === undefined || 值 === null ? "" : 值).trim();
  if (!文本) return "";
  const 纯数字 = /^-?\d+(\.\d+)?$/.test(文本);
  if (纯数字 && 文本.replace(/[^0-9]/g, "").length <= 15) return String(Number(文本));
  return 文本;
}

/** 抓一段行的快照：{ 行: { 行号: {字母:值} } }。跑读脚本 = (请求) => 结果。 */
async function 抓快照(跑读脚本, 表名, 起始行, 结束行) {
  const 结果 = await 跑读脚本({ rowFrom: 起始行, rowTo: 结束行, dumpMax: 200, sheets: [表名] });
  const 行 = {};
  for (const 项 of (结果 && 结果.dump) || []) {
    if (项 && 项.sheet && 项.sheet !== 表名) continue;
    if (!项 || !项.row) continue;
    行[项.row] = 解析行值(项.values);
  }
  return { 表名, 起始行, 结束行, 行, 脚本版本: 结果 && 结果.scriptVersion };
}

/**
 * 对比写前/写后快照。
 * 期望列 = { 字母: 值 }（要写进去的列），目标行 = 写入行号，商品行数 = 本单占几行（正常 1）。
 */
function 对比快照(写前, 写后, 目标行, 期望列, 商品行数 = 1) {
  const 问题 = [];
  const 变化行 = [];
  const 期望 = 期望列 || {};

  const 目标行后 = (写后.行 || {})[目标行];
  if (!目标行后) 问题.push(`写后读不到第 ${目标行} 行（可能行号判定不对）`);
  else {
    for (const [字母, 值] of Object.entries(期望)) {
      const 实际 = 目标行后[字母];
      if (归一(实际) !== 归一(值)) 问题.push(`第 ${目标行} 行 ${字母} 列：期望「${归一(值)}」，实际「${归一(实际)}」`);
    }
    if (期望.J && 归一(目标行后.J) !== 归一(期望.J)) 问题.push(`第 ${目标行} 行订单号没对上（J=${目标行后.J}）`);
  }

  // 除目标行外，其它行必须一模一样 —— 这是「不覆盖别人」的硬判据。
  const 行号集合 = new Set([...Object.keys(写前.行 || {}), ...Object.keys(写后.行 || {})].map(Number));
  for (const 号 of [...行号集合].sort((a, b) => a - b)) {
    if (号 === 目标行) continue;
    const 前 = (写前.行 || {})[号] || {};
    const 后 = (写后.行 || {})[号] || {};
    const 字母集合 = new Set([...Object.keys(前), ...Object.keys(后)]);
    for (const 字母 of 字母集合) {
      if (归一(前[字母]) !== 归一(后[字母])) {
        问题.push(`第 ${号} 行 ${字母} 列被改动了（写前「${归一(前[字母])}」→ 写后「${归一(后[字母])}」）—— 可能覆盖了别人的行`);
        变化行.push(号);
      }
    }
  }

  if (写后.下一个可写行 && Number(写后.下一个可写行) !== Number(目标行) + 商品行数) {
    问题.push(`下一个可写行：期望 ${Number(目标行) + 商品行数}，实际 ${写后.下一个可写行}（行数不对）`);
  }

  return { 通过: 问题.length === 0, 问题, 变化行: [...new Set(变化行)], 目标行 };
}

module.exports = { 解析行值, 归一, 抓快照, 对比快照 };
