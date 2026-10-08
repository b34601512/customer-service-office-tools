#!/usr/bin/env node
// 7号：把本机待登记清单里的条目 → 登记表「写表数据」（列字母=值），写表前给你过目用。
// **本脚本只算不写**：不会碰金山表格（真正的写入要单开一步、且逐次经用户同意）。
//
// 用法：
//   node scripts/生成写表数据.js                     # 取清单里最新一条
//   node scripts/生成写表数据.js --订单号 <订单号>     # 指定订单号
//   node scripts/生成写表数据.js --out project-config/写表数据.json
const fs = require("fs");
const path = require("path");
const { 生成写表数据 } = require("../src/发票规则");

const 项目根 = path.resolve(__dirname, "..");
const 清单路径 = path.join(项目根, "project-config", "待登记清单.jsonl");

function 读清单() {
  if (!fs.existsSync(清单路径)) return [];
  return fs.readFileSync(清单路径, "utf8").trim().split("\n").filter(Boolean).map((行) => JSON.parse(行));
}

function 解析参数(argv) {
  const 结果 = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--订单号") { 结果.订单号 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--out") { 结果.out = argv[i + 1]; i += 1; continue; }
  }
  return 结果;
}

function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const 清单 = 读清单();
  if (!清单.length) {
    console.error(`待登记清单是空的：${path.relative(项目根, 清单路径)}（先跑 scripts/生成待登记清单.js）`);
    process.exit(1);
  }
  const 条目 = 参数.订单号
    ? 清单.find((x) => String(x.订单号 || "").trim() === String(参数.订单号).trim())
    : 清单[清单.length - 1];
  if (!条目) {
    console.error(`清单里没有订单号 ${参数.订单号}`);
    process.exit(1);
  }

  const 数据 = 生成写表数据(条目);
  const { 列, 待人工 } = 数据;
  const 列序 = Object.keys(列).sort();
  console.log(`\n  订单 ${条目.订单号}（${条目.店铺}）→ 写表数据 ${列序.length} 列：`);
  for (const 名 of 列序) {
    const 项 = 列[名];
    console.log(`    ${名} = ${项.值}${项.说明 ? `  （${项.类型}：${项.说明}）` : `  （${项.类型}）`}`);
  }
  if ((数据.总行数 || 1) > 1) {
    console.log(`\n  本单共 ${数据.总行数} 行（主件按 ERP 顺序在前、赠品在后）——逐行写用 --行序号 1..${数据.总行数}：`);
    for (const 行 of 数据.行列表) {
      console.log(`    行${行.行序号}${行.是否主行 ? "（主件）" : "（赠品）"}：U=${行.列.U ? 行.列.U.值 : "-"} V=${行.列.V ? 行.列.V.值 : "-"} Y=${行.列.Y ? 行.列.Y.值 : "-"}${行.待人工.length ? "　待人工：" + 行.待人工.join("；") : ""}`);
    }
    console.log(`  金额对账：基准 ${数据.对账基准 ?? "-"}，差额 ${数据.金额差额 === null ? "（无法对账）" : 数据.金额差额}${(数据.对账提示 || []).length ? "；" + 数据.对账提示.join("；") : ""}`);
  }
  console.log(`\n  待人工：${待人工.length ? 待人工.join("；") : "（无）"}`);
  console.log(`  公式列检查：${["C", "D", "E", "T", "W", "X", "AO"].some((c) => 列[c]) ? "❌ 混进了公式列" : "✅ 没有公式列"}`);
  console.log(`  写表前置：先查重（npm run 查表 -- ${条目.订单号}），命中就停，不许写。\n`);

  if (参数.out) {
    const 输出路径 = path.isAbsolute(参数.out) ? 参数.out : path.join(项目根, 参数.out);
    fs.mkdirSync(path.dirname(输出路径), { recursive: true });
    fs.writeFileSync(输出路径, JSON.stringify({ 订单号: 条目.订单号, 店铺: 条目.店铺, 列, 待人工, 总行数: 数据.总行数, 行列表: 数据.行列表, 对账基准: 数据.对账基准, 金额差额: 数据.金额差额, 对账提示: 数据.对账提示 }, null, 2), "utf8");
    console.log(`  已保存：${path.relative(项目根, 输出路径)}\n`);
  }
}

main();
