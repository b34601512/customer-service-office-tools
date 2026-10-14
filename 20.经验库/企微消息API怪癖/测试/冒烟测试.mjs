#!/usr/bin/env node
"use strict";
/**
 * 冒烟测试.mjs —— 取企微图片.cjs 离线复跑（不需要真实企微环境）
 *   node 测试\冒烟测试.mjs
 *
 * 造「密文＋aeskey」当输入，验证：解密正确、两种 key 写法都认、错误场景退出码、输出不泄露 key。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const BASE = path.resolve(import.meta.dirname, "..");
const 工具 = path.join(BASE, "工具", "取企微图片.cjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "取企微图片测试-"));

// 造一张假「JPEG」：ffd8 开头 + 随机内容
const 原图 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(996)]);
const key = crypto.randomBytes(32);
const iv = key.slice(0, 16);
const 加密器 = crypto.createCipheriv("aes-256-cbc", key, iv);
const 密文 = Buffer.concat([加密器.update(原图), 加密器.final()]);
const 密文路径 = path.join(TMP, "密文.bin");
fs.writeFileSync(密文路径, 密文);
const key带等号 = key.toString("base64"); // 44 字符，带一个 =
const key无等号 = key带等号.replace(/=+$/, ""); // 43 字符

function run(...args) {
  return spawnSync(process.execPath, [工具, ...args], { encoding: "utf8", windowsHide: true, timeout: 60000 });
}
const 等 = (毫秒) => new Promise((r) => setTimeout(r, 毫秒));

let 过 = 0, 败 = 0;
function 断言(名, 条件, 详情 = "") {
  if (条件) { 过++; console.log(`  ✅ ${名}`); }
  else { 败++; console.log(`  ❌ ${名} ${详情}`); }
}

console.log(`临时目录：${TMP}\n`);

console.log("1) 正常解密（key 带 = 的 44 字符写法）");
{
  const out = path.join(TMP, "out1.jpg");
  const r = run("--url", 密文路径, "--aeskey", key带等号, "--out", out);
  断言("exit=0 且报已保存", r.status === 0 && /已保存/.test(r.stdout), r.stderr);
  const 得 = fs.existsSync(out) ? fs.readFileSync(out) : Buffer.alloc(0);
  断言("解出内容与原文一致（sha 相同）", 得.equals(原图));
  断言("识别为 JPEG", /JPEG/.test(r.stdout));
}

console.log("2) key 去掉 = 的 43 字符写法也认");
{
  const out = path.join(TMP, "out2.jpg");
  const r = run("--url", 密文路径, "--aeskey", key无等号, "--out", out);
  断言("exit=0 且 sha 一致", r.status === 0 && fs.readFileSync(out).equals(原图));
}

console.log("3) 输出不泄露 key");
{
  const out = path.join(TMP, "out3.jpg");
  const r = run("--url", 密文路径, "--aeskey", key带等号, "--out", out);
  const 全输出 = r.stdout + r.stderr;
  断言("输出里没有完整 key", !全输出.includes(key带等号) && !全输出.includes(key无等号));
}

console.log("4) 错误场景");
{
  const out = path.join(TMP, "out4.jpg");
  const r1 = run("--url", path.join(TMP, "不存在.bin"), "--aeskey", key带等号, "--out", out);
  断言("文件不存在 → exit 1 且提示", r1.status === 1 && /取图失败/.test(r1.stderr), `status=${r1.status}`);
  const r2 = run("--url", 密文路径, "--aeskey", "短", "--out", out);
  断言("key 长度不对 → exit 1", r2.status === 1 && /32/.test(r2.stderr), `status=${r2.status}`);
  const r3 = run("--url", 密文路径, "--aeskey", key带等号);
  断言("缺 --out → exit 2", r3.status === 2, `status=${r3.status}`);
}

console.log("5) 帮助页");
{
  const r = run("--帮助");
  断言("exit=0 且含用法", r.status === 0 && /用法/.test(r.stdout));
}

console.log(`\n结果：${过} 过 / ${败} 败`);
process.exit(败 ? 1 : 0);
