const JD_DATE_STATE_POLL_INTERVAL_MS = 1000;

function waitForJdDateStateDelay(ms) {
  // 这个函数只等待一次京东日期状态轮询间隔。
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNextJdDateStateCheck(deadlineMs, pollIntervalMs = JD_DATE_STATE_POLL_INTERVAL_MS) {
  // 这个函数只在剩余超时范围内等待下一次日期状态检查。
  const remainingMs = Math.max(0, Number(deadlineMs) - Date.now());
  if (remainingMs <= 0) {
    return;
  }
  await waitForJdDateStateDelay(
    Math.min(Math.max(1, Number(pollIntervalMs) || JD_DATE_STATE_POLL_INTERVAL_MS), remainingMs)
  );
}

module.exports = {
  JD_DATE_STATE_POLL_INTERVAL_MS,
  waitForJdDateStateDelay,
  waitForNextJdDateStateCheck
};
