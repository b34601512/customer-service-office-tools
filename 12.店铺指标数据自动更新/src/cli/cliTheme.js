const ANSI_CODES = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  gray: "\u001b[90m"
};

function createCliTheme(output = process.stdout) {
  const colorEnabled = Boolean(output?.isTTY) && !process.env.NO_COLOR;

  function decorate(text, ...codes) {
    const normalizedText = String(text ?? "");
    return colorEnabled ? `${codes.join("")}${normalizedText}${ANSI_CODES.reset}` : normalizedText;
  }

  return {
    colorEnabled,
    title(text) { return decorate(text, ANSI_CODES.bold, ANSI_CODES.cyan); },
    heading(text) { return decorate(text, ANSI_CODES.bold); },
    success(text) { return decorate(text, ANSI_CODES.green); },
    warning(text) { return decorate(text, ANSI_CODES.yellow); },
    error(text) { return decorate(text, ANSI_CODES.red); },
    muted(text) { return decorate(text, ANSI_CODES.gray); },
    accent(text) { return decorate(text, ANSI_CODES.cyan); },
    status(status) {
      const normalizedStatus = String(status || "idle");
      const labelByStatus = {
        idle: "待运行",
        running: "运行中",
        success: "已完成",
        partial_error: "部分失败",
        error: "失败"
      };
      const label = labelByStatus[normalizedStatus] || normalizedStatus;
      if (normalizedStatus === "success") return this.success(label);
      if (normalizedStatus === "running") return this.warning(label);
      if (normalizedStatus === "error" || normalizedStatus === "partial_error") return this.error(label);
      return this.muted(label);
    }
  };
}

module.exports = {
  ANSI_CODES,
  createCliTheme
};
