// TUI 备用屏幕下把业务 console 输出重定向进日志页，避免污染画面；退出时必须恢复原方法。
// 同时设置 CLI 日志隔离标记，让带“原地刷新”的 logger 强制走 console 通道被统一捕获。
const { format: 格式化输出参数 } = require("node:util");

const CLI日志隔离标记 = Symbol.for("invoice-automation.cli-log-isolation");

function 开始捕获控制台输出(记录函数) {
  const 方法名称列表 = ["log", "info", "warn", "error", "debug"];
  const 原始方法 = {};
  const 原始隔离标记 = globalThis[CLI日志隔离标记];
  globalThis[CLI日志隔离标记] = true;
  for (const 方法名称 of 方法名称列表) {
    原始方法[方法名称] = console[方法名称];
    console[方法名称] = (...消息) => 记录函数(格式化输出参数(...消息));
  }
  return () => {
    for (const 方法名称 of 方法名称列表) console[方法名称] = 原始方法[方法名称];
    if (原始隔离标记 === undefined) delete globalThis[CLI日志隔离标记];
    else globalThis[CLI日志隔离标记] = 原始隔离标记;
  };
}

module.exports = {
  开始捕获控制台输出,
};
