#!/usr/bin/env node
// 把 33号《产品问题反馈表》里 2026-10-30 那 19 行的「产品型号」按《咨询商品-19条.md》改掉（按追踪ID 定位，不信行号）。
// 依据：黎路遥 2026-10-30「咨询商品不是有这个吗，你看他咨询的是什么就按什么型号就行」。
// 用法：node 改-水珠型号.cjs        干跑
//       node 改-水珠型号.cjs --写   真写并回读
const { execFileSync } = require("node:child_process");

const CLI = "C:/Users/b3460/AppData/Roaming/npm/node_modules/@wecom/cli/bin/wecom.js";
const DOCID = "e3_AFMAdwb9AAYCNWqYmWTycQumhjFGA";
const SHEET = "BB08J2";
const 真写 = process.argv.includes("--写");
const 字格式 = { font_family: "SimSun", font_size: 12 };

// 追踪ID → 型号（来自 09.探域专员·殷素素/任务/2026-10-30-水珠反馈统计/咨询商品-19条.md）
const 型号表 = {
  "6adab9b687c78d5599f168bb": "C1L（货号 C1-3）",
  "6ad33e4556bb1868356f1c6f": "1SW",
  "6abf5af9797207036d232d14": "DE-1S",
  "6abf5886797207036d231efb": "DE-1S",
  "6ac22006797207036d2e22fb": "DE-1SW",
  "6ac9f24a48cf0f65414f79c2": "DEDAKJ 德迩杰 制氧机（后台未记录咨询商品卡）",
  "6ac9f1f848cf0f65414f77b1": "DEDAKJ 德迩杰 制氧机（后台未记录咨询商品卡）",
  "6acde333fe0b4017aea916ef": "DEDAKJ 德迩杰 制氧机（后台未记录咨询商品卡）",
  "6adaebea1dd2993a4043f124": "DEDAKJ 德迩杰 制氧机（后台未记录咨询商品卡）",
  "6acf33b26fa42c5df03e135a": "DEDAKJ 德迩杰 制氧机（后台未记录咨询商品卡）",
  "6ad2f48f89b9bd23e8ee1dc7": "DEDAKJ 德迩杰 制氧机（后台未记录咨询商品卡）",
  "6ad4275b6645876def92e799": "DEDAKJ 德迩杰 制氧机（后台未记录咨询商品卡）",
  "6ad709f3ad54687de825fff7": "DEDAKJ 德迩杰 制氧机（后台未记录咨询商品卡）",
  "6ac39837c5ae852819d55811": "DEDAKJ 9L大流量·旗舰雾化款",
  "6adb2d7248c7d117fcbabb4b": "DEDAKJ 9L可调+雾化·双倍制高氧款",
  "6ad474690d9bb219753f0aee": "DEDAKJ 1-9升可调+96%高氧·轻音制氧雾化款",
  "6acc6c0c34ebd160a03be8bb": "DEDAKJ 9升大流量·标准款",
  "6ad81e6d4ebeb24513a05072": "DEDAKJ 9升可调·院线款（温润吸氧+5年核心质保）",
  "6adda8092b153460ab57b04d": "DEDAKJ 制氧机（后台未记录咨询商品卡）",
  "6ae1e014ab4739149c8cdc4f": "京东自营店 制氧机（后台未记录咨询商品卡）",
  "6ac4c5455c696c27e6ff3d92": "Q5L（5升医用+雾化+进口分子筛）",
};

function 调(args) {
  const out = execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf("{")));
}

function 读块(起, 终) {
  const 范围 = `A${起}:M${终}`;
  const j = 调(["sheet", "ranges", "get", "--docid", DOCID, "--sheet-id", SHEET, "--mode", "default", "--range", 范围]);
  const rows = (j.grid_data && j.grid_data.rows) || [];
  return rows.map((r, i) => ({
    行号: 起 + i,
    格: (r.values || []).map((c) => String((c.cell_value && c.cell_value.text) || "")),
  }));
}

function 写格(range, value) {
  const body = JSON.stringify({ docid: DOCID, sheet: SHEET, range, cell: { value, style: 字格式 } });
  const j = 调(["sheet", "cells", "set", "--json", body]);
  if (j.errcode) throw new Error(`${range} 写入失败 errcode=${j.errcode}`);
}

function 扫一遍() {
  const 表 = 读块(60, 130);
  const 命中 = [];
  for (const { 行号, 格 } of 表) {
    if (格[0] !== "2026/10/30") continue;
    const id = ((格[3] || "").match(/[0-9a-f]{24}/) || [])[0];
    if (!id) continue;
    const 目标 = 型号表[id];
    命中.push({ 行号, id, 现: 格[2], 目标: 目标 || "(型号表里没有)", 格 });
  }
  return 命中;
}

const 前 = 扫一遍();
const 改动 = 前.filter((x) => x.目标 !== "(型号表里没有)" && x.现 !== x.目标);
console.log(`2026/10/30 命中 ${前.length} 行，要改 ${改动.length} 行`);
for (const c of 改动) console.log(`  C${c.行号}：${c.现.slice(0, 30)} → ${c.目标.slice(0, 30)}`);
const 没对上 = 前.filter((x) => x.目标 === "(型号表里没有)");
if (没对上.length) console.log(`⚠ 型号表里查不到的行：${没对上.map((x) => `${x.行号}/${x.id}`).join("、")}`);

if (真写) {
  for (const c of 改动) {
    写格(`C${c.行号}`, c.目标);
    console.log(`  已写 C${c.行号}`);
  }
  const 后 = 扫一遍();
  const 坏 = 后.filter((x) => x.目标 !== "(型号表里没有)" && x.现 !== x.目标);
  console.log(`回读：${后.length} 行，未对齐 ${坏.length} 行${坏.length ? "：" + 坏.map((x) => x.行号).join("、") : "，全对 ✓"}`);
} else {
  console.log("（干跑，没写。确认后加 --写）");
}
