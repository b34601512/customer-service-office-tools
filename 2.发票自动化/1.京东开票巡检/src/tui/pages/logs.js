// 实时日志页：订阅 logHub 日志总线，支持滚动查看和关键字过滤。
const { 着色 } = require("../共享路径").ansi;
const { 适配宽度 } = require("../共享路径").width;

const 日志行数上限 = 3000;

function 提取日志时间(行) {
  const 匹配结果 = String(行 || "").match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  return 匹配结果 ? 匹配结果[1] : "";
}

function 创建日志页() {
  const 页面 = {
    key: "3",
    title: "日志",
    state: {
      lines: [],
      scrollOffset: 0,
      follow: true,
      filterActive: false,
      filterBuffer: "",
      filterText: "",
    },
    pushLine(行) {
      this.state.lines.push(String(行 || ""));
      if (this.state.lines.length > 日志行数上限) {
        this.state.lines.splice(0, this.state.lines.length - 日志行数上限);
      }
      if (this.state.follow && !this.state.filterActive) {
        this.state.scrollOffset = 0;
      }
    },
    onEnter() {
      this.state.filterActive = false;
      if (this.state.follow) {
        this.state.scrollOffset = 0;
      }
    },
    获取可见行() {
      const 过滤文字 = this.state.filterText.trim().toLowerCase();
      const 全部行 = this.state.lines;
      return 过滤文字
        ? 全部行.filter((行) => String(行).toLowerCase().includes(过滤文字))
        : 全部行;
    },
    render(app) {
      const 列数 = app.columns;
      const 内容高度 = app.contentHeight;
      const 可见行 = this.获取可见行();

      if (this.state.follow) {
        this.state.scrollOffset = 0;
      }
      const 最大偏移 = Math.max(0, 可见行.length - 内容高度);
      if (this.state.scrollOffset > 最大偏移) {
        this.state.scrollOffset = 最大偏移;
      }

      const 行列表 = [];
      const 过滤文字 = this.state.filterText.trim();
      行列表.push(着色(
        适配宽度(`日志（${可见行.length} 条${过滤文字 ? `，过滤“${过滤文字}”` : ""}${this.state.follow ? "，跟随最新" : ""}）`, 列数),
        "brightBlue"
      ));

      if (可见行.length === 0) {
        行列表.push(着色("暂无日志。启动巡检后，执行过程会实时显示在这里。", "gray"));
        return 行列表;
      }

      const 起始索引 = Math.max(0, 可见行.length - this.state.scrollOffset - 内容高度);
      const 结束索引 = 可见行.length - this.state.scrollOffset;
      for (let 索引 = 起始索引; 索引 < 结束索引; 索引 += 1) {
        const 原始行 = 可见行[索引] || "";
        const 时间文本 = 提取日志时间(原始行);
        const 时间宽度 = 时间文本 ? 时间文本.length + 1 : 0;
        const 正文 = 时间文本 ? 原始行.slice(时间文本.length + 1) : 原始行;
        const 彩色正文 = 正文.includes("主线:失败")
          ? 着色(适配宽度(正文, 列数 - 时间宽度), "brightRed")
          : 正文.includes("主线:提醒")
            ? 着色(适配宽度(正文, 列数 - 时间宽度), "brightYellow")
            : 适配宽度(正文, 列数 - 时间宽度);
        行列表.push(`${时间文本 ? 适配宽度(时间文本, 时间宽度) : ""}${彩色正文}`);
      }
      return 行列表;
    },
    footer() {
      const 过滤提示 = this.state.filterActive ? "输入过滤关键字，回车应用，Esc 取消" : "↑↓滚动 PgUp/PgDn翻页 /过滤 f跟随/停止 r清屏 ←→切页 q返回总览";
      return 过滤提示;
    },
    handleKey(按键, app) {
      if (this.state.filterActive) {
        if (按键 === "enter") {
          this.state.filterText = this.state.filterBuffer;
          this.state.filterActive = false;
          this.state.follow = true;
          this.state.scrollOffset = 0;
          return true;
        }
        if (按键 === "esc") {
          this.state.filterActive = false;
          this.state.filterBuffer = "";
          return true;
        }
        if (按键 === "backspace") {
          this.state.filterBuffer = this.state.filterBuffer.slice(0, -1);
          return true;
        }
        if (typeof 按键 === "string" && 按键.length === 1 && 按键 >= " " && 按键 !== "\x7f") {
          this.state.filterBuffer += 按键;
          return true;
        }
        return true;
      }

      const 可见行 = this.获取可见行();
      const 内容高度 = app.contentHeight;
      const 最大偏移 = Math.max(0, 可见行.length - 内容高度);

      if (按键 === "/") {
        this.state.filterActive = true;
        this.state.filterBuffer = "";
        return true;
      }
      if (按键 === "f") {
        this.state.follow = !this.state.follow;
        if (this.state.follow) {
          this.state.scrollOffset = 0;
        }
        return true;
      }
      if (按键 === "r") {
        this.state.lines = [];
        return true;
      }
      if (按键 === "up") {
        this.state.follow = false;
        this.state.scrollOffset = Math.min(最大偏移, this.state.scrollOffset + 1);
        return true;
      }
      if (按键 === "down") {
        this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 1);
        if (this.state.scrollOffset === 0) {
          this.state.follow = true;
        }
        return true;
      }
      if (按键 === "pgup") {
        this.state.follow = false;
        this.state.scrollOffset = Math.min(最大偏移, this.state.scrollOffset + 内容高度);
        return true;
      }
      if (按键 === "pgdn") {
        this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 内容高度);
        if (this.state.scrollOffset === 0) {
          this.state.follow = true;
        }
        return true;
      }
      if (按键 === "home") {
        this.state.follow = false;
        this.state.scrollOffset = 最大偏移;
        return true;
      }
      if (按键 === "end") {
        this.state.scrollOffset = 0;
        this.state.follow = true;
        return true;
      }
      return false;
    },
  };

  return 页面;
}

module.exports = {
  创建日志页,
  提取日志时间,
};
