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
  // 列表/表格单元格先统一成单行，避免业务文本中的竖线或后台旧省略号制造“假列边界”。
  // fit/truncate 再按当前终端宽度完成唯一一次受控省略。
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
  // 歧义标点（…、—、引号、箭头等）在 Windows Terminal 中按 1 格渲染。
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
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
  // truncate 只保证“不超过”，截断后仍需补齐，后续固定列才不会左移。
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
