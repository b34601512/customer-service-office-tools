// 本文件只负责"常驻仪表盘菜单"这一层界面（渲染 + 按键状态机 + 每秒重绘），不含任何业务判断。
// 风格对齐 1 号控制台：标题栏 / › 选中 / 反色当前项 / 数字键直达 / 页脚按键提示。
// 关键：备用屏只进一次、每秒**原地重绘**（光标归位 + 逐行清到行尾），所以不会闪回首页，也不会刷屏留痕。
// 业务动作由 dispatch(action) 执行；界面与业务分离（同一套 service 真源）。

const readline = require("readline");

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  reverse: "\x1b[7m",
  home: "\x1b[H",
  clearToEndOfLine: "\x1b[K",
  clearBelow: "\x1b[J",
  enterAltScreen: "\x1b[?1049h",
  leaveAltScreen: "\x1b[?1049l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h"
};

// 把一串终端输入翻译成按键名；认不出来的返回 null（不猜、不误触发）。
function resolveKey(buffer) {
  if (buffer === "\x1b[A" || buffer === "\x1bOA") return "up";
  if (buffer === "\x1b[B" || buffer === "\x1bOB") return "down";
  if (buffer === "\r" || buffer === "\n") return "enter";
  if (buffer === "\x03") return "ctrl-c";
  if (buffer === "\x1b") return "escape";
  if (buffer === "\x1b[5~") return "pgup";
  if (buffer === "\x1b[6~") return "pgdn";
  if (/^[0-9]$/.test(buffer)) return buffer;
  if (/^[a-zA-Z]$/.test(buffer)) return buffer.toLowerCase();
  return null;
}

// items: [{ key: "1", label: "启动常驻监控", action: "run" }]
// statusLines / footerNotes 可以是数组，也可以是函数（每帧现取，用来放会变的状态与血条）。
// handleKey 返回 { action } 表示要执行；返回 null 表示只是移动光标。
function createSelectMenu(options) {
  const items = options.items || [];
  if (items.length === 0) throw new Error("方向键菜单至少要有一个选项。");
  const 每页 = options.pageSize || 12;
  const 宽 = options.width || 60;
  let index = 0;
  let offset = 0;

  function 取行(来源) {
    if (typeof 来源 === "function") return 来源() || [];
    return 来源 || [];
  }

  function 修正窗口() {
    if (index < offset) offset = index;
    if (index >= offset + 每页) offset = index - 每页 + 1;
  }

  function render() {
    修正窗口();
    const 行 = [];
    行.push(`  ${ANSI.bold}${ANSI.cyan}${options.title || ""}${ANSI.reset}`);
    const 状态行 = 取行(options.statusLines);
    if (状态行.length > 0) {
      行.push(`  ${ANSI.gray}${"─".repeat(宽)}${ANSI.reset}`);
      for (const line of 状态行) 行.push(`  ${line}`);
    }
    行.push(`  ${ANSI.gray}${"─".repeat(宽)}${ANSI.reset}`);
    const 可视 = items.slice(offset, offset + 每页);
    可视.forEach((item, 偏移) => {
      const 当前 = offset + 偏移 === index;
      const 文字 = `[${item.key}] ${item.label}`;
      行.push(`  ${当前 ? `${ANSI.reverse}› ${文字} ${ANSI.reset}` : `  ${文字}`}`);
    });
    const 备注 = 取行(options.footerNotes);
    if (备注.length > 0) {
      行.push(`  ${ANSI.gray}${"─".repeat(宽)}${ANSI.reset}`);
      for (const note of 备注) 行.push(`  ${ANSI.gray}${note}${ANSI.reset}`);
    }
    行.push(`  ${ANSI.gray}↑↓ 选择　数字键直达　回车执行　q/Esc 退出　Ctrl+C 退出${ANSI.reset}`);
    return 行;
  }

  function handleKey(key) {
    if (key === "up") {
      index = (index - 1 + items.length) % items.length;
      return null;
    }
    if (key === "down") {
      index = (index + 1) % items.length;
      return null;
    }
    if (key === "pgup") {
      index = Math.max(0, index - 每页);
      return null;
    }
    if (key === "pgdn") {
      index = Math.min(items.length - 1, index + 每页);
      return null;
    }
    if (key === "enter") return { action: items[index].action };
    if (key === "escape" || key === "q") return { action: "quit" };
    const 命中 = items.find((item) => String(item.key).toLowerCase() === String(key).toLowerCase());
    if (!命中) return null;
    index = items.indexOf(命中);
    return { action: 命中.action };
  }

  return {
    render,
    handleKey,
    get index() {
      return index;
    }
  };
}

// 常驻界面：返回用户最终选择（"quit"）；stdin 不是终端时返回 null，由调用方回退到输入式菜单。
// 只认 stdin（stdout 被重定向也照样跑）：这样能用真控制台跑并抓帧做验收，stdout 同时被管道/脚本接管也不影响键位。
// dispatch(action, io) 里可以 await（比如巡检一轮）；期间界面显示"正在执行"，按键忽略，血条照常走。
// io.ask(问题) / io.showText(文本)：临时离开界面去做交互（登录、看状态），回来自动接着画。
function runLiveMenu(options) {
  const stdin = options.stdin || process.stdin;
  const stdout = options.stdout || process.stdout;
  if (!stdin.isTTY) return Promise.resolve(null);

  let busy = false;
  let 挂起中 = false;
  let 上次文本 = null;
  const 每帧毫秒 = options.tickMs || 1000;

  const menu = createSelectMenu({
    ...options,
    statusLines: () => {
      const 行 = typeof options.statusLines === "function" ? options.statusLines() || [] : options.statusLines || [];
      return busy ? [...行, `${ANSI.gray}⏳ 正在执行上一步操作…${ANSI.reset}`] : 行;
    }
  });

  const 重画 = (强制 = false) => {
    if (挂起中) return;
    const 行 = menu.render();
    const 文本 = 行.join("\n");
    if (!强制 && 文本 === 上次文本) return;
    上次文本 = 文本;
    // 光标归位 + 逐行清到行尾 + 清掉下面多余的行：原地重绘，不清屏所以不闪。
    stdout.write(ANSI.home + 行.map((line) => line + ANSI.clearToEndOfLine).join("\n") + "\n" + ANSI.clearBelow);
  };

  return new Promise((resolve) => {
    const 定时器 = setInterval(() => 重画(), 每帧毫秒);

    const 收尾 = (结果) => {
      clearInterval(定时器);
      stdin.removeListener("data", onData);
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(false);
      stdin.pause();
      stdout.write(ANSI.leaveAltScreen + ANSI.showCursor);
      resolve(结果);
    };

    const 挂起 = () => {
      挂起中 = true;
      stdin.removeListener("data", onData);
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(false);
      stdin.pause();
      stdout.write(ANSI.leaveAltScreen + ANSI.showCursor);
    };
    const 恢复 = () => {
      if (挂起中 === false && 上次文本 !== null) return;
      挂起中 = false;
      上次文本 = null;
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
      stdout.write(ANSI.enterAltScreen + ANSI.hideCursor);
      重画(true);
    };

    const 问一次 = (问题) =>
      new Promise((完成) => {
        const rl = readline.createInterface({ input: stdin, output: stdout });
        rl.question(问题, (答案) => {
          rl.close();
          完成(答案);
        });
      });

    const 带挂起 = async (任务) => {
      挂起();
      try {
        return await 任务();
      } finally {
        恢复();
      }
    };

    const io = {
      ask: (问题) => 带挂起(() => 问一次(问题)),
      showText: (文本) => 带挂起(async () => {
        stdout.write(`${文本}\n`);
        await 问一次("按回车返回菜单……");
      })
    };

    const onData = (buffer) => {
      const key = resolveKey(buffer.toString("utf8"));
      if (!key || busy) return;
      if (key === "ctrl-c") {
        收尾("quit");
        return;
      }
      const 结果 = menu.handleKey(key);
      if (!结果) {
        重画();
        return;
      }
      if (结果.action === "quit") {
        收尾("quit");
        return;
      }
      busy = true;
      重画(true);
      Promise.resolve()
        .then(() => options.dispatch(结果.action, io))
        .catch(() => undefined)
        .then((返回) => {
          busy = false;
          if (返回 === "quit") {
            收尾("quit");
            return;
          }
          重画(true);
        });
    };

    stdout.write(ANSI.enterAltScreen + ANSI.hideCursor);
    if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    重画(true);
  });
}

module.exports = { resolveKey, createSelectMenu, runLiveMenu, ANSI };
