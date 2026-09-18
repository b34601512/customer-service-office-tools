// 本文件只负责"方向键选择菜单"这一层界面（渲染 + 按键状态机），不含任何业务判断。
// 风格对齐 1 号控制台：标题栏 / › 选中 / 反色当前项 / 数字键直达 / 页脚按键提示 / 备用屏不污染日志。
// 业务动作由调用方按返回的 action 执行，界面与业务分离（同一套 service 真源）。

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  reverse: "\x1b[7m",
  enterAltScreen: "\x1b[?1049h",
  leaveAltScreen: "\x1b[?1049l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearScreen: "\x1b[2J\x1b[H"
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
// handleKey 返回 { action } 表示要执行；返回 null 表示只是移动光标；"cancelled" 表示用户退出。
function createSelectMenu(options) {
  const items = options.items || [];
  if (items.length === 0) throw new Error("方向键菜单至少要有一个选项。");
  const 每页 = options.pageSize || 12;
  let index = 0;
  let offset = 0;

  function 修正窗口() {
    if (index < offset) offset = index;
    if (index >= offset + 每页) offset = index - 每页 + 1;
  }

  function render() {
    修正窗口();
    const 行 = [];
    行.push(`  ${ANSI.bold}${ANSI.cyan}${options.title || ""}${ANSI.reset}`);
    行.push(`  ${ANSI.dim}${"─".repeat(options.width || 56)}${ANSI.reset}`);
    const 可视 = items.slice(offset, offset + 每页);
    可视.forEach((item, 偏移) => {
      const 当前 = offset + 偏移 === index;
      const 文字 = `[${item.key}] ${item.label}`;
      行.push(`  ${当前 ? `${ANSI.reverse}› ${文字} ${ANSI.reset}` : `  ${文字}`}`);
    });
    if (options.footerNotes && options.footerNotes.length > 0) {
      行.push(`  ${ANSI.dim}${"─".repeat(options.width || 56)}${ANSI.reset}`);
      for (const note of options.footerNotes) 行.push(`  ${ANSI.dim}${note}${ANSI.reset}`);
    }
    行.push(`  ${ANSI.dim}↑↓ 选择　数字键直达　回车执行　q/Esc 退出　Ctrl+C 退出${ANSI.reset}`);
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

// 在真实终端里跑一次选择：返回选中的 action（"quit" = 用户退出）；非交互环境返回 null，由调用方回退到输入式菜单。
function runSelectMenu(options) {
  const stdin = options.stdin || process.stdin;
  const stdout = options.stdout || process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) return Promise.resolve(null);

  return new Promise((resolve) => {
    const menu = createSelectMenu(options);
    const 绘制 = () => stdout.write(ANSI.clearScreen + menu.render().join("\n") + "\n");
    const 收尾 = () => {
      stdin.removeListener("data", onData);
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(false);
      stdin.pause();
      stdout.write(ANSI.leaveAltScreen + ANSI.showCursor);
    };
    const onData = (buffer) => {
      const key = resolveKey(buffer.toString("utf8"));
      if (!key) return;
      if (key === "ctrl-c") {
        收尾();
        resolve("quit");
        return;
      }
      const 结果 = menu.handleKey(key);
      if (结果) {
        收尾();
        resolve(结果.action);
        return;
      }
      绘制();
    };

    stdout.write(ANSI.enterAltScreen + ANSI.hideCursor);
    if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    绘制();
  });
}

module.exports = { resolveKey, createSelectMenu, runSelectMenu, ANSI };
