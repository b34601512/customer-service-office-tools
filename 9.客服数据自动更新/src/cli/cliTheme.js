const ANSI_CODES = {
  reset: "\u001b[0m", bold: "\u001b[1m", cyan: "\u001b[36m", green: "\u001b[32m",
  yellow: "\u001b[33m", red: "\u001b[31m", gray: "\u001b[90m"
};

function createCliTheme(output = process.stdout) {
  const colorEnabled = Boolean(output?.isTTY) && !process.env.NO_COLOR;
  function decorate(text, ...codes) {
    const normalizedText = String(text ?? "");
    return colorEnabled ? `${codes.join("")}${normalizedText}${ANSI_CODES.reset}` : normalizedText;
  }
  return {
    colorEnabled,
    title: (text) => decorate(text, ANSI_CODES.bold, ANSI_CODES.cyan),
    heading: (text) => decorate(text, ANSI_CODES.bold),
    success: (text) => decorate(text, ANSI_CODES.green),
    warning: (text) => decorate(text, ANSI_CODES.yellow),
    error: (text) => decorate(text, ANSI_CODES.red),
    muted: (text) => decorate(text, ANSI_CODES.gray),
    accent: (text) => decorate(text, ANSI_CODES.cyan)
  };
}

module.exports = { ANSI_CODES, createCliTheme };
