#!/usr/bin/env node
// 读拼多多发票中心某一单（只读）：node scripts/读拼多多发票中心.js --店铺 pdd-store-1 --订单 260901-123456789012345
// 用途：给「生成待登记清单」提供平台应开金额/票种/抬头/税号。
const { 读取拼多多发票中心订单 } = require("../src/拼多多发票中心");

function 读取参数(argv) {
  const 参数 = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    参数[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
    if (参数[argv[i].slice(2)] !== "") i += 1;
  }
  return 参数;
}

async function main() {
  const 参数 = 读取参数(process.argv.slice(2));
  if (!参数["店铺"] || !参数["订单"]) {
    console.error("用法：node scripts/读拼多多发票中心.js --店铺 <5号店铺id> --订单 <订单号>");
    process.exitCode = 2;
    return;
  }
  const 结果 = await 读取拼多多发票中心订单({ 店铺Id: 参数["店铺"], 订单号: 参数["订单"] });
  if (!结果.解析结果) {
    console.error("发票中心里没搜到这一单（页面：" + 结果.页面地址 + "）");
    process.exitCode = 2;
    return;
  }
  const { 原始字段, ...要点 } = 结果.解析结果;
  console.log("=== 平台发票中心 ===");
  console.log(JSON.stringify(要点, null, 2));
  console.log("原始行字段：", 原始字段.join(" | "));
}

main().catch((e) => { console.error("失败：", e && e.message ? e.message : e); process.exit(1); });
