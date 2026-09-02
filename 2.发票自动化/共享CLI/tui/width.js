// 终端显示宽度计算：以完整可见字形为单位，再判断该字形占 1 列还是 2 列。
// 组合附加符、肤色表情和 ZWJ 表情必须整体计算，否则固定宽度的表格仍会视觉错位。
const ANSI匹配模式 = /\x1b\[[0-9;]*[A-Za-z]/g;
const ANSI分段模式 = /(\x1b\[[0-9;]*[A-Za-z])/g;
const ANSI令牌模式 = /^\x1b\[[0-9;]*[A-Za-z]$/;
const 零宽码点模式 = /^(?:\p{Mark}|\p{Cf})$/u;
const 默认表情模式 = /\p{Emoji_Presentation}/u;
const 表情样式模式 = /[\ufe0f\u20e3]/u;
const 字形分段器 = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

function 剥离ANSI(文本) {
  return String(文本 ?? "").replace(ANSI匹配模式, "");
}

function 是全角字符(字符) {
  const 码点 = 字符.codePointAt(0);
  // 只计算确定占两列的字符。…、—、箭头等歧义标点在 Windows Terminal 中按一列显示。
  return (
    (码点 >= 0x1100 && 码点 <= 0x115f) ||
    (码点 >= 0x2e80 && 码点 <= 0x303e) ||
    (码点 >= 0x3041 && 码点 <= 0x33ff) ||
    (码点 >= 0x3400 && 码点 <= 0x4dbf) ||
    (码点 >= 0x4e00 && 码点 <= 0x9fff) ||
    (码点 >= 0xa000 && 码点 <= 0xa4cf) ||
    (码点 >= 0xac00 && 码点 <= 0xd7a3) ||
    (码点 >= 0xf900 && 码点 <= 0xfaff) ||
    (码点 >= 0xfe30 && 码点 <= 0xfe4f) ||
    (码点 >= 0xff00 && 码点 <= 0xff60) ||
    (码点 >= 0xffe0 && 码点 <= 0xffe6) ||
    (码点 >= 0x1f300 && 码点 <= 0x1faff)
  );
}

function 拆分字形(文本) {
  return Array.from(字形分段器.segment(String(文本 ?? "")), ({ segment }) => segment);
}

function 字形宽度(字形) {
  const 基础字符 = [...字形].find((字符) => !零宽码点模式.test(字符));
  if (!基础字符) {
    return 0;
  }
  if (默认表情模式.test(字形) || 表情样式模式.test(字形)) {
    return 2;
  }
  return 是全角字符(基础字符) ? 2 : 1;
}

function 显示宽度(文本) {
  let 宽度 = 0;
  for (const 字形 of 拆分字形(剥离ANSI(文本))) {
    宽度 += 字形宽度(字形);
  }
  return 宽度;
}

function 右侧补齐(文本, 宽度, 填充字符 = " ") {
  const 字符串 = String(文本 ?? "");
  const 当前宽度 = 显示宽度(字符串);
  if (当前宽度 >= 宽度) {
    return 字符串;
  }
  return 字符串 + String(填充字符).repeat(宽度 - 当前宽度);
}

function 左侧补齐(文本, 宽度, 填充字符 = " ") {
  const 字符串 = String(文本 ?? "");
  const 当前宽度 = 显示宽度(字符串);
  if (当前宽度 >= 宽度) {
    return 字符串;
  }
  return String(填充字符).repeat(宽度 - 当前宽度) + 字符串;
}

function 截断(文本, 宽度) {
  const 字符串 = String(文本 ?? "");
  if (显示宽度(字符串) <= 宽度) {
    return 字符串;
  }

  if (宽度 <= 0) {
    return "";
  }

  const 省略号宽度 = 显示宽度("…");
  const 最大内容宽度 = Math.max(0, 宽度 - 省略号宽度);
  let 结果 = "";
  let 当前宽度 = 0;
  let 是否含转义 = false;
  const 分段列表 = 字符串.split(ANSI分段模式);
  let 已到边界 = false;
  for (const 分段 of 分段列表) {
    if (!分段) {
      continue;
    }
    if (ANSI令牌模式.test(分段)) {
      结果 += 分段;
      是否含转义 = true;
      continue;
    }
    for (const 字形 of 拆分字形(分段)) {
      const 可见宽度 = 字形宽度(字形);
      if (当前宽度 + 可见宽度 > 最大内容宽度) {
        已到边界 = true;
        break;
      }
      结果 += 字形;
      当前宽度 += 可见宽度;
    }
    if (已到边界) {
      break;
    }
  }
  return `${结果}${是否含转义 ? "\x1b[0m" : ""}…`;
}

function 适配宽度(文本, 宽度) {
  const 字符串 = String(文本 ?? "");
  if (显示宽度(字符串) <= 宽度) {
    return 右侧补齐(字符串, 宽度);
  }
  // 截断只保证不超宽，随后仍要补齐，后续固定列的分隔符才不会左移。
  return 右侧补齐(截断(字符串, 宽度), 宽度);
}

module.exports = {
  剥离ANSI,
  显示宽度,
  是全角字符,
  右侧补齐,
  左侧补齐,
  截断,
  适配宽度,
};
