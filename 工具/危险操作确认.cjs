#!/usr/bin/env node
/**
 * 危险操作确认闸门（老板 2026-10-26 18:20：不可逆操作必须输入密码）
 *
 * 用法（任何要删/批量覆盖/停用/清空/授权变更/发布上线/改写 git 历史的脚本，动手前先调它）：
 *   node 工具/危险操作确认.cjs --要做 "删掉 xxx 目录" [--密码 <他从企微念给我的4-8位>]
 *
 * 判定：
 *   密码对  → 退出码 0，打一行「已确认」，并把这次确认记进 .state/危险操作台账.jsonl
 *   没给/给错 → 退出码 2，打「拦住：需要黎路遥本人给密码」，**什么也不做**
 *
 * 密码只在 0.木婉清档案/project-config/危险操作密码.local.json（已 gitignore），
 * 不许打印明文、不许贴对话、不许写进任何 md。
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const 根 = path.resolve(__dirname, "..");
const 密码文件 = path.join(根, "0.木婉清档案", "project-config", "危险操作密码.local.json");
const 台账 = path.join(根, ".state", "危险操作台账.jsonl");

function 读密码() {
  try {
    const j = JSON.parse(fs.readFileSync(密码文件, "utf8"));
    return String(j.密码 || "").trim();
  } catch {
    return "";
  }
}

const argv = process.argv.slice(2);
let 要做 = "";
let 给 = "";
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--要做") { 要做 = String(argv[i + 1] || ""); i += 1; }
  else if (argv[i] === "--密码") { 给 = String(argv[i + 1] || "").trim(); i += 1; }
}

const 真密码 = 读密码();
if (!真密码) {
  console.error("[拦住] 本机没有密码文件（或为空）：0.木婉清档案/project-config/危险操作密码.local.json。先把密码定下来，再谈动手。");
  process.exit(2);
}
if (!给) {
  console.error("[拦住] 不可逆操作要黎路遥本人给密码。他没给，我什么都不做。要办的事：" + (要做 || "（未说明）"));
  process.exit(2);
}
const 同 = (a, b) => {
  const A = Buffer.from(a); const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
if (!同(给, 真密码)) {
  console.error("[拦住] 密码不对。别猜、别试第三遍，回去问他本人。");
  process.exit(2);
}

fs.mkdirSync(path.dirname(台账), { recursive: true });
fs.appendFileSync(台账, JSON.stringify({ 时间: new Date().toISOString(), 要做, 确认人: "黎路遥" }) + "\n", "utf8");
console.log("[已确认] 密码对，可以动手：" + (要做 || "（未说明）"));
process.exit(0);
