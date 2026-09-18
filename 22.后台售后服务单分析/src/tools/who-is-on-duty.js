#!/usr/bin/env node
// 判断"此刻该 @ 谁"：读排班表（金山，匿名只读）→ 取今天售后值班人 → 按用户规则挑选。
//
// 规则（用户 2026-09-18 拍板）：
//   · 14:00 前：优先李守耀（组长）；没有就 @ 早班值班的售后
//   · 14:00 后：@ 晚班值班的售后（售后晚班 14:00-22:30）
//
// 排班表结构（实测 2026-09-18）：第 2 行是「日期 1 2 3 …」；售后区块从「售后」标签那行开始，
//   往下若干行是售后人员（李守耀/缪婷婷/柯紫婷/邓远祥/陈燕玲），只有第一行带区块标签，其余首列为空；
//   单元格就是「早 / 晚 / 年 / 休」——不需要底色。
//
// 用法：node src/tools/who-is-on-duty.js [--at 14:30] [--date 2026-09-18] [--json]
const fs = require("fs");
const path = require("path");
const { readSheet } = require("../engine/kdocs");
const { projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const CONFIG_FILE = projectPath("project-config", "wecom-notify.json");
const SHIFT_STOP_WORDS = ["早班", "晚班", "休息", "上班人数", "年假", "本月休息天数", "本月天数"];

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`缺少通知配置：${path.relative(projectPath(), CONFIG_FILE)}（含 scheduleUrl / webhookUrl / members，不入库）`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--at") { args.at = argv[index + 1]; index += 1; continue; }
    if (argv[index] === "--date") { args.date = argv[index + 1]; index += 1; continue; }
    if (argv[index] === "--json") { args.json = true; }
  }
  return args;
}

function resolveDate(args) {
  if (args.date) return args.date;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function resolveMinutes(args) {
  if (args.at) {
    const [hours, minutes] = args.at.split(":").map(Number);
    return hours * 60 + minutes;
  }
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function sheetNameForMonth(dateText) {
  const [year, month] = dateText.split("-");
  return `${year}年${Number(month)}月`;
}

function parseDutyBlock(matrix, label, dayColumn) {
  const names = [];
  let started = false;
  for (const row of matrix) {
    const cell0 = String(row[0] ?? "").trim();
    const cell1 = String(row[1] ?? "").trim();
    if (cell0 === label) started = true;
    if (!started) continue;
    if (cell0 && cell0 !== label) break;
    if (!cell1 || SHIFT_STOP_WORDS.includes(cell1)) { if (names.length) break; continue; }
    if (cell1.length > 4) break;
    names.push({ name: cell1, shift: String(row[dayColumn] ?? "").trim() });
  }
  return names;
}

function parseDuty(matrix, day) {
  const header = (matrix[1] || []).map((value) => String(value ?? "").trim());
  const dayColumn = header.indexOf(String(day));
  if (dayColumn < 0) throw new Error(`排班表里找不到 ${day} 号这一列（表头：${header.slice(0, 5).join(",")}…）`);
  return { dayColumn, afterSales: parseDutyBlock(matrix, "售后", dayColumn), preSales: parseDutyBlock(matrix, "售前", dayColumn) };
}

function pickTargets(afterSales, minutes, config) {
  const boundary = String(config.earlyEveningBoundary || "14:00");
  const [boundaryHour, boundaryMinute] = boundary.split(":").map(Number);
  const isLateShiftTime = minutes >= boundaryHour * 60 + boundaryMinute;
  const onDuty = afterSales.filter((item) => item.shift === "早" || item.shift === "晚");
  if (isLateShiftTime) {
    return { window: `晚班（${boundary} 之后）`, names: onDuty.filter((item) => item.shift === "晚").map((item) => item.name) };
  }
  const names = [];
  const leader = config.leaderName;
  if (leader && onDuty.some((item) => item.name === leader)) names.push(leader);
  for (const item of onDuty) {
    if (item.shift === "早" && item.name !== leader) names.push(item.name);
  }
  return { window: `早班（${boundary} 之前，组长优先）`, names };
}

async function resolveDutyTargets(args = {}) {
  const config = readConfig();
  const dateText = resolveDate(args);
  const minutes = resolveMinutes(args);
  const sheetName = sheetNameForMonth(dateText);
  const day = Number(dateText.split("-")[2]);
  const { matrix } = await readSheet(config.scheduleUrl, sheetName, { headless: true });
  const duty = parseDuty(matrix, day);
  const target = pickTargets(duty.afterSales, minutes, config);
  const members = config.members || {};
  return {
    date: dateText, sheetName, dayColumn: duty.dayColumn, afterSales: duty.afterSales,
    window: target.window, names: target.names,
    mentions: target.names.map((name) => ({ name, mobile: members[name] || "" }))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await resolveDutyTargets(args);
  log("值班解析", "完成", `${result.date} ${String(args.at || "").slice(0, 5)}`, `应通知：${result.names.join("、") || "(空)"}`);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`\n  ${result.date}（${result.sheetName}，列 ${result.dayColumn}）售后值班：`);
  for (const item of result.afterSales) console.log(`    ${item.name}：${item.shift || "(空)"}`);
  console.log(`\n  时间窗：${result.window}`);
  console.log(`  应通知：${result.names.join("、") || "(没人值班，需人工确认)"}`);
  for (const item of result.mentions) console.log(`    @${item.name} ${item.mobile ? item.mobile : "（缺手机号）"}`);
  console.log("");
}

module.exports = { resolveDutyTargets, parseDuty, pickTargets };

if (require.main === module) {
  main().catch((error) => {
    log("值班解析", "失败", error.message);
    console.error(`\n  失败：${error.message}\n`);
    process.exit(1);
  });
}
