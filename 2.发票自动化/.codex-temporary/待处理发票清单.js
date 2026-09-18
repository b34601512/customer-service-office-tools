// 只读汇总：把各平台本地订单记录里的「待处理发票」整理成一张清单（不碰平台、不写业务数据）。
// 用法：node .codex-temporary/待处理发票清单.js
const fs = require("fs");
const path = require("path");

const 项目根 = path.resolve(__dirname, "..");
const 平台文件 = [
  ["天猫", "4.天猫发票回传/data/invoice-order-records.json"],
  ["拼多多", "5.拼多多发票回传/data/invoice-order-records.json"],
  ["抖音", "6.抖音发票回传/data/invoice-order-records.json"],
  ["京东", "2.京东发票回传/data/invoice-order-records.json"]
];

function 取列表(d) {
  const orders = d && d.orders;
  if (Array.isArray(orders)) return orders;
  if (orders && typeof orders === "object") return Object.values(orders);
  return [];
}

function 天数(文本) {
  if (!文本) return null;
  const t = Date.parse(String(文本).replace(/\//g, "-"));
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function 取(o, ...候选) {
  for (const k of 候选) {
    if (o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== "") return o[k];
  }
  return "";
}

const 结果 = [];
for (const [平台, 相对路径] of 平台文件) {
  const 全路径 = path.join(项目根, 相对路径);
  if (!fs.existsSync(全路径)) continue;
  const d = JSON.parse(fs.readFileSync(全路径, "utf8"));
  const 文件时间 = fs.statSync(全路径).mtime.toLocaleString("zh-CN", { hour12: false });
  for (const o of 取列表(d)) {
    const 状态 = 取(o, "status", "workflowStatus", "operationStatus");
    if (!/pending|待/.test(String(状态))) continue;
    结果.push({
      平台,
      店铺: 取(o, "storeName", "storeId") || "(未知店铺)",
      订单号: 取(o, "orderNumber", "orderNo") || "(无)",
      状态: String(状态),
      审批: 取(o, "approvalStatus"),
      金额: 取(o, "invoiceAmount"),
      申请时间: 取(o, "invoiceApplyTime", "applyTime"),
      承诺时间: 取(o, "promisedInvoiceTime"),
      已等天数: 天数(取(o, "invoiceApplyTime", "applyTime")),
      本地文件更新: 文件时间
    });
  }
}

结果.sort((a, b) => (b.已等天数 || 0) - (a.已等天数 || 0));
const 行 = [];
行.push(`待处理发票清单（生成时间 ${new Date().toLocaleString("zh-CN", { hour12: false })}）`);
行.push(`合计 ${结果.length} 单`);
行.push("");
行.push("平台 | 店铺 | 订单号 | 状态 | 审批 | 金额 | 申请时间 | 已等天数 | 承诺时间");
行.push("--- | --- | --- | --- | --- | --- | --- | --- | ---");
for (const r of 结果) {
  行.push(
    `${r.平台} | ${r.店铺} | ${r.订单号} | ${r.状态} | ${r.审批 || "-"} | ${r.金额 || "-"} | ${r.申请时间 || "-"} | ${
      r.已等天数 === null ? "-" : r.已等天数
    } | ${r.承诺时间 || "-"}`
  );
}
const 文本 = 行.join("\n");
const 输出路径 = path.join(项目根, "runtime", `待处理发票清单-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`);
fs.mkdirSync(path.dirname(输出路径), { recursive: true });
fs.writeFileSync(输出路径, 文本 + "\n");
console.log(文本);
console.log("\n清单已写入：" + 输出路径);
