// 7号：登记写入编排（**唯一会真写金山表的入口**，默认不写）。
// 安全闸门（顺序不能改）：
//   1) 条目必须齐全：`生成写表数据` 报出任何「待人工」项 → 直接拒写（不自编字段）。
//   2) 授权闸门：没有 已确认=true → 只返回待写内容，一个字节都不写（业务红线：写入逐次授权）。
//   3) 云端查重：写前必须用 AirScript 全表查订单号，命中 → 拒写（重复登记=重复交税）。
//   4) 写入：orderNo + writeCells + allowWrite:true。
//   5) 写完回读：订单号必须恰好 1 行且行号=写入行；出现 2 行 → 立刻报错（可能重复登记，必须人工处理）。
//
// 依赖全部注入（跑脚本 / 生成写表数据），所以这套闸门可以离线跑单测，不需要真表。

const 默认表名 = "德达医疗器械发票登记 --毛叶红";

function 取订单号(条目) {
  return String((条目 && (条目.订单号 || 条目.orderNo)) || "").trim();
}

async function 写登记行(条目, 依赖, 选项 = {}) {
  const { 跑脚本, 生成写表数据 } = 依赖;
  if (typeof 跑脚本 !== "function") throw new Error("写登记行缺少依赖：跑脚本");
  if (typeof 生成写表数据 !== "function") throw new Error("写登记行缺少依赖：生成写表数据");

  const 订单号 = 取订单号(条目);
  if (!订单号) throw new Error("写登记行失败：条目里没有订单号。");

  const 表名 = 选项.表名 || 默认表名;
  const 数据 = 生成写表数据(条目, 选项);
  const 待人工 = Array.isArray(数据.待人工) ? 数据.待人工 : [];
  if (待人工.length) {
    return { 状态: "拒写", 原因: `条目字段不全：${待人工.join("；")}`, 订单号, 表名 };
  }
  // 拆两类：文本/数字→writeCells；日期序列号→dateCells（云端会先设日期格式再写，避免显示成 46271 这种裸数字）
  const 列 = {};
  const 日期列 = {};
  for (const [字母, 项] of Object.entries(数据.列 || {})) {
    if (!项 || 项.值 === undefined) continue;
    if (项.类型 === "日期序列号") 日期列[字母] = 项.值;
    else 列[字母] = 项.值;
  }

  // 闸门 2：逐次授权。没点头就停在这里，把要写的内容原样交回去给人看。
  if (选项.已确认 !== true) {
    return { 状态: "等授权", 订单号, 表名, 列, 日期列, 说明: "未写入（需要用户逐次确认后再跑，带 --已确认）" };
  }

  // 闸门 3：云端全表查重（走**独立写入脚本**的 checkOnly；只读查询脚本那份不动）。
  const 查重 = await 跑脚本({ orderNo: 订单号, checkOnly: true, sheets: [表名] });
  if (查重 && 查重.duplicate === true) {
    return { 状态: "已登记", 订单号, 表名, 命中行: Number(查重.row) || 0, 说明: "该订单号在云端登记表里已存在，拒绝重复写入" };
  }

  // 闸门 4：写入。（纯写入一个动作；修错行由人工在金山里改，2026-09-30 用户定）
  const 写入请求 = { orderNo: 订单号, writeCells: 列, allowWrite: true, sheets: [表名] };
  if (Object.keys(日期列).length) 写入请求.dateCells = 日期列;
  const 写入 = await 跑脚本(写入请求);
  if (!写入 || 写入.written !== true) {
    return { 状态: "写入失败", 订单号, 表名, 返回: 写入 };
  }
  if (Array.isArray(写入.failedColumns) && 写入.failedColumns.length) {
    throw new Error(`写登记行部分列失败：${写入.failedColumns.join("、")}（已写入列：${(写入.writtenColumns || []).join("、")}），必须人工核对第 ${写入.row} 行。`);
  }

  // 闸门 5：回读必须恰好一行，且就是刚写的那一行。
  const 回读 = await 跑脚本({ orderNo: 订单号, checkOnly: true, sheets: [表名] });
  const 回读行 = Number(回读 && 回读.row) || 0;
  const 回读命中 = 回读 && 回读.duplicate === true;
  if (!回读命中 || 回读行 !== 写入.row) {
    throw new Error(`写后回读异常：订单号 ${订单号} 云端${回读命中 ? "查到 1 行" : "查不到"}，行号 ${回读行}（期望 ${写入.row}）→ 可能重复登记，请人工核对金山表第 ${写入.row} 行。`);
  }

  return {
    状态: "已写入",
    订单号,
    表名,
    行号: 写入.row,
    写入列: 写入.writtenColumns || [],
    日期列: 写入.dateColumns || [],
    回读: 写入.readBack || [],
  };
}

/** 从本机待登记清单里取一单（一条动作 = 一个订单号）。 */
function 读清单条目(清单路径, 订单号) {
  const fs = require("fs");
  if (!fs.existsSync(清单路径)) throw new Error(`没有待登记清单：${清单路径}（先跑 scripts/生成待登记清单.js）`);
  const 条目 = fs.readFileSync(清单路径, "utf8").trim().split("\n").filter(Boolean)
    .map((行) => { try { return JSON.parse(行); } catch (_错误) { return null; } })
    .filter(Boolean)
    .filter((项) => String(项.订单号 || "").trim() === String(订单号 || "").trim());
  if (!条目.length) throw new Error(`待登记清单里没有订单号 ${订单号}`);
  return 条目[条目.length - 1];
}

module.exports = { 写登记行, 取订单号, 默认表名, 探针, 读清单条目 };

/** 云端探针：只回版本/行数，绝不写。用来确认用户在文档里保存的写入脚本已生效。 */
async function 探针(依赖, 表名 = 默认表名) {
  const 结果 = await 依赖.跑脚本({ probe: true, sheets: [表名] });
  return 结果 || {};
}
