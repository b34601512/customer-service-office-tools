// 极简 CSV 解析（纯函数，可单测）：支持引号包裹、字段内逗号/换行、BOM、CRLF。
// 只解析我们需要的表头→值对象形式；ERP 导出为 GBK，解码在调用方完成。

/** 解析 CSV 文本为「表头对象数组」。 */
function 解析Csv文本(文本) {
  const 源 = String(文本 || "").replace(/^\uFEFF/, "");
  const 行列表 = [];
  let 当前行 = [];
  let 当前字段 = "";
  let 在引号内 = false;
  for (let i = 0; i < 源.length; i += 1) {
    const 字符 = 源[i];
    if (在引号内) {
      if (字符 === '"') {
        if (源[i + 1] === '"') { 当前字段 += '"'; i += 1; }
        else 在引号内 = false;
      } else 当前字段 += 字符;
      continue;
    }
    if (字符 === '"') { 在引号内 = true; continue; }
    if (字符 === ",") { 当前行.push(当前字段); 当前字段 = ""; continue; }
    if (字符 === "\n") { 当前行.push(当前字段); 行列表.push(当前行); 当前行 = []; 当前字段 = ""; continue; }
    if (字符 === "\r") continue;
    当前字段 += 字符;
  }
  if (当前字段 !== "" || 当前行.length > 0) { 当前行.push(当前字段); 行列表.push(当前行); }
  if (行列表.length === 0) return [];
  const 表头 = 行列表[0].map((h) => h.trim());
  const 结果 = [];
  for (let i = 1; i < 行列表.length; i += 1) {
    const 行 = 行列表[i];
    if (行.length === 1 && 行[0] === "") continue; // 跳过空行
    const 对象 = {};
    for (let j = 0; j < 表头.length; j += 1) 对象[表头[j]] = 行[j] !== undefined ? 行[j] : "";
    结果.push(对象);
  }
  return 结果;
}

/** 从 Buffer 解码（ERP 导出为 GBK；utf8 的也能自动兼容）。 */
function 解码Csv缓冲区(缓冲区) {
  const buf = Buffer.isBuffer(缓冲区) ? 缓冲区 : Buffer.from(缓冲区 || "");
  // 先按 GBK 解（Node 内置 ICU 支持）；若结果里出现大量替换符再退回 utf8。
  const gbk文本 = new TextDecoder("gbk", { fatal: false }).decode(buf);
  const 替换符数 = (gbk文本.match(/\uFFFD/g) || []).length;
  if (替换符数 > 0 && 替换符数 > gbk文本.length / 1000) {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
  return gbk文本;
}

module.exports = { 解析Csv文本, 解码Csv缓冲区 };
