// 游戏化 UI 元素：彩色标题横幅、血条式进度条、旋转指示器、居中文本。
// 纯 ANSI + CJK 宽度感知，零依赖；页面直接消费这里的行片段。
const ansi = require("./ansi");
const { fit, displayWidth } = require("./width");

const SPINNER_FRAMES = ["│", "/", "─", "\\"];

function spinner(tick) {
  return SPINNER_FRAMES[Math.abs(Number(tick) || 0) % SPINNER_FRAMES.length];
}

// 血条式进度条：█ 填充 + ░ 空位 + 数值/总量。
function progressBar(value, max, width, color = "brightGreen") {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.max(0, Math.min(Number(value) || 0, safeMax));
  const barWidth = Math.max(1, width - 6);
  const filled = Math.round((safeValue / safeMax) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(Math.max(0, barWidth - filled));
  return `${ansi.colorize(bar, color)} ${safeValue}/${safeMax}`;
}

function centerText(text, width) {
  const textWidth = displayWidth(text);
  const leftPad = Math.max(0, Math.floor((width - textWidth) / 2));
  return " ".repeat(leftPad) + text;
}

// 彩色双线框标题横幅，返回 3 行。
function titleBanner(title, width) {
  const innerWidth = Math.max(10, width);
  const top = ansi.colorize(`╔${"═".repeat(innerWidth)}╗`, "brightCyan");
  const middle = ansi.colorize("║", "brightCyan") +
    ansi.colorize(centerText(fit(title, innerWidth), innerWidth), "bold") +
    ansi.colorize("║", "brightCyan");
  const bottom = ansi.colorize(`╚${"═".repeat(innerWidth)}╝`, "brightCyan");
  return [top, middle, bottom];
}

module.exports = {
  spinner,
  progressBar,
  centerText,
  titleBanner
};