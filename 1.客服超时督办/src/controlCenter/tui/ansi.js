// ANSI 转义序列工具：所有终端绘制都从这里取码，避免页面代码散落裸转义符。
const ESC = "\x1b";

const codes = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  underline: `${ESC}[4m`,
  reverse: `${ESC}[7m`,
  black: `${ESC}[30m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  white: `${ESC}[37m`,
  gray: `${ESC}[90m`,
  brightRed: `${ESC}[91m`,
  brightGreen: `${ESC}[92m`,
  brightYellow: `${ESC}[93m`,
  brightBlue: `${ESC}[94m`,
  brightCyan: `${ESC}[96m`,
  bgRed: `${ESC}[41m`,
  bgGreen: `${ESC}[42m`,
  bgYellow: `${ESC}[43m`,
  bgBlue: `${ESC}[44m`,
  bgCyan: `${ESC}[46m`,
  bgGray: `${ESC}[100m`,
  hideCursor: `${ESC}[?25l`,
  showCursor: `${ESC}[?25h`,
  enterAltScreen: `${ESC}[?1049h`,
  leaveAltScreen: `${ESC}[?1049l`,
  clearScreen: `${ESC}[2J`,
  cursorHome: `${ESC}[H`
};

function moveTo(row, col) {
  return `${ESC}[${row};${col}H`;
}

function clearLine() {
  return `${ESC}[2K`;
}

function colorize(text, color) {
  const colorCode = codes[color];
  if (!colorCode) {
    return String(text);
  }
  return `${colorCode}${text}${codes.reset}`;
}

module.exports = {
  codes,
  ESC,
  moveTo,
  clearLine,
  colorize
};
