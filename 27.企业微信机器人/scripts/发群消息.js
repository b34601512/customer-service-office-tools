#!/usr/bin/env node
/**
 * 27号 企微群机器人发送脚本（路线 A：群机器人 Webhook）
 *
 * ⚠ 2026-09-30 收拢：**逻辑只有一份** —— `src/企微通知.cjs`（22/24/25 号的 `send-wecom-notice.js` 也是走它）。
 *    本文件现在只是薄壳：把 CLI 参数转给它，并保留老的导出名（parseArgs/buildPayload/... 供测试与老调用方用）。
 *    要改行为（预览/发送/校验/限频提示）请改 `src/企微通知.cjs`，别在这里另写。
 *
 * 默认只预览、不发送；加 --send 才会真正发送。发送前请人工确认内容（仓库红线）。
 * 只尝试 1 次、不自动重试：避免重复消息，遵循仓库「失败不自动重试」铁律。
 *
 * 用法：
 *   node scripts/发群消息.js --text "内容" [--mention 手机号,手机号] [--type text|markdown]
 *   node scripts/发群消息.js --text-file 报告.txt --send
 *
 * Webhook 来源（二选一，推荐环境变量）：
 *   --webhook "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
 *   或环境变量 WECOM_WEBHOOK_URL
 */

const 共享 = require("../src/企微通知.cjs");

// —— 老名字 → 共享核心的实现（保持向后兼容，改行为请改共享核心）
const parseArgs = 共享.解析群机器人参数;
const readContent = 共享.读正文;
const resolveWebhook = (options) => 共享.取群机器人地址(options);
const validateWebhook = 共享.校验机器人地址;
const maskWebhook = 共享.打码机器人地址;
const buildPayload = (options, content) => 共享.造消息体({ 类型: options.type, 内容: content, 提及手机号: options.mention });
const sendOnce = (webhookUrl, payload) => 共享.发一条({ webhookUrl, 消息体: payload });

if (require.main === module) {
  共享.跑群机器人命令行({ argv: process.argv.slice(2) }).catch((error) => {
    console.error(`[失败] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  readContent,
  resolveWebhook,
  validateWebhook,
  maskWebhook,
  buildPayload,
  sendOnce
};
