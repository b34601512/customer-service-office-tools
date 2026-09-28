#!/usr/bin/env node
// 从 wecom-cli 的本机凭据库导出「Bot ID + Secret」到本机配置，供长连接脚本使用。
//
// 背景（2026-09-28 实测）：wecom-cli 把凭据存在 `~/.config/wecom/`：
//   - `.encryption_key`：base64 的 32 字节 AES 密钥
//   - `credentials.enc`：AES-256-GCM 密文（前 12 字节 nonce，末 16 字节 tag），明文是 { bot: { id, secret, create_time }, token }
// 本脚本只读、只写本机 project-config（已 gitignore），任何情况下都不打印 secret 原文。
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const CONFIG_DIR = path.join(os.homedir(), ".config", "wecom");
const OUT_PATH = path.join(__dirname, "..", "project-config", "aibot-credentials.local.json");

function readCredentials() {
  const key = Buffer.from(fs.readFileSync(path.join(CONFIG_DIR, ".encryption_key"), "utf8").trim(), "base64");
  const blob = fs.readFileSync(path.join(CONFIG_DIR, "credentials.enc"));
  const nonce = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(12, blob.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plain);
}

function main() {
  let parsed;
  try {
    parsed = readCredentials();
  } catch (error) {
    console.error("读取本机凭据失败：", error.message);
    console.error("提示：先在 27号 跑 `scripts/手动授权.bat` 或 `scripts/扫码授权.bat` 完成授权。");
    process.exitCode = 1;
    return;
  }
  const bot = parsed.bot || {};
  if (!bot.id || !bot.secret) {
    console.error("凭据里没有 bot.id / bot.secret（可能不是 API 模式授权）。");
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    _说明: "本机私有：长连接脚本用的机器人凭据，绝不入库。来源：wecom-cli 本机凭据库导出。",
    botId: bot.id,
    secret: bot.secret
  }, null, 2), "utf8");
  const mask = (value) => String(value).slice(0, 4) + "…(len=" + String(value).length + ")";
  console.log("已导出到", path.relative(process.cwd(), OUT_PATH));
  console.log("botId =", mask(bot.id), "| secret =", mask(bot.secret));
}

main();
