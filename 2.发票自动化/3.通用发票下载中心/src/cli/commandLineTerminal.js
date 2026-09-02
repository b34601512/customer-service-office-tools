const CLI_DIVIDER = "─".repeat(68);

const ANSI_CODES = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  cyan: "\u001b[36m",
  blue: "\u001b[34m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  magenta: "\u001b[35m",
  white: "\u001b[37m",
  gray: "\u001b[90m",
  clear: "\u001b[2J",
  home: "\u001b[H",
};

function 创建命令行主题(outputStream = process.stdout) {
  const 启用颜色 = Boolean(outputStream?.isTTY) && !process.env.NO_COLOR;

  function 添加颜色(文本, ...颜色代码) {
    const 标准文本 = String(文本 ?? "");
    return 启用颜色
      ? `${颜色代码.join("")}${标准文本}${ANSI_CODES.reset}`
      : 标准文本;
  }

  return {
    启用颜色,
    标题: (文本) => 添加颜色(文本, ANSI_CODES.bold, ANSI_CODES.cyan),
    小标题: (文本) => 添加颜色(文本, ANSI_CODES.bold, ANSI_CODES.yellow),
    正文: (文本) => 添加颜色(文本, ANSI_CODES.white),
    成功: (文本) => 添加颜色(文本, ANSI_CODES.green),
    提醒: (文本) => 添加颜色(文本, ANSI_CODES.yellow),
    失败: (文本) => 添加颜色(文本, ANSI_CODES.red),
    弱化: (文本) => 添加颜色(文本, ANSI_CODES.gray),
    强调: (文本) => 添加颜色(文本, ANSI_CODES.cyan),
    链接: (文本) => 添加颜色(文本, ANSI_CODES.blue),
    标签: (文本) => 添加颜色(文本, ANSI_CODES.magenta),
  };
}

function 创建命令行终端({
  outputStream = process.stdout,
  output = (...messages) => console.log(...messages),
  clearScreen = null,
} = {}) {
  const 主题 = 创建命令行主题(outputStream);

  function 清屏() {
    if (typeof clearScreen === "function") {
      clearScreen();
      return;
    }
    if (outputStream?.isTTY) outputStream.write(`${ANSI_CODES.clear}${ANSI_CODES.home}`);
  }

  function 输出标题(标题, 副标题 = "") {
    output(主题.标题(标题));
    output(主题.弱化(CLI_DIVIDER));
    if (副标题) output(主题.弱化(副标题));
  }

  async function 暂停(命令行提问器, 提示文字 = "按回车返回首页……") {
    await 命令行提问器.询问(`\n${主题.弱化(提示文字)}`);
  }

  return {
    outputStream,
    output,
    主题,
    分隔线: CLI_DIVIDER,
    清屏,
    输出标题,
    暂停,
  };
}

module.exports = {
  ANSI_CODES,
  CLI_DIVIDER,
  创建命令行主题,
  创建命令行终端,
};
