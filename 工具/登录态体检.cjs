#!/usr/bin/env node
"use strict";
/**
 * 登录态体检：找出「绕开共享层、自己在项目里养登录资料」的地方（2026-11-13 木婉清）
 *
 * 为什么：黎路遥定「后台都是相同的，那就共享，否则要维护多处」。
 * 共享层是唯一真源（`共享/登录态/店铺/<平台>/<店铺>/profile`）；项目里再冒出一份，就是又回到每人一套。
 *
 * 查什么：
 *   1) 仓库里任何叫 browser-profiles / account-profiles / profiles 的目录下，含 Default/Network/Cookies 的子目录 → 算一份独立登录态
 *   2) 这些目录如果不在共享层下，就列出来当「违规/待迁」
 *   3) 顺便报共享层现有店铺与登录态在不在
 *
 * 用法：
 *   node 工具/登录态体检.cjs            # 只读体检，退出码 0=干净、4=有项目私养登录态
 *   node 工具/登录态体检.cjs --详情      # 连共享层的店铺清单一起打
 */
const fs = require("fs");
const path = require("path");

const 硅基根 = "D:/硅基公司";
const 共享根 = path.join(硅基根, "共享", "登录态", "店铺");
const 危险目录名 = new Set(["browser-profiles", "account-profiles", "profiles", "browser_profiles"]);
const 跳过 = new Set(["node_modules", ".git", "备份文件夹", "历史档案", "$RECYCLE.BIN", "System Volume Information"]);

function 是登录态目录(目录) {
  return fs.existsSync(path.join(目录, "Default", "Network", "Cookies"));
}

function 扫(目录, 命中, 层级 = 0) {
  if (层级 > 12) return;
  let 项;
  try {
    项 = fs.readdirSync(目录, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const x of 项) {
    if (!x.isDirectory() || 跳过.has(x.name)) continue;
    const 全 = path.join(目录, x.name);
    if (危险目录名.has(x.name)) {
      // 这一层下面每个子目录可能是一份 profile
      命中.add(全);
      for (const 子 of fs.readdirSync(全, { withFileTypes: true })) {
        if (子.isDirectory()) 命中.add(path.join(全, 子.name));
      }
      continue;
    }
    扫(全, 命中, 层级 + 1);
  }
}

const 命中 = new Set();
扫(硅基根, 命中);

// 2026-11-13 加强：不只认目录名，直接按「有 Default/Network/Cookies」判定——
// 换个名字（profile/环境/资料）照样能查出来，避免只认名字漏掉。
const 深扫 = (目录, 层级 = 0) => {
  if (层级 > 12) return;
  let 项;
  try {
    项 = fs.readdirSync(目录, { withFileTypes: true });
  } catch (e) {
    return;
  }
  if (项.some((x) => x.isFile() && x.name === "Cookies") && 目录.split(String.fromCharCode(92)).join("/").endsWith("Default/Network")) {
    命中.add(path.dirname(path.dirname(目录)));
    return;
  }
  for (const x of 项) {
    if (x.isDirectory() && !跳过.has(x.name)) 深扫(path.join(目录, x.name), 层级 + 1);
  }
};
深扫(硅基根);

// 工具类浏览器（抓网页、研究、购物、软talk 客户端）不是「店铺后台登录态」，不进共享层。
// 归它们自己项目管，但项目 README 要写清「这不是店铺登录态」。2026-11-13 黎路遥口径：店铺后台共享，工具类不掺和。
const 工具类关键词 = ["企微文档爬取", "研究浏览器", "购物浏览器", "SoftTalk财务", "聊天质检"];

const 违规 = [];
const 工具类 = [];
const 指针 = [];
for (const 目录 of 命中) {
  if (目录.toLowerCase().startsWith(共享根.toLowerCase())) continue;
  // junction / 符号链接 = 指向共享层的指针。不是「私养」，但黎路遥 2026-11-13 定「迁移后原来的别再留、不要新旧混用」，
  // 所以指针也要收：单独列成「待改代码清指针」，不算合格。
  try {
    if (fs.lstatSync(目录).isSymbolicLink()) {
      指针.push(目录);
      continue;
    }
  } catch (e) {
    continue;
  }
  if (!是登录态目录(目录)) continue; // 空壳目录不算
  if (工具类关键词.some((k) => 目录.includes(k))) {
    工具类.push(目录);
    continue;
  }
  违规.push(目录);
}

const { 列出店铺 } = require(path.join(共享根, "..", "目录.cjs"));
const 店铺 = 列出店铺();

console.log(`共享层店铺：${店铺.length} 个（登录态在 ${店铺.filter((s) => s.有登录态).length} 个）`);
if (process.argv.includes("--详情")) {
  for (const s of 店铺) console.log(`  ${s.平台}/${s.店铺键}  ${s.有登录态 ? "在" : "无"}`);
}

if (指针.length) {
  console.log(`（另有 ${指针.length} 处 junction/链接指向共享层：不是私养，但按「不许新旧混用」要改成直连后删掉）`);
  for (const v of 指针) console.log("  → " + path.relative(硅基根, v));
}

if (工具类.length) {
  console.log(`（另有 ${工具类.length} 份工具类浏览器，不算店铺登录态、不进共享层）`);
  for (const v of 工具类) console.log("  · " + path.relative(硅基根, v));
}

if (!违规.length) {
  console.log("✓ 没有项目私养登录态，全部在共享层。");
  process.exit(0);
}
console.log(`✗ 发现 ${违规.length} 份项目内登录态（应迁到共享层）：`);
for (const v of 违规) console.log("  " + path.relative(硅基根, v));
process.exit(4);
