const { log } = require("../engine/logger");

const WECOM_REQUEST_TIMEOUT_MS = 10000;
const WECOM_MAX_ATTEMPTS = 2;

async function postWecomRobotTextMessage(input, attempt) {
  // 这里单次发送企微文本消息，失败原因统一转成可读中文，避免底层 fetch 异常直接裸奔。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WECOM_REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(input.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        msgtype: "text",
        text: {
          content: input.content,
          mentioned_mobile_list: input.mentionedMobileList || []
        }
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
    throw new Error(`企微机器人发送失败(第${attempt}次)：响应不是合法 JSON（HTTP ${response.status}），${error.message}`);
  }

  if (!response.ok || payload.errcode !== 0) {
    throw new Error(
      `企微机器人发送失败(第${attempt}次)：HTTP ${response.status}，errcode=${payload.errcode}，errmsg=${payload.errmsg}`
    );
  }

  return payload;
}

async function sendWecomRobotTextMessage(input) {
  // 这里统一发企微群机器人文本消息，并把 @ 配置是否命中清楚打印到终端。
  // 增加超时与一次重试：webhook 偶发挂起或 5xx 时不影响下一轮扫描继续推进。
  const mentionedMobileList = (input.mentionedMobileList || []).filter(Boolean);
  log(
    "主线:执行",
    "企微机器人",
    "发送文本消息",
    `场景=${input.scene}，目标=${input.webhookName}，@手机号数=${mentionedMobileList.length}`
  );

  let lastError = null;
  for (let attempt = 1; attempt <= WECOM_MAX_ATTEMPTS; attempt += 1) {
    try {
      await postWecomRobotTextMessage(input, attempt);
      log("主线:完成", "企微机器人", "发送成功", `场景=${input.scene}，目标=${input.webhookName}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < WECOM_MAX_ATTEMPTS) {
        log(
          "主线:等待",
          "企微机器人",
          "重试发送",
          `${error.message}，准备第 ${attempt + 1} 次重试`
        );
      }
    }
  }

  throw lastError || new Error("企微机器人发送失败：未知原因。");
}

module.exports = {
  sendWecomRobotTextMessage
};
