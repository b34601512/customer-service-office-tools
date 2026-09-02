// 该文件用于计算未实质回复两段提醒阈值。
const { MISSED_REPLY_THRESHOLD_MULTIPLIER } = require("./constants");

function normalizeThresholdSeconds(value, fieldLabel) {
  // 这里统一校验提醒阈值，配置错就直接报错，不能静默进入错误提醒节奏。
  const normalizedValue = Math.floor(Number(value));
  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    throw new Error(`${fieldLabel}配置错误：必须是大于 0 的秒数。`);
  }

  return normalizedValue;
}

function resolveMissedReplyThresholdSeconds(timeoutThresholdSeconds) {
  // 这里固定漏回复等于首次超时阈值的 10 倍，砍掉第二套可配阈值，避免两个配置互相打架。
  return normalizeThresholdSeconds(timeoutThresholdSeconds, "首次超时提醒阈值") * MISSED_REPLY_THRESHOLD_MULTIPLIER;
}

module.exports = {
  normalizeThresholdSeconds,
  resolveMissedReplyThresholdSeconds
};
