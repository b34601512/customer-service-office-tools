// 终端显示宽度计算：以完整可见字形为单位，再判断该字形占 1 列还是 2 列。
// 组合附加符、肤色表情和 ZWJ 表情必须整体计算，否则固定宽度的表格仍会视觉错位。
const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;
const ANSI_PART_PATTERN = /(\x1b\[[0-9;]*[A-Za-z])/g;
const ANSI_TOKEN_PATTERN = /^\x1b\[[0-9;]*[A-Za-z]$/;
const ZERO_WIDTH_CODE_POINT_PATTERN = /^(?:\p{Mark}|\p{Cf})$/u;
const EMOJI_PRESENTATION_PATTERN = /\p{Emoji_Presentation}/u;
const EMOJI_STYLE_PATTERN = /[\ufe0f\u20e3]/u;
const GRAPHEME_SEGMENTER = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_PATTERN, "");
}

function normalizeCellText(text) {
  // 表格/列表单元格先统一成单行，避免业务文本里的竖线或旧省略号被误认为列边界。
  // 真正的省略由 fit/truncate 按当前列宽完成，保证每个字段只在自己的边界收口。
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/[|｜│]/g, " · ")
    .replace(/(?:\.{2,}|…+)\s*$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isWideChar(char) {
  const code = char.codePointAt(0);
  // 只把“确定全角”的字符按 2 格计算：CJK 汉字、假名、全角标点、全角形式、emoji。
  // 歧义标点（…、—、引号、箭头等）在等宽终端里按英文字符渲染 1 格，一律不按宽算，
  // 否则这些字符所在的行会比列宽短一格导致错位。
  return (
    (code >= 0x1100 && code <= 0x115f) || // 谚文音节 Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK 部首 / 汉字标点（【】《》等）
    (code >= 0x3041 && code <= 0x33ff) || // 假名 / CJK 兼容
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一汉字
    (code >= 0xa000 && code <= 0xa4cf) || // 彝文
    (code >= 0xac00 && code <= 0xd7a3) || // 谚文音节
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意文字
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK 兼容形式
    (code >= 0xff00 && code <= 0xff60) || // 全角形式（全角括号/标点/数字）
    (code >= 0xffe0 && code <= 0xffe6) || // 全角货币符号
    (code >= 0x1f300 && code <= 0x1faff) // 表情符号 / 杂项符号和象形文字
  );
}

function splitGraphemes(text) {
  return Array.from(GRAPHEME_SEGMENTER.segment(String(text ?? "")), ({ segment }) => segment);
}

function graphemeWidth(grapheme) {
  const baseCharacter = [...grapheme].find((character) => !ZERO_WIDTH_CODE_POINT_PATTERN.test(character));
  if (!baseCharacter) {
    return 0;
  }

  // 默认表情、显式 emoji 样式及键帽序列在 Windows Terminal 中占 2 列。
  // 整个字形只计一次，肤色、连接符和附加符不再重复占列。
  if (EMOJI_PRESENTATION_PATTERN.test(grapheme) || EMOJI_STYLE_PATTERN.test(grapheme)) {
    return 2;
  }
  return isWideChar(baseCharacter) ? 2 : 1;
}

function displayWidth(text) {
  let width = 0;
  for (const grapheme of splitGraphemes(stripAnsi(text))) {
    width += graphemeWidth(grapheme);
  }
  return width;
}

function padEnd(text, width, fill = " ") {
  const str = String(text ?? "");
  const currentWidth = displayWidth(str);
  if (currentWidth >= width) {
    return str;
  }
  // 这里在行尾补空格：若原文带颜色码，填充字符会落在 reset 码之后，不会把颜色带进空白区。
  return str + String(fill).repeat(width - currentWidth);
}

function truncate(text, width) {
  const str = String(text ?? "");
  if (displayWidth(str) <= width) {
    return str;
  }

  if (width <= 0) {
    return "";
  }

  const ellipsisWidth = displayWidth("…");
  const maxContentWidth = Math.max(0, width - ellipsisWidth);
  let result = "";
  let currentWidth = 0;
  let hadEscape = false;
  const parts = str.split(ANSI_PART_PATTERN);
  let reachedBoundary = false;
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (ANSI_TOKEN_PATTERN.test(part)) {
      result += part;
      hadEscape = true;
      continue;
    }
    for (const grapheme of splitGraphemes(part)) {
      const visibleWidth = graphemeWidth(grapheme);
      if (currentWidth + visibleWidth > maxContentWidth) {
        reachedBoundary = true;
        break;
      }
      result += grapheme;
      currentWidth += visibleWidth;
    }
    if (reachedBoundary) {
      break;
    }
  }
  // 这里截断可能切掉结尾的 reset 码，统一补一个复位，避免省略号后面残留颜色。
  return `${result}${hadEscape ? "\x1b[0m" : ""}…`;
}

function fit(text, width, 是否截断 = true) {
  const str = String(text ?? "");
  if (displayWidth(str) <= width) {
    return padEnd(str, width);
  }
  if (!是否截断) {
    return str;
  }
  // 这里截断后必须再补齐到目标宽度：truncate 只保证“不超过”，
  // 若不补足空格，被截断的列会比固定列宽短 1 格，导致后续分隔符左移错位。
  return padEnd(truncate(str, width), width);
}

function padStart(text, width, fill = " ") {
  const str = String(text ?? "");
  const currentWidth = displayWidth(str);
  if (currentWidth >= width) {
    return str;
  }
  return String(fill).repeat(width - currentWidth) + str;
}

module.exports = {
  stripAnsi,
  normalizeCellText,
  displayWidth,
  isWideChar,
  padEnd,
  padStart,
  truncate,
  fit
};
