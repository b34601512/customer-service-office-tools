// ANSI 转义序列工具：所有终端绘制都从这里取码，避免页面代码散落裸转义符。
const 转义符 = "\x1b";

const ANSI代码 = {
  reset: `${转义符}[0m`,
  bold: `${转义符}[1m`,
  dim: `${转义符}[2m`,
  underline: `${转义符}[4m`,
  reverse: `${转义符}[7m`,
  black: `${转义符}[30m`,
  red: `${转义符}[31m`,
  green: `${转义符}[32m`,
  yellow: `${转义符}[33m`,
  blue: `${转义符}[34m`,
  magenta: `${转义符}[35m`,
  cyan: `${转义符}[36m`,
  white: `${转义符}[37m`,
  gray: `${转义符}[90m`,
  brightRed: `${转义符}[91m`,
  brightGreen: `${转义符}[92m`,
  brightYellow: `${转义符}[93m`,
  brightBlue: `${转义符}[94m`,
  brightCyan: `${转义符}[96m`,
  bgRed: `${转义符}[41m`,
  bgGreen: `${转义符}[42m`,
  bgYellow: `${转义符}[43m`,
  bgBlue: `${转义符}[44m`,
  bgCyan: `${转义符}[46m`,
  bgGray: `${转义符}[100m`,
  hideCursor: `${转义符}[?25l`,
  showCursor: `${转义符}[?25h`,
  enterAltScreen: `${转义符}[?1049h`,
  leaveAltScreen: `${转义符}[?1049l`,
  clearScreen: `${转义符}[2J`,
  cursorHome: `${转义符}[H`,
};

function 移动光标到(行, 列) {
  return `${转义符}[${行};${列}H`;
}

function 清空当前行() {
  return `${转义符}[2K`;
}

function 着色(文本, 颜色名称) {
  const 颜色代码 = ANSI代码[颜色名称];
  if (!颜色代码) {
    return String(文本);
  }
  return `${颜色代码}${文本}${ANSI代码.reset}`;
}

module.exports = {
  ANSI代码,
  转义符,
  移动光标到,
  清空当前行,
  着色,
};
