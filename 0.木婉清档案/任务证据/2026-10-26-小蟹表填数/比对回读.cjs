// 写后逐格比对：写前快照 vs 写后回读，只允许 A1:N12 里「该写的格」发生变化，其余必须一模一样
const fs = require("node:fs");
const path = require("node:path");

const 前 = JSON.parse(fs.readFileSync(path.join(__dirname, "写前快照.json"), "utf8")).grid_data;
const 后 = JSON.parse(fs.readFileSync(path.join(__dirname, "写后回读.json"), "utf8")).grid_data;
const w = JSON.parse(fs.readFileSync(path.join(__dirname, "写入数据.json"), "utf8"));

const 值 = (c) => {
  const v = c && c.cell_value;
  if (!v) return null;
  if (v.number !== undefined && v.number !== null) return v.number;
  if (v.text !== undefined && v.text !== null && v.text !== "") return v.text;
  return null;
};
const 列名 = (i) => {
  let n = i, s = "";
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
};

const 应 = new Map();
应.set("N1", "数据覆盖天数");
w.数据区.cells.forEach((行, ri) => 行.forEach((v, ci) => 应.set(列名(ci) + (3 + ri), v)));

let 差 = 0, 查 = 0, 外 = 0;
const 头 = 前.start_row || 0, 头列 = 前.start_column || 0;
for (let r = 0; r < Math.max(前.rows.length, 后.rows.length); r++) {
  const 前行 = (前.rows[r] || {}).values || [];
  const 后行 = (后.rows[r] || {}).values || [];
  for (let c = 0; c < 32; c++) {
    const key = 列名(头列 + c) + (头 + r + 1);
    const a = 值(前行[c]), b = 值(后行[c]);
    if (应.has(key)) {
      查++;
      const e = 应.get(key);
      const 同 = typeof e === "number" ? Number(b) === e : String(b) === String(e);
      if (!同) { 差++; console.log("差异", key, "应", JSON.stringify(e), "实", JSON.stringify(b)); }
    } else if (String(a ?? "") !== String(b ?? "")) {
      外++;
      console.log("范围外变动", key, JSON.stringify(a), "→", JSON.stringify(b));
    }
  }
}
console.log(`应写格 ${查}｜差异 ${差}｜范围外变动 ${外}｜写前/后行数 ${前.rows.length}/${后.rows.length}`);
process.exitCode = 差 === 0 && 外 === 0 ? 0 : 1;
