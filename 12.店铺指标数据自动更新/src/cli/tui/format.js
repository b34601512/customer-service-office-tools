// 通用格式化工具：时钟、时长、汇总任务状态标签等，页面只消费这里的结果。
const { padEnd, fit } = require("./width");

function formatDurationMs(elapsedMs) {
  const totalSeconds = Math.floor(Math.max(0, Number(elapsedMs) || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${String(minutes).padStart(2, "0")}分`;
  }
  if (minutes > 0) {
    return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
  }
  return `${seconds}秒`;
}

function formatClock(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDateTimeText(value) {
  if (!value) {
    return "暂无";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return formatClock(date);
}

// 汇总任务状态 → 展示标签与颜色；与旧 CLI 的 [完成]/[失败]/[运行] 前缀对齐。
// #12 的店铺任务状态含 skipped（今日已完成跳过），这里额外补上灰色“跳过”。
function formatSummaryTaskStatus(taskStatus) {
  const statusMap = {
    ready: { label: "等待", color: "gray" },
    running: { label: "运行", color: "brightYellow" },
    success: { label: "完成", color: "brightGreen" },
    skipped: { label: "跳过", color: "gray" },
    error: { label: "失败", color: "brightRed" }
  };
  return statusMap[taskStatus] || { label: String(taskStatus || "未知"), color: "gray" };
}

function joinLines(lines, width) {
  return lines.map((line) => fit(line, width));
}

module.exports = {
  formatDurationMs,
  formatClock,
  formatDateTimeText,
  formatSummaryTaskStatus,
  joinLines,
  padEnd
};