// 该文件用于统一拼多多日期链路的低频状态轮询节奏。
const { wait } = require("../../../shared/browserActionEngine");

const PDD_DATE_STATE_POLL_INTERVAL_MS = 700;

async function waitForNextPddDateStateCheck(deadlineMs, pollIntervalMs = PDD_DATE_STATE_POLL_INTERVAL_MS) {
  // 这里低频等待页面状态变化，避免日期控件刚渲染时读到旧 DOM。
  const remainingMs = Math.max(0, Number(deadlineMs) - Date.now());
  if (remainingMs <= 0) {
    return;
  }

  await wait(Math.min(Math.max(1, Number(pollIntervalMs) || PDD_DATE_STATE_POLL_INTERVAL_MS), remainingMs));
}

module.exports = {
  PDD_DATE_STATE_POLL_INTERVAL_MS,
  waitForNextPddDateStateCheck
};
