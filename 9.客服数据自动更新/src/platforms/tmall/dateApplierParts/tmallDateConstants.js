// 该文件用于解决天猫日期脚本直达流程的统一等待参数问题。
const appConfig = require("../../../config/appConfig");

const TMALL_DATE_SCRIPT_TIMEOUT_MS = 20000;
const TMALL_DATE_PAGE_TIMEOUT_MS = 15000;
const TMALL_DATE_POLL_INTERVAL_MS = appConfig.tmall.datePollIntervalMs;

module.exports = {
  TMALL_DATE_SCRIPT_TIMEOUT_MS,
  TMALL_DATE_PAGE_TIMEOUT_MS,
  TMALL_DATE_POLL_INTERVAL_MS
};
