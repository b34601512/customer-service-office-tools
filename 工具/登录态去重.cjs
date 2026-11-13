#!/usr/bin/env node
"use strict";
/**
 * 共享层去重（一次性，2026-11-13 木婉清）
 *
 * 问题：迁移时不同项目给同一个店的命名不一样（`jd3-DEDAKJ器械店` vs `jd3-德迩杰官方旗舰店`），
 * 一个字不同就成了两份目录——又回到「多处维护」。
 *
 * 做法：共享层目录统一改成「店铺键」这一个名字（`京东/jd3`、`天猫/tmall1`、`抖店/店3-162329841`），
 * 同一键有多份时，留 cookie 最新的那份，其余搬 `D:/备份文件夹/登录态归档-20261113/重复-*`。
 *
 * 用法：
 *   node 工具/登录态去重.cjs --预览
 *   node 工具/登录态去重.cjs --执行
 */
const fs = require("fs");
const path = require("path");

const 共享根 = "D:/硅基公司/共享/登录态/店铺";
const 归档根 = "D:/备份文件夹/登录态归档-20261113";
const 执行 = process.argv.includes("--执行");

function cookie时间(目录) {
  const p = path.join(目录, "profile", "Default", "Network", "Cookies");
  try {
    return fs.statSync(p).mtimeMs;
  } catch (e) {
    return 0;
  }
}

function 店铺键(名字) {
  // `抖店/店3-162329841` 这种本来就带平台店铺ID，保留；其余取第一个 '-' 前
  if (名字.startsWith("店")) return 名字;
  return 名字.split("-")[0];
}

let 改动 = 0;
for (const 平台 of fs.existsSync(共享根) ? fs.readdirSync(共享根) : []) {
  const 平台目录 = path.join(共享根, 平台);
  if (!fs.statSync(平台目录).isDirectory()) continue;
  const 组 = new Map();
  for (const 名 of fs.readdirSync(平台目录)) {
    const 全 = path.join(平台目录, 名);
    if (!fs.statSync(全).isDirectory()) continue;
    const 键 = 店铺键(名);
    if (!组.has(键)) 组.set(键, []);
    组.get(键).push({ 名, 全, 时间: cookie时间(全) });
  }
  for (const [键, 项] of 组) {
    const 标准 = path.join(平台目录, 键);
    const 活的 = 项.filter((x) => x.时间 > 0).sort((a, b) => b.时间 - a.时间);
    const 留 = 活的[0] || 项[0];
    const 多余 = 项.filter((x) => x.全 !== 留.全);
    if (项.length === 1 && 留.名 === 键) continue;
    改动 += 1;
    console.log(`${平台}/${键}：共 ${项.length} 份，留「${留.名}」（cookie 时间=${new Date(留.时间).toLocaleString("sv-SE")}），多余 ${多余.length} 份`);
    if (!执行) continue;
    // 先把多余的搬走
    for (const m of 多余) {
      const 归档 = path.join(归档根, "重复", 平台, m.名);
      fs.mkdirSync(path.dirname(归档), { recursive: true });
      fs.renameSync(m.全, 归档);
      console.log(`   ≈ 归档 ${m.名}`);
    }
    // 再把留下的改名成标准键
    if (留.名 !== 键) {
      if (fs.existsSync(标准)) {
        console.log(`   ! ${标准} 已存在，跳过改名`);
      } else {
        fs.renameSync(留.全, 标准);
        console.log(`   ✓ 改名 ${留.名} → ${键}`);
      }
    }
  }
}

console.log(执行 ? `\n已处理 ${改动} 组。` : `\n（预览）需要处理 ${改动} 组；加 --执行 才动盘。`);
