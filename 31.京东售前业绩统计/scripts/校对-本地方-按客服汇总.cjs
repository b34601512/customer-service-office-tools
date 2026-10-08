#!/usr/bin/env node
// 31号：把已下载的 6 店「促成订单」按 口径（与导入完全一致）汇总成 每店×每客服 的行数+金额。
// 用于财务校对：本地金额 ⇄ 客服管家系统统计金额。
//
// 用法：node scripts/校对-本地方-按客服汇总.cjs [--manifest runtime/downloads/2026-09/manifest.json] [--out runtime/校对-2026-10-08/本地方-按客服汇总.json]
// 口径（与 导入管家数据.cjs 完全一致）：去「已取消」；昵称去「(推算)」后缀；昵称→实名用映射；整行去重；0 元行保留。
// 金额两版：① 单价×数量；② 单价直和（数量=1 时两者相同）。
const fs = require("node:fs");
const path = require("node:path");
const { 加载全部 } = require("./导入管家数据.cjs");
const { 项目根 } = require("./金山只读.cjs");

function 解析参数(argv) {
  const 参数 = { manifest: "", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--manifest") { 参数.manifest = argv[i + 1] || ""; i += 1; }
    else if (argv[i] === "--out") { 参数.out = argv[i + 1] || ""; i += 1; }
  }
  return 参数;
}

function 金额(v) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function 汇总(清单) {
  const { 结果 } = 加载全部({ 映射缓存: "", 刷新映射: false }, 清单);
  const 店列表 = [];
  for (const 文件 of 结果) {
    const 客服表 = new Map(); // 实名 → { 行数, 金额乘, 金额和 }
    let 店乘 = 0; let 店和 = 0;
    for (const 行 of 文件.rows) {
      const 实名 = 行[12] || "(未匹配)";
      const 单价 = 金额(行[9]); const 数量 = 金额(行[10]);
      const 记录 = 客服表.get(实名) || { 客服: 实名, 行数: 0, 金额_单价乘数量: 0, 金额_单价直和: 0 };
      记录.行数 += 1;
      记录.金额_单价乘数量 += 单价 * 数量;
      记录.金额_单价直和 += 单价;
      客服表.set(实名, 记录);
      店乘 += 单价 * 数量; 店和 += 单价;
    }
    const 客服 = [...客服表.values()].sort((a, b) => b.金额_单价乘数量 - a.金额_单价乘数量);
    for (const 记录 of 客服) {
      记录.金额_单价乘数量 = Number(记录.金额_单价乘数量.toFixed(2));
      记录.金额_单价直和 = Number(记录.金额_单价直和.toFixed(2));
    }
    店列表.push({
      store: 文件.store,
      文件: path.basename(文件.文件),
      源总行: 文件.统计.源总行,
      已取消: 文件.统计.已取消,
      整行重复: 文件.统计.整行重复,
      入库行数: 文件.rows.length,
      金额_单价乘数量: Number(店乘.toFixed(2)),
      金额_单价直和: Number(店和.toFixed(2)),
      客服
    });
  }
  const 总计 = {
    行数: 店列表.reduce((s, r) => s + r.入库行数, 0),
    金额_单价乘数量: Number(店列表.reduce((s, r) => s + r.金额_单价乘数量, 0).toFixed(2)),
    金额_单价直和: Number(店列表.reduce((s, r) => s + r.金额_单价直和, 0).toFixed(2))
  };
  return {
    生成时间: new Date().toISOString(),
    年月: 清单.yearMonth,
    口径: "去已取消；昵称去(推算)后缀→实名映射；整行去重；0元行保留（与 导入管家数据.cjs 完全一致）",
    金额口径说明: "金额_单价乘数量 = Σ(商品单价×购买数量)；金额_单价直和 = Σ商品单价（不看数量）",
    stores: 店列表,
    总计
  };
}

if (require.main === module) {
  const 参数 = 解析参数(process.argv.slice(2));
  const 清单路径 = path.resolve(参数.manifest || path.join(项目根, "runtime", "downloads", "2026-09", "manifest.json"));
  const 原清单 = JSON.parse(fs.readFileSync(清单路径, "utf8"));
  const 清单 = { ...原清单, yearMonth: 原清单.yearMonth || 原清单.年月 };
  if (!清单.yearMonth) throw new Error(`清单里没有 年月/yearMonth：${清单路径}`);
  console.log(`  清单：${清单路径}（${(清单.files || []).length} 店）`);
  const 汇总结果 = 汇总(清单);
  const 输出 = path.resolve(参数.out || path.join(项目根, "runtime", "校对-2026-10-08", "本地方-按客服汇总.json"));
  fs.mkdirSync(path.dirname(输出), { recursive: true });
  fs.writeFileSync(输出, JSON.stringify(汇总结果, null, 1), "utf8");
  for (const 店 of 汇总结果.stores) {
    console.log(`  ${店.store}：源 ${店.源总行} → 去取消 ${店.已取消}、重复 ${店.整行重复} → 入库 ${店.入库行数} 行；` +
      `金额(乘) ¥${店.金额_单价乘数量}，金额(和) ¥${店.金额_单价直和}`);
  }
  console.log(`  总计：${汇总结果.总计.行数} 行；金额(乘) ¥${汇总结果.总计.金额_单价乘数量}；金额(和) ¥${汇总结果.总计.金额_单价直和}`);
  console.log(`  已落盘：${输出}`);
}

module.exports = { 汇总, 解析参数 };
