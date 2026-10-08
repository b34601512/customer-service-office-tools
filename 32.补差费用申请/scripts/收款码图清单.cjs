#!/usr/bin/env node
// 32号 补差费用申请：从「待写数据」（准备月度数据.cjs 产出）里**自动**挑出带收款码图的行，
// 产出「带图清单」（源行号/姓名/DISPIMG ID/目标行），供 导出收款码图.cjs / 同步收款码图.cjs 用。
//
// 为什么要有它（2026-10-08 用户口径）：9 月批的清单是手工攒的；黎路遥要「后续每个月整理数据时
//   正常能同步截图过来」。源表 G 列（支付宝/微信账号）里是 `=DISPIMG("ID_…",1)` 的行才有图，
//   而这些公式随 写汇总 一起进了批次的 `明细[].汇总行[2]`，所以**不用再登源表**就能生成清单。
// 规则：
//   ① 只挑 明细[].汇总行[2] 是 `=DISPIMG("ID_…",1)` 的行；普通账号（手机号/银行卡/邮箱）不进清单；
//   ② 目标行 = 目标首行 + 明细序号（目标首行 = 批次 预期末行.汇总 + 1，见 批次映射.cjs，不硬编码偏移）；
//   ③ 批次缺 `预期末行.汇总` / `行数` / `源行号` → 抛错（读批次 已拦），不猜。
// 失败一律抛错，不兜底、不自动重试。
const fs = require("node:fs");
const path = require("node:path");
const { 读批次 } = require("./批次映射.cjs");

// `=DISPIMG("ID_…",1)` → ID；不是这个形态（普通账号文本、空、#REF!）→ null
function 解析DISPIMG(文本) {
  const m = /^\s*=\s*DISPIMG\s*\(\s*"([^"]+)"\s*,\s*\d+\s*\)\s*$/i.exec(String(文本 == null ? "" : 文本));
  return m ? m[1].trim() : null;
}

// 批次 JSON → 带图清单（不落盘）
//   返回 { 月份, 批次文件, 目标首行, 目标末行, 行数, 有图行数, 项:[{行,源行,姓名,id,目标行}] }
function 从批次生成清单(批次, 选项 = {}) {
  if (!批次 || typeof 批次 !== "object") throw new Error("没有批次数据（先给 --批次 <待写数据.json>）");
  const 批 = 读批次(批次, 选项.文件 || "");
  const 明细 = 批次.明细;
  const 项 = [];
  for (let i = 0; i < 明细.length; i += 1) {
    const 汇总行 = Array.isArray(明细[i].汇总行) ? 明细[i].汇总行 : [];
    const id = 解析DISPIMG(汇总行[2]);
    if (!id) continue; // 没图的行不进清单
    项.push({
      行: Number(明细[i].源行号),
      源行: Number(明细[i].源行号),
      姓名: String(汇总行[1] == null ? "" : 汇总行[1]).trim(),
      id,
      目标行: 批.目标首行 + i
    });
  }
  return {
    月份: String(批次.月份 || ""),
    批次文件: 批.文件,
    目标首行: 批.目标首行,
    目标末行: 批.目标末行,
    行数: 批.行数,
    有图行数: 项.length,
    项
  };
}

// 判定某目标格「已插过图」（回读到的当前值 ≠ 批次里的源图 ID，且自身是 DISPIMG）
function 判定已插(当前值, 源id) {
  const id = 解析DISPIMG(当前值);
  return Boolean(id) && id !== String(源id || "");
}

// 回读矩阵（24号 read-kdocs 的 matrix，0 基）→ { 已插, 待插, 缺行 }
//   每个输出项 = 清单项 + { 当前值 }
function 按回读分拣(矩阵, 清单) {
  if (!Array.isArray(矩阵)) throw new Error("回读结果不是矩阵（先跑 24号 read-kdocs.js --sheet 汇总）");
  const 已插 = [];
  const 待插 = [];
  for (const 一 of 清单 || []) {
    const 行 = 矩阵[Number(一.目标行) - 1];
    if (!Array.isArray(行)) {
      throw new Error(`回读矩阵里没有目标行 ${一.目标行}（只有 ${矩阵.length} 行）——新鲜度/行域不对，停手`);
    }
    const 当前值 = String(行[2] == null ? "" : 行[2]).trim();
    const 装 = { ...一, 当前值 };
    if (判定已插(当前值, 一.id)) 已插.push(装);
    else 待插.push(装);
  }
  return { 已插, 待插 };
}

// 清单的默认落盘路径：runtime/收款码图/<月份>/清单.json
function 清单路径(项目根, 月份) {
  return path.join(项目根, "runtime", "收款码图", String(月份 || "未命名"), "清单.json");
}

// 落盘（裸数组；导出收款码图.cjs / 同步收款码图.cjs 都按数组读）
function 写清单(文件路径, 清单) {
  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  fs.writeFileSync(文件路径, JSON.stringify((清单 && 清单.项) || [], null, 1), "utf8");
  return 文件路径;
}

module.exports = { 解析DISPIMG, 从批次生成清单, 判定已插, 按回读分拣, 清单路径, 写清单 };
