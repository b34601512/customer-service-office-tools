// 订单号归一化匹配（用户 2026-09-27 指出：怀化表里订单号常夹着空格/不可见字符，
// 他手工时代必须「清除特殊字符、清除不可见字符」才能 VLOOKUP 到）。
//
// 规则：比对前把两边都归一化——
//   · 去掉 Excel 文本前缀撇号（' 和中文引号）
//   · 去掉所有空白（半角/全角空格、不换行空格、制表符、换行）
//   · 去掉零宽与方向控制字符（\u200b-\u200f、\u202a-\u202e、\ufeff）
//   · 全角数字/字母 → 半角
//   · 各种横杠（－ — – − 、~）→ 半角连字符（拼多多单号带横杠）
//   · 去首尾后统一大写（字母不区分大小写）
// 注意：**只用于比对**，不要拿归一化后的值去查平台/ERP（原始单号才是权威）。
function normalizeOrderNo(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  text = text.replace(/['\u2018\u2019\u201c\u201d]/g, "");
  text = text.replace(/[\s\u3000\u00a0]+/g, "");
  text = text.replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "");
  text = text.replace(/[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  text = text.replace(/[\u2010-\u2015\u2212\uff0d~～]/g, "-");
  return text.trim().toUpperCase();
}

// 单元格值是否包含某订单号（两边都归一化）。订单号最少 6 位，避免短串误命中。
function cellMatchesOrder(cellValue, orderId) {
  const needle = normalizeOrderNo(orderId);
  if (needle.length < 6) return false;
  return normalizeOrderNo(cellValue).includes(needle);
}

// 行里任意一格命中订单号
function rowMatchesOrder(rowValues, orderId) {
  return (rowValues || []).some((value) => cellMatchesOrder(value, orderId));
}

module.exports = { normalizeOrderNo, cellMatchesOrder, rowMatchesOrder };
