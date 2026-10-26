// 由汇总结果.json 生成要写进表的二维数据（不写表，只出 JSON；写入由 wecom-cli 执行）
//
// 写谁：客服岗且有真实接待（含客户消息）的人。排除并在回执里报：
//   · API / 运营 = 平台账号，不是人、不是客服岗（任务单第 4 条）
//   · 其他非客服岗（京东运营/副经理/售后文员）以及 0 接待的会话（没有客户消息 = 没接人）
const fs = require("node:fs");
const path = require("node:path");

const 结果 = JSON.parse(fs.readFileSync(path.join(__dirname, "汇总结果.json"), "utf8"));

const 是客服岗 = (名) => /客服|组长/.test(名); // 售前客服/售后客服/售后组长
const 有接待 = (p) => Number(p.服务客户数) > 0 && Number(p.对话轮次) > 0;

const 写 = [];
const 排除 = [];
for (const p of 结果.按客服) {
  if (!String(p.客服名 || "").trim()) { 排除.push({ ...p, 原因: "客服名为空" }); continue; }
  if (p.客服名 === "API" || p.客服名 === "运营" || /运营/.test(p.客服名)) {
    排除.push({ ...p, 原因: "平台账号/运营岗，不是客服" });
    continue;
  }
  if (!是客服岗(p.客服名)) { 排除.push({ ...p, 原因: "非客服岗" }); continue; }
  if (!有接待(p)) { 排除.push({ ...p, 原因: "0 接待（没有客户消息）" }); continue; }
  写.push(p);
}

const 行 = 写.map((p) => [
  p.客服名, // A
  "10月", // B
  p.服务客户数, // C
  p.对话轮次, // D
  p.发送消息数, // E
  p.每个客户平均对话轮次, // F
  p.每个客户平均发消息数, // G
  p.平均首次响应秒, // H
  p["15s应答率"], // I
  p.平均响应秒, // J
  p.最长回复秒, // K
  p["响应超时次数_15秒"], // L
  p["15秒超时占比"], // M
  p.数据覆盖天数 // N
]);

const 产物 = {
  生成时间: new Date().toISOString(),
  起始行: 3,
  结束行: 3 + 行.length - 1,
  表头单元格: { range: "N1", cells: [["数据覆盖天数"]] },
  数据区: { range: `A3:N${3 + 行.length - 1}`, cells: 行 },
  行数: 行.length,
  写的人: 写.map((p) => p.客服名),
  排除的人: 排除.map((p) => ({
    客服名: p.客服名,
    原因: p.原因,
    会话数: p.会话数,
    服务客户数: p.服务客户数,
    对话轮次: p.对话轮次,
    发送消息数: p.发送消息数
  }))
};
fs.writeFileSync(path.join(__dirname, "写入数据.json"), JSON.stringify(产物, null, 2), "utf8");
console.log(`应写 ${产物.行数} 行（A3:N${产物.结束行}）+ 表头 N1`);
行.forEach((r, i) => console.log(`  ${3 + i}`, JSON.stringify(r)));
console.log(`\n不写 ${产物.排除的人.length} 项：`);
for (const x of 产物.排除的人) console.log("  ", x.客服名 || "(空)", "→", x.原因, "｜会话", x.会话数, "｜客户", x.服务客户数, "｜轮次", x.对话轮次, "｜消息", x.发送消息数);
