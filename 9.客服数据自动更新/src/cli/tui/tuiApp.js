// TUI 核心框架：备用屏幕、原始按键模式、帧渲染调度、全局按键分发、文本输入/确认弹窗。
// 页面只负责提供“内容行数组”和“按键处理”，不直接触碰终端底层。
// 移植自“客服超时督办”项目 TUI，并扩展了模态输入框供配置编辑使用。
const ansi = require("./ansi");
const { fit } = require("./width");
const { formatClock } = require("./format");

const ESCAPE_RESOLVE_TIMEOUT_MS = 40;

function resolveEscapeKey(buffer) {
  // 这里把常见终端转义序列收敛成统一的按键名，未知序列直接丢弃避免误触。
  if (buffer === "\x1b") {
    return null;
  }
  if (buffer === "\x1b[A" || buffer === "\x1bOA") {
    return "up";
  }
  if (buffer === "\x1b[B" || buffer === "\x1bOB") {
    return "down";
  }
  if (buffer === "\x1b[C" || buffer === "\x1bOC") {
    return "right";
  }
  if (buffer === "\x1b[D" || buffer === "\x1bOD") {
    return "left";
  }
  if (buffer === "\x1b[H" || buffer === "\x1b[F" || buffer === "\x1b[1~" || buffer === "\x1b[4~") {
    return buffer === "\x1b[1~" || buffer === "\x1b[H" ? "home" : "end";
  }
  if (buffer === "\x1b[5~") {
    return "pgup";
  }
  if (buffer === "\x1b[6~") {
    return "pgdn";
  }
  if (buffer === "\x1b[3~") {
    return "delete";
  }
  if (buffer === "\x1b[Z") {
    return "tab-back";
  }
  if (/^\x1b\[\d+(;\d+)*[A-Za-z~]$/.test(buffer)) {
    return "unknown";
  }
  if (buffer.length > 12) {
    return "unknown";
  }
  return null;
}

function translateChar(char) {
  if (char === "\r" || char === "\n") {
    return "enter";
  }
  if (char === "\x03") {
    return "ctrl-c";
  }
  if (char === "\x7f" || char === "\x08") {
    return "backspace";
  }
  if (char === "\t") {
    return "tab";
  }
  if (char === "\x00") {
    return null;
  }
  return char;
}

class TuiApp {
  constructor(options = {}) {
    this.title = options.title || "客服数据自动更新";
    this.pages = options.pages || [];
    this.currentPageIndex = 0;
    this.statusBarProvider = options.statusBarProvider || (() => []);
    this.footerProvider = options.footerProvider || (() => "");
    this.onExitRequest = options.onExitRequest || (() => {});
    this.onGlobalKey = options.onGlobalKey || null;
    this.exitConfirmPending = false;
    this.running = false;
    this.renderQueued = false;
    this.escapeBuffer = "";
    this.escapeTimer = null;
    this.inputModal = null; // { mode: "input" | "confirm", title, buffer, secret, resolve }
    this.output = options.output || process.stdout;
  }

  get page() {
    return this.pages[this.currentPageIndex] || null;
  }

  get columns() {
    return Math.max(48, this.output.columns || process.stdout.columns || 80);
  }

  get rows() {
    return Math.max(14, this.output.rows || process.stdout.rows || 24);
  }

  // 帧布局固定为：标题 1 + 状态 2 + 菜单 1 + 分隔 1 + 联系方式 1 + 版权 1 + 页脚 1 + 底边 1 = 9 行。
  get contentHeight() {
    return Math.max(4, this.rows - 9);
  }

  lastFrameLines = null;

  switchPage(index) {
    const target = Number(index);
    if (Number.isInteger(target) && target >= 0 && target < this.pages.length) {
      this.currentPageIndex = target;
      if (typeof this.page.onEnter === "function") {
        this.page.onEnter(this);
      }
      this.requestRender();
    }
  }

  // 模态文本输入：返回 Promise，回车确认（字符串），Esc 取消（null）。
  requestInput({ title, defaultValue = "", secret = false } = {}) {
    return new Promise((resolve) => {
      this.inputModal = {
        mode: "input",
        title: String(title || "请输入"),
        buffer: String(defaultValue ?? ""),
        secret: Boolean(secret),
        resolve
      };
      this.requestRender();
    });
  }

  // 模态确认框：返回 Promise<boolean>。
  requestConfirm(title) {
    return new Promise((resolve) => {
      this.inputModal = {
        mode: "confirm",
        title: String(title || "确认执行？"),
        buffer: "",
        secret: false,
        resolve
      };
      this.requestRender();
    });
  }

  settleInputModal(value) {
    const modal = this.inputModal;
    this.inputModal = null;
    if (modal) {
      modal.resolve(value);
    }
    this.requestRender();
  }

  start() {
    if (this.running) {
      return;
    }
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    this.running = true;
    this.lastFrameLines = null;
    // 进入备用屏幕并禁用自动换行：任何一行恰好写满列宽都不会被终端折行。
    this.output.write(
      ansi.codes.enterAltScreen + ansi.codes.clearScreen + ansi.codes.hideCursor + "\x1b[?7l"
    );
    process.stdin.on("data", (chunk) => this.consumeInput(chunk));
    this.resizeHandler = () => this.requestRender();
    this.output.on("resize", this.resizeHandler);
    if (typeof this.page?.onEnter === "function") {
      this.page.onEnter(this);
    }
    this.requestRender();
  }

  stop() {
    if (!this.running) {
      return;
    }
    this.running = false;
    process.stdin.removeAllListeners("data");
    if (typeof this.output.removeListener === "function" && this.resizeHandler) {
      this.output.removeListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    this.output.write(
      ansi.codes.reset + "\x1b[?7h" + ansi.codes.showCursor + ansi.codes.leaveAltScreen
    );
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  requestRender() {
    if (this.renderQueued || !this.running) {
      return;
    }
    this.renderQueued = true;
    setImmediate(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  flushEscapeBuffer() {
    // 单独按下 Esc 时，终端不会立即送出后续字符；等一小段时间仍无后续就按 Esc 处理。
    if (!this.escapeBuffer) {
      return;
    }
    const buffered = this.escapeBuffer;
    this.escapeBuffer = "";
    const resolvedKey = resolveEscapeKey(buffered);
    if (resolvedKey === null && buffered === "\x1b") {
      this.dispatchKey("esc");
    } else if (resolvedKey) {
      this.dispatchKey(resolvedKey);
    }
  }

  consumeInput(chunk) {
    const text = chunk.toString("utf8");
    for (const char of text) {
      if (this.escapeBuffer) {
        this.escapeBuffer += char;
        const resolvedKey = resolveEscapeKey(this.escapeBuffer);
        if (resolvedKey) {
          this.escapeBuffer = "";
          if (this.escapeTimer) {
            clearTimeout(this.escapeTimer);
            this.escapeTimer = null;
          }
          this.dispatchKey(resolvedKey);
        } else if (this.escapeBuffer.length > 12) {
          this.escapeBuffer = "";
        }
        continue;
      }
      if (char === "\x1b") {
        this.escapeBuffer = "\x1b";
        if (this.escapeTimer) {
          clearTimeout(this.escapeTimer);
        }
        this.escapeTimer = setTimeout(() => {
          this.escapeTimer = null;
          this.flushEscapeBuffer();
        }, ESCAPE_RESOLVE_TIMEOUT_MS);
        continue;
      }
      const key = translateChar(char);
      if (key) {
        this.dispatchKey(key);
      }
    }
  }

  dispatchKey(key) {
    if (!key || key === "unknown") {
      return;
    }

    // 模态输入/确认框打开时优先消费按键。
    if (this.inputModal) {
      this.handleModalKey(key);
      return;
    }

    if (this.exitConfirmPending) {
      if (key === "y" || key === "Y" || key === "enter") {
        this.exitConfirmPending = false;
        this.onExitRequest();
      } else if (key === "n" || key === "N" || key === "esc" || key === "ctrl-c") {
        this.exitConfirmPending = false;
        this.requestRender();
      }
      return;
    }

    if (key === "ctrl-c") {
      this.exitConfirmPending = true;
      this.requestRender();
      return;
    }

    if (key === "0") {
      this.onExitRequest();
      return;
    }

    if (this.page && typeof this.page.handleKey === "function") {
      if (this.page.handleKey(key, this) === true) {
        this.requestRender();
        return;
      }
    }

    if (typeof this.onGlobalKey === "function" && this.onGlobalKey(key, this) === true) {
      this.requestRender();
      return;
    }

    // 左右键在主菜单循环切页：页面内部已消费的不会走到这里。
    if (key === "left" || key === "right") {
      const direction = key === "right" ? 1 : -1;
      this.switchPage((this.currentPageIndex + direction + this.pages.length) % this.pages.length);
      return;
    }

    const numberKey = Number(key);
    if (Number.isInteger(numberKey) && numberKey >= 1 && numberKey <= this.pages.length) {
      this.switchPage(numberKey - 1);
      return;
    }

    if (key === "q") {
      this.switchPage(0);
    }
  }

  handleModalKey(key) {
    const modal = this.inputModal;
    if (modal.mode === "confirm") {
      if (key === "y" || key === "Y" || key === "enter") {
        this.settleInputModal(true);
      } else if (key === "n" || key === "N" || key === "esc" || key === "ctrl-c") {
        this.settleInputModal(false);
      }
      return;
    }
    if (key === "enter") {
      this.settleInputModal(modal.buffer);
      return;
    }
    if (key === "esc" || key === "ctrl-c") {
      this.settleInputModal(null);
      return;
    }
    if (key === "backspace") {
      modal.buffer = modal.buffer.slice(0, -1);
      this.requestRender();
      return;
    }
    if (typeof key === "string" && key.length === 1) {
      modal.buffer += key;
      this.requestRender();
    }
  }

  buildFrame() {
    const columns = this.columns;
    const contentHeight = this.contentHeight;
    const clock = formatClock();
    const pageTitle = this.page ? `${this.page.key}.${this.page.title}` : "";

    const lines = [];

    // 标题栏：左侧标题 + 右侧完整时钟。
    const titleBar = ` ${this.title}  ${pageTitle ? `│ ${pageTitle}` : ""}`;
    lines.push(
      ansi.colorize(fit(titleBar, columns - 21), "brightCyan") +
        ansi.colorize(fit(` ${clock}`, 21), "gray")
    );
    // 状态栏：固定输出两行，保证内容区高度不变。
    const statusLines = this.statusBarProvider(this) || [];
    for (let index = 0; index < 2; index += 1) {
      lines.push(statusLines[index] === undefined ? "" : statusLines[index]);
    }
    // 菜单栏
    lines.push(this.buildMenuBar(columns));
    // 分隔线
    lines.push(ansi.colorize("─".repeat(columns), "gray"));

    // 内容区
    let contentLines = [];
    if (this.page && typeof this.page.render === "function") {
      contentLines = this.page.render(this) || [];
    }
    if (this.inputModal) {
      contentLines = this.buildInputOverlay(contentLines, columns, contentHeight);
    } else if (this.exitConfirmPending) {
      contentLines = this.buildExitConfirmOverlay(contentLines, columns, contentHeight);
    }

    for (let index = 0; index < contentHeight; index += 1) {
      const contentLine = contentLines[index];
      // 内容页负责按表格列宽组织文本；保留完整行，避免公共渲染层再次截断造成列错位。
      lines.push(contentLine === undefined ? fit("", columns) : fit(contentLine, columns, false));
    }

    // 作者与版权信息：放在公共外框中，所有页面统一显示。
    lines.push(ansi.colorize(fit("作者：黎路遥 ｜ 微信：luyao2089 ｜ 官网：luyao2089.cc", columns), "gray"));
    lines.push(ansi.colorize(fit("版权所有 © 黎路遥，保留所有权利", columns), "gray"));

    // 页脚
    let footerText = "";
    if (this.inputModal) {
      footerText = this.inputModal.mode === "confirm"
        ? "y/回车 确认    n/Esc 取消"
        : "输入内容后回车确认    Esc 取消";
    } else if (this.page && typeof this.page.footer === "function") {
      footerText = this.page.footer(this) || "";
    }
    const footer = footerText || "↑↓选择 回车执行 ←→/数字键切页 q返回总览 0退出 Ctrl+C确认退出";
    lines.push(ansi.colorize(fit(footer, columns), "gray"));
    lines.push("─".repeat(columns));

    return lines;
  }

  buildMenuBar(columns) {
    const segments = this.pages.map((pageItem, index) => {
      const isCurrent = index === this.currentPageIndex;
      const label = `${index + 1}${pageItem.title}`;
      const cell = ` ${label} `;
      return isCurrent ? ansi.colorize(cell, "reverse") : ansi.colorize(cell, "brightBlue");
    });
    return fit(segments.join(""), columns);
  }

  buildInputOverlay(contentLines, columns, contentHeight) {
    const modal = this.inputModal;
    const overlayLines = contentLines.slice(0, Math.max(0, contentHeight - 3));
    const shownBuffer = modal.secret ? "*".repeat(modal.buffer.length) : modal.buffer;
    const promptLine = modal.mode === "confirm"
      ? ` ${modal.title} (y=确认 n=取消)`
      : ` ${modal.title}：${shownBuffer}▏`;
    overlayLines.push(ansi.colorize(fit("─".repeat(Math.min(columns, 64)), columns), "yellow"));
    overlayLines.push(ansi.colorize(fit(promptLine, columns), "brightYellow"));
    return overlayLines;
  }

  buildExitConfirmOverlay(contentLines, columns, contentHeight) {
    const question = "确认退出控制台？(y=退出 n=取消)";
    const overlayLines = contentLines.slice(0, Math.max(0, contentHeight - 3));
    overlayLines.push("");
    overlayLines.push(ansi.colorize(fit("─".repeat(Math.min(columns, 56)), columns), "yellow"));
    overlayLines.push(ansi.colorize(fit(` ${question}`, columns), "brightYellow"));
    return overlayLines;
  }

  render() {
    if (!this.running) {
      return;
    }
    const frameLines = this.buildFrame();
    const columns = this.columns;
    const lines = frameLines.map((line) => fit(line, columns, false));

    // 首帧或行数变化（终端缩放）时整屏重绘；否则只重绘变化的行，避免闪烁。
    const needFullRedraw = !this.lastFrameLines || this.lastFrameLines.length !== lines.length;

    let output = "";
    if (needFullRedraw) {
      output += ansi.codes.cursorHome + lines.join("\r\n");
    } else {
      const changes = [];
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index] !== (this.lastFrameLines[index] || "")) {
          changes.push(ansi.moveTo(index + 1, 1) + ansi.codes.reset + ansi.clearLine() + lines[index]);
        }
      }
      if (changes.length > 0) {
        output += changes.join("");
      }
    }

    this.lastFrameLines = lines;
    if (!output) {
      return;
    }
    this.output.write(output);
  }
}

module.exports = {
  TuiApp,
  resolveEscapeKey,
  translateChar
};
