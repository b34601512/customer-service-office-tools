const JD_STATE_POLL_INTERVAL_MS = 1000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNextJdStateCheck(deadlineMs, pollIntervalMs = JD_STATE_POLL_INTERVAL_MS) {
  // 这里把状态检查等待限制在剩余超时时间内，避免固定等待拖慢流程。
  const remainingMs = Math.max(0, Number(deadlineMs) - Date.now());
  if (remainingMs <= 0) return;
  await wait(Math.min(Math.max(1, Number(pollIntervalMs) || JD_STATE_POLL_INTERVAL_MS), remainingMs));
}

function normalizeText(value) {
  // 这里统一清理京东页面文字，避免每个模块各自实现不同规则。
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  wait,
  waitForNextJdStateCheck,
  JD_STATE_POLL_INTERVAL_MS,
  normalizeText
};
