// 通用格式化工具：时长、倒计时、状态标签、布尔值等，页面只消费这里的结果。
const { padEnd, fit } = require("./width");

function formatDurationMs(elapsedMs) {
  const totalSeconds = Math.floor(Math.max(0, Number(elapsedMs) || 0) / 1000);
  if (totalSeconds <= 0) {
    return "刚刚";
  }
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

function formatRemainingSeconds(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (seconds <= 0) {
    return "已到点";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
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

function formatBool(value) {
  return value ? "开启" : "关闭";
}

function formatTaskStatus(task) {
  if (!task || task.status === "idle") {
    return { label: "空闲", color: "gray" };
  }
  const statusMap = {
    running: { label: "运行中", color: "brightGreen" },
    stopping: { label: "停止中", color: "yellow" },
    failed: { label: "失败", color: "brightRed" },
    idle: { label: "已结束", color: "gray" }
  };
  return statusMap[task.status] || { label: task.status, color: "gray" };
}

function formatLoginStatus(loginStatus) {
  const status = String(loginStatus?.status || "unknown");
  if (status === "valid") {
    return { label: "有效", color: "brightGreen" };
  }
  if (status === "invalid") {
    return { label: "已失效", color: "brightRed" };
  }
  return { label: "未验证", color: "yellow" };
}

function joinLines(lines, width) {
  // 这里统一把页面内容行补齐到等宽，避免短行后面残留上一帧的字符。
  return lines.map((line) => fit(line, width));
}

module.exports = {
  formatDurationMs,
  formatRemainingSeconds,
  formatClock,
  formatDateTimeText,
  formatBool,
  formatTaskStatus,
  formatLoginStatus,
  joinLines,
  padEnd
};
