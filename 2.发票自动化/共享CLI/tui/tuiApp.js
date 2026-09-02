// TUI 核心框架：备用屏幕、原始按键模式、帧渲染调度、全局按键分发。
// 页面只负责提供“内容行数组”和“按键处理”，不直接触碰终端底层。
const { ANSI代码, 移动光标到, 清空当前行, 着色 } = require("./ansi");
const { 适配宽度, 右侧补齐 } = require("./width");
const { 格式化时钟 } = require("./format");

function 解析转义键(缓冲内容) {
  // 把常见终端转义序列收敛成统一的按键名，未知序列直接丢弃避免误触。
  if (缓冲内容 === "\x1b") {
    return null;
  }
  if (缓冲内容 === "\x1b[A" || 缓冲内容 === "\x1bOA") {
    return "up";
  }
  if (缓冲内容 === "\x1b[B" || 缓冲内容 === "\x1bOB") {
    return "down";
  }
  if (缓冲内容 === "\x1b[C" || 缓冲内容 === "\x1bOC") {
    return "right";
  }
  if (缓冲内容 === "\x1b[D" || 缓冲内容 === "\x1bOD") {
    return "left";
  }
  if (缓冲内容 === "\x1b[H" || 缓冲内容 === "\x1b[F" || 缓冲内容 === "\x1b[1~" || 缓冲内容 === "\x1b[4~") {
    return 缓冲内容 === "\x1b[1~" || 缓冲内容 === "\x1b[H" ? "home" : "end";
  }
  if (缓冲内容 === "\x1b[5~") {
    return "pgup";
  }
  if (缓冲内容 === "\x1b[6~") {
    return "pgdn";
  }
  if (缓冲内容 === "\x1b[3~") {
    return "delete";
  }
  if (缓冲内容 === "\x1b[Z") {
    return "tab-back";
  }
  if (/^\x1b\[\d+(;\d+)*[A-Za-z~]$/.test(缓冲内容)) {
    return "unknown";
  }
  if (缓冲内容.length > 12) {
    return "unknown";
  }
  return null;
}

function 翻译按键字符(字符) {
  if (字符 === "\r" || 字符 === "\n") {
    return "enter";
  }
  if (字符 === "\x03") {
    return "ctrl-c";
  }
  if (字符 === "\x7f" || 字符 === "\x08") {
    return "backspace";
  }
  if (字符 === "\t") {
    return "tab";
  }
  if (字符 === "\x00") {
    return null;
  }
  return 字符;
}

class TUI应用 {
  constructor(选项 = {}) {
    this.title = 选项.title || "发票自动化";
    this.pages = 选项.pages || [];
    this.currentPageIndex = 0;
    this.statusBarProvider = 选项.statusBarProvider || (() => []);
    this.footerProvider = 选项.footerProvider || (() => "");
    this.onExitRequest = 选项.onExitRequest || (() => {});
    this.onGlobalKey = 选项.onGlobalKey || null;
    this.running = false;
    this.terminalStarted = false;
    this.renderQueued = false;
    this.escapeBuffer = "";
    this.escapeTimer = null;
    // 输出流可注入（测试用 mock），默认写真实终端。
    this.output = 选项.output || process.stdout;
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

  get contentHeight() {
    // 帧布局固定为：标题 1 + 状态 2 + 菜单 1 + 分隔 1 + 联系方式 1 + 版权 1 + 页脚 1 + 底边 1 = 9 行。
    return Math.max(4, this.rows - 9);
  }

  // 差分渲染的上一帧行缓存；行数变化（终端缩放）时触发整屏重绘。
  lastFrameLines = null;

  切换页面(索引) {
    const 目标 = Number(索引);
    if (Number.isInteger(目标) && 目标 >= 0 && 目标 < this.pages.length) {
      this.currentPageIndex = 目标;
      if (typeof this.page.onEnter === "function") {
        this.page.onEnter(this);
      }
      this.requestRender();
    }
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
    this.terminalStarted = true;
    this.lastFrameLines = null;
    // 进入备用屏幕并禁用自动换行：任何一行恰好写满列宽都不会被终端折行，避免画面上下跳动。
    this.output.write(
      ANSI代码.enterAltScreen + ANSI代码.clearScreen + ANSI代码.hideCursor + "\x1b[?7l"
    );
    process.stdin.on("data", (数据块) => this.消费输入(数据块));
    this.resizeHandler = () => this.requestRender();
    this.output.on("resize", this.resizeHandler);
    if (typeof this.page?.onEnter === "function") {
      this.page.onEnter(this);
    }
    this.requestRender();
  }

  stop() {
    if (!this.terminalStarted) {
      return;
    }
    this.running = false;
    if (this.escapeTimer) {
      clearTimeout(this.escapeTimer);
      this.escapeTimer = null;
    }
    this.escapeBuffer = "";
    process.stdin.removeAllListeners("data");
    if (typeof this.output.removeListener === "function" && this.resizeHandler) {
      this.output.removeListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    this.output.write(
      ANSI代码.reset + "\x1b[?7h" + ANSI代码.showCursor + ANSI代码.leaveAltScreen
    );
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    this.terminalStarted = false;
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

  消费输入(数据块) {
    const 文本 = 数据块.toString("utf8");
    for (const 字符 of 文本) {
      if (this.escapeBuffer) {
        if (this.escapeTimer) {
          clearTimeout(this.escapeTimer);
          this.escapeTimer = null;
        }
        this.escapeBuffer += 字符;
        const 解析结果 = 解析转义键(this.escapeBuffer);
        if (解析结果) {
          this.escapeBuffer = "";
          this.分发按键(解析结果);
        } else if (解析结果 === null && this.escapeBuffer.length > 12) {
          this.escapeBuffer = "";
        }
        continue;
      }
      if (字符 === "\x1b") {
        this.escapeBuffer = "\x1b";
        // 单独按 Esc 不会再收到后续字符；给方向键序列留出极短拼接窗口后，将其识别为 esc。
        this.escapeTimer = setTimeout(() => {
          if (this.escapeBuffer === "\x1b") {
            this.escapeBuffer = "";
            this.escapeTimer = null;
            this.分发按键("esc");
          }
        }, 30);
        continue;
      }
      const 按键 = 翻译按键字符(字符);
      if (按键) {
        this.分发按键(按键);
      }
    }
  }

  分发按键(按键) {
    if (!按键 || 按键 === "unknown") {
      return;
    }

    if (按键 === "ctrl-c") {
      this.onExitRequest();
      return true;
    }

    if (this.page && typeof this.page.handleKey === "function") {
      if (this.page.handleKey(按键, this) === true) {
        this.requestRender();
        return true;
      }
    }

    if (typeof this.onGlobalKey === "function" && this.onGlobalKey(按键, this) === true) {
      this.requestRender();
      return true;
    }

    // 左右键在主菜单循环切页：页面内部已消费的按键不会走到这里。
    if (按键 === "left" || 按键 === "right") {
      const 方向 = 按键 === "right" ? 1 : -1;
      this.切换页面((this.currentPageIndex + 方向 + this.pages.length) % this.pages.length);
      return true;
    }

    const 数字按键 = Number(按键);
    if (Number.isInteger(数字按键) && 数字按键 >= 1 && 数字按键 <= this.pages.length) {
      this.切换页面(数字按键 - 1);
      return true;
    }

    if (按键 === "q") {
      this.切换页面(0);
      return true;
    }

    return false;
  }

  构建帧() {
    const 列数 = this.columns;
    const 行数 = this.rows;
    const 内容高度 = this.contentHeight;
    const 时钟 = 格式化时钟();
    const 页面标题 = this.page ? `${this.page.key}.${this.page.title}` : "";

    const 行列表 = [];

    // 标题栏：左侧标题 + 右侧完整时钟（时钟固定 19 字符）。
    const 标题栏 = ` ${this.title}  ${页面标题 ? `│ ${页面标题}` : ""}`;
    行列表.push(
      着色(适配宽度(标题栏, 列数 - 21), "brightCyan") +
        着色(适配宽度(` ${时钟}`, 21), "gray")
    );
    // 状态栏：固定输出两行，保证内容区高度不变。
    const 状态行列表 = this.statusBarProvider(this) || [];
    for (let 索引 = 0; 索引 < 2; 索引 += 1) {
      行列表.push(状态行列表[索引] === undefined ? "" : 状态行列表[索引]);
    }
    // 菜单栏
    行列表.push(this.构建菜单栏(列数));
    // 分隔线
    行列表.push(着色("─".repeat(列数), "gray"));

    // 内容区
    let 内容行列表 = [];
    if (this.page && typeof this.page.render === "function") {
      内容行列表 = this.page.render(this) || [];
    }

    for (let 索引 = 0; 索引 < 内容高度; 索引 += 1) {
      const 内容行 = 内容行列表[索引];
      // 页面内容按电话分析项目的约定不做二次截断：表格列已经在页面层完成统一布局，
      // 这里再次截断会把最后一列切掉，甚至让用户误以为字段没有对齐。
      行列表.push(内容行 === undefined ? 右侧补齐("", 列数) : 右侧补齐(内容行, 列数));
    }

    // 作者与版权信息：放在公共外框中，所有页面统一显示。
    行列表.push(着色(适配宽度("作者：黎路遥 ｜ 微信：luyao2089 ｜ 官网：luyao2089.cc", 列数), "gray"));
    行列表.push(着色(适配宽度("版权所有 © 黎路遥，保留所有权利", 列数), "gray"));

    // 页脚
    let 页脚文本 = "";
    if (this.page && typeof this.page.footer === "function") {
      页脚文本 = this.page.footer(this) || "";
    }
    const 页脚 = 页脚文本 || "↑↓选择 回车执行 ←→切页 数字键切页 q返回总览 Ctrl+C退出";
    行列表.push(着色(适配宽度(页脚, 列数), "gray"));
    行列表.push("─".repeat(列数));

    return 行列表;
  }

  构建菜单栏(列数) {
    const 片段列表 = this.pages.map((页面对象, 索引) => {
      const 是否当前页 = 索引 === this.currentPageIndex;
      const 标签 = `${索引 + 1}${页面对象.title}`;
      const 单元格 = ` ${标签} `;
      return 是否当前页 ? 着色(单元格, "reverse") : 着色(单元格, "brightBlue");
    });
    return 适配宽度(片段列表.join(""), 列数);
  }

  render() {
    if (!this.running) {
      return;
    }
    const 帧行列表 = this.构建帧();
    const 列数 = this.columns;
    const 行列表 = 帧行列表.map((行) => 右侧补齐(行, 列数));

    // 首帧或行数变化（终端缩放）时整屏重绘；否则只重绘变化的行，避免每秒整屏闪烁。
    const 需要整屏重绘 = !this.lastFrameLines || this.lastFrameLines.length !== 行列表.length;

    let 输出 = "";
    if (需要整屏重绘) {
      输出 += ANSI代码.cursorHome + 行列表.join("\r\n");
    } else {
      const 变化列表 = [];
      for (let 索引 = 0; 索引 < 行列表.length; 索引 += 1) {
        if (行列表[索引] !== (this.lastFrameLines[索引] || "")) {
          变化列表.push(移动光标到(索引 + 1, 1) + ANSI代码.reset + 清空当前行() + 行列表[索引]);
        }
      }
      if (变化列表.length > 0) {
        输出 += 变化列表.join("");
      }
    }

    this.lastFrameLines = 行列表;
    if (!输出) {
      return;
    }
    this.output.write(输出);
  }
}

module.exports = {
  TUI应用,
  解析转义键,
  翻译按键字符,
};
