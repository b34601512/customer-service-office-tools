#!/usr/bin/env node
"use strict";
/**
 * 登录态迁移到共享层（一次性工具，2026-11-13 木婉清）
 *
 * 背景（黎路遥 11-13）：「把这些店铺后台登录都迁移到共享文件夹下面去，以后谁用都可以，不用每次都重新登录，登录一次就好。」
 * 共享层规矩见 `共享/登录态/README.md`：一店（平台×账号×店铺）一份 profile，项目只引用不复制。
 *
 * 这个工具做三件事：
 *   1) 把项目里某一平台的 profile 目录**同盘移动**到 `共享/登录态/店铺/<平台>/<店铺键>/profile`
 *   2) 把项目配置里的路径改成共享路径（先备份配置）
 *   3) 打印迁移前后对照，不删任何东西（旧的空目录留着，方便回滚）
 *
 * 用法：
 *   node 工具/登录态迁移.cjs --项目 22号 --平台 douyin --预览      # 默认就是预览，不动盘
 *   node 工具/登录态迁移.cjs --项目 22号 --平台 douyin --执行
 *   node 工具/登录态迁移.cjs --项目 22号 --平台 all --预览
 *
 * 红线：执行前必须没有该平台的浏览器窗口在跑（脚本会检查进程命令行里有没有那个目录，有就停）。
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const 共享根 = "D:/硅基公司/共享/登录态/店铺";
const 骆冰根 = "D:/硅基公司/员工/06.电商店铺后台专员·骆冰/专项";
const 项目表 = {
  "22号": { 配置: 骆冰根 + "/22.后台售后服务单分析/project-config/stores.json", 根: 骆冰根 + "/22.后台售后服务单分析" },
  "24号": { 配置: 骆冰根 + "/24.平台退款复查/project-config/stores.json", 根: 骆冰根 + "/24.平台退款复查" },
  "25号": { 配置: 骆冰根 + "/25.京东换货登记核查/project-config/stores.json", 根: 骆冰根 + "/25.京东换货登记核查" },
};

const 平台中文 = { douyin: "抖店", tmall: "天猫", pdd: "拼多多", jd: "京东", jdl: "京东物流", youzan: "有赞", erp: "ERP" };

const 参数 = process.argv.slice(2);
const 取值 = (名, 默认) => {
  const i = 参数.indexOf(名);
  return i > -1 && 参数[i + 1] ? 参数[i + 1] : 默认;
};
const 项目名 = 取值("--项目", "22号");
const 平台参数 = 取值("--平台", "");
const 执行 = 参数.includes("--执行");

function 洗(文字) {
  return String(文字 || "").replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 24);
}

function 有浏览器占着(目录) {
  if (!目录 || !fs.existsSync(目录)) return false;
  const 目标 = path.resolve(目录).toLowerCase().replace(/\//g, "\\");
  const script = `
$ErrorActionPreference='SilentlyContinue'
Get-CimInstance Win32_Process | Where-Object { ($_.Name -like 'msedge*' -or $_.Name -like 'chrome*') -and $_.CommandLine -and $_.CommandLine.ToLower().Replace('/','\\').Contains('${目标.replace(/'/g, "''")}') } | Select-Object -ExpandProperty ProcessId
`;
  const 编码 = Buffer.from(script, "utf16le").toString("base64");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", 编码], { encoding: "utf8" });
  return String(r.stdout || "").trim().length > 0;
}

const 项目 = 项目表[项目名];
if (!项目) {
  console.error(`没登记这个项目：${项目名}（现有：${Object.keys(项目表).join("、")}）`);
  process.exit(1);
}
const 配置 = JSON.parse(fs.readFileSync(项目.配置, "utf8"));
const 平台列表 = 平台参数 && 平台参数 !== "all" ? [平台参数] : Object.keys(配置.platforms || {});

let 计划 = [];
for (const 平台键 of 平台列表) {
  const 平台 = 配置.platforms?.[平台键];
  if (!平台) continue;
  for (const 店 of 平台.stores || []) {
    const 现路径 = path.resolve(项目.根, 店.profileDir);
    const 已在共享 = 现路径.toLowerCase().includes("共享\\登录态\\店铺");
    const 店铺键 = `${洗(店.key)}-${洗(店.name || 店.key)}`;
    const 目标路径 = path.join(共享根, 平台中文[平台键] || 平台键, 店铺键, "profile");
    计划.push({ 平台键, 平台名: 平台中文[平台键] || 平台键, 店键: 店.key, 店名: 店.name, 现路径, 目标路径, 已在共享 });
  }
}

if (!计划.length) {
  console.log("没有可迁的店铺（检查 --平台）。");
  process.exit(0);
}

let 动手 = 0;
for (const 项 of 计划) {
  const 有 = fs.existsSync(项.现路径);
  const 占 = 有 && !项.已在共享 ? 有浏览器占着(项.现路径) : false;
  const 能迁 = 有 && !项.已在共享 && !占;
  if (能迁) 动手 += 1;
  console.log(
    `${项.平台名}/${项.店键}（${项.店名 || "-"}）\n` +
      `   现路径：${项.现路径}  存在=${有}\n` +
      `   目标：  ${项.目标路径}\n` +
      `   状态：  ${项.已在共享 ? "已在共享层，跳过" : 占 ? "有浏览器开着，先关再迁" : 能迁 ? "可迁" : "现路径不存在"}`
  );
}

if (!执行) {
  console.log(`\n（预览）可迁 ${动手} 项；加 --执行 才真动盘。`);
  process.exit(0);
}

// 真迁：先备份配置，再逐店移动＋改路径
const 备份 = 项目.配置.replace(/\.json$/, `.json.迁移前-${new Date().toISOString().slice(0, 10)}.bak`);
if (!fs.existsSync(备份)) fs.copyFileSync(项目.配置, 备份);

for (const 项 of 计划) {
  const 平台 = 配置.platforms[项.平台键];
  const 店 = (平台.stores || []).find((s) => s.key === 项.店键);
  // 源已经不在、但共享层有这份（上一轮中途失败/别人迁过）→ 只补配置指向，不搬东西
  if (!项.已在共享 && !fs.existsSync(项.现路径) && fs.existsSync(项.目标路径)) {
    店.profileDir = 项.目标路径;
    console.log(`↻ 源已不在，配置补指共享层：${项.平台名}/${项.店键}`);
    continue;
  }
  if (项.已在共享 || !fs.existsSync(项.现路径)) continue;
  if (有浏览器占着(项.现路径)) {
    console.log(`✗ ${项.平台名}/${项.店键} 有浏览器开着，跳过（先关窗再说）`);
    continue;
  }
  fs.mkdirSync(path.dirname(项.目标路径), { recursive: true });
  if (fs.existsSync(项.目标路径)) {
    // 目标已有一份（同一店在别的项目已迁过）：源这份就是重复副本，搬备份归档，不动共享层那份。
    const 归档 = path.join("D:/备份文件夹/登录态归档-20261113", 项.平台名, path.basename(path.dirname(项.目标路径)) + "-来自-" + 项目名);
    fs.mkdirSync(path.dirname(归档), { recursive: true });
    fs.renameSync(项.现路径, 归档);
    店.profileDir = 项.目标路径;
    console.log(`≈ 共享层已有同名店，源副本归档：${path.relative("D:/硅基公司", 归档)}`);
    continue;
  }
  fs.renameSync(项.现路径, 项.目标路径);
  // 改配置：写绝对路径（共享层不在项目里，相对路径容易算错）
  店.profileDir = 项.目标路径;
  店.note = "登录态在共享层（2026-11-13 黎路遥令）：一店一份，跨项目共用；跑前先取锁 共享/登录态/锁.cjs";
  console.log(`✓ 已迁 ${项.平台名}/${项.店键}`);
}
fs.writeFileSync(项目.配置, JSON.stringify(配置, null, 2) + "\n");
console.log(`\n配置已更新；原配置备份在 ${备份}`);
