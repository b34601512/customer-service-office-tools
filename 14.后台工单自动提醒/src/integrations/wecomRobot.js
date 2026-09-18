// 本文件只负责向企业微信群机器人发送文本消息（含 @ 手机号），失败统一转中文原因。
const { log } = require("../engine/logger");

const WECOM_REQUEST_TIMEOUT_MS = 10000;
const WECOM_MAX_ATTEMPTS = 2;

async function postOnce(webhookUrl, content, mentionedMobileList, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WECOM_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: { content, mentioned_mobile_list: mentionedMobileList }
      }),
      signal: controller.signal
    });
  } catch (error) {
    const reason = error && error.name === "AbortError"
      ? `请求超时(${WECOM_REQUEST_TIMEOUT_MS / 1000}秒)`
      : (error instanceof Error ? error.message : String(error));
    throw new Error(`企微机器人发送失败(第${attempt}次)：${reason}`);
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`企微机器人发送失败(第${attempt}次)：响应不是合法 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok || payload.errcode !== 0) {
    throw new Error(`企微机器人发送失败(第${attempt}次)：HTTP ${response.status}，errcode=${payload.errcode}，errmsg=${payload.errmsg}`);
  }
  return payload;
}

async function sendWecomText(webhookUrl, webhookName, content, mentionedMobileList = []) {
  const mentions = (mentionedMobileList || []).filter(Boolean);
  let lastError = null;
  for (let attempt = 1; attempt <= WECOM_MAX_ATTEMPTS; attempt += 1) {
    try {
      await postOnce(webhookUrl, content, mentions, attempt);
      log("企微", webhookName || "机器人", "发送成功", `@数=${mentions.length}`);
      return;
    } catch (error) {
      lastError = error;
      log("企微", webhookName || "机器人", "发送失败", error.message);
    }
  }
  throw lastError;
}

module.exports = { sendWecomText };
