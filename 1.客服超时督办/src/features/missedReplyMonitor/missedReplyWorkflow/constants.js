// 该文件用于集中未实质回复监控的固定名称，避免流程文件重复拼文案。
const MISSED_REPLY_MONITOR_MODE_NAME = "未实质回复监控=首次超时提醒+10倍阈值漏回复提醒";
const MISSED_REPLY_MONITOR_PROMPT_TRACE =
  "统一未实质回复引擎从首条未解决客户消息起计时；临时回复只免首次超时，只有人工实质回复结案";
const MISSED_REPLY_LOG_MODULE_NAME = "未实质回复监控";

module.exports = {
  MISSED_REPLY_LOG_MODULE_NAME,
  MISSED_REPLY_MONITOR_MODE_NAME,
  MISSED_REPLY_MONITOR_PROMPT_TRACE
};
