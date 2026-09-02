// 店铺页：店铺结果镜像表格 + 单店巡检明细表格。
// 表格模式与客服督办“2客户”页保持一致：先读取结果镜像，再按固定列渲染。
const fs = require("fs");
const { 着色 } = require("../共享路径").ansi;
const { 适配宽度 } = require("../共享路径").width;
const { 格式化时间文本 } = require("../共享路径").format;
const { 获取店铺浏览器目录 } = require("../../common/paths");
const { 识别开票明细状态 } = require("../../invoice/invoiceDetailStatus");
const {
  构建表头,
  构建表格行,
} = require("../../../../共享CLI/tui/镜像表格");

function 读取本地登录状态(店铺) {
  const 浏览器目录 = 获取店铺浏览器目录(店铺.id);
  return fs.existsSync(浏览器目录)
    ? { status: "ready", 标签: "已有本地资料" }
    : { status: "missing", 标签: "未发现本地资料" };
}

function 格式化最近结果(结果) {
  if (!结果) {
    return "暂无巡检记录";
  }
  const 文本 = `${格式化时间文本(结果.lastCheckedAt)}｜${结果.lastMessage || 结果.status || "已执行"}`;
  return 文本;
}

function 读取最近结果状态(结果) {
  const 文本 = 格式化最近结果(结果);
  if (!结果) {
    return { 文本, 颜色: "gray" };
  }
  if (结果.status === "success") {
    return { 文本, 颜色: "brightGreen" };
  }
  if (结果.status === "error") {
    return { 文本, 颜色: "brightRed" };
  }
  return { 文本, 颜色: "yellow" };
}

const 店铺表格列定义 = [
  { 标题: "#", 宽度: 4 },
  { 标题: "店铺", 宽度: 14 },
  { 标题: "排查状态", 宽度: 10 },
  { 标题: "告警", 宽度: 5 },
  { 标题: "待登记", 宽度: 7 },
  { 标题: "已上传未逾期", 宽度: 12 },
  { 标题: "明细", 宽度: 5 },
  { 标题: "新增", 宽度: 5 },
  { 标题: "最近结果", 宽度: "flex" },
];

const 记录表格列定义 = [
  { 标题: "#", 宽度: 4 },
  // “待登记即将逾期”共 7 个中文字符，需要 14 个终端显示宽度；避免窄窗口被截断。
  { 标题: "状态", 宽度: 14 },
  { 标题: "新增", 宽度: 5 },
  // “京东政企发票考核”等来源名称需要 16 个终端显示宽度才能完整展示。
  { 标题: "来源", 宽度: 16 },
  { 标题: "摘要", 宽度: "flex" },
];

const 记录状态颜色映射 = {
  已上传未逾期: "brightGreen",
  待登记即将逾期: "brightRed",
  待登记已逾期: "brightRed",
  待登记待确认: "yellow",
  已记录待确认: "gray",
};

const 记录过滤模式 = [
  { label: "需关注", test: (状态) => 状态.需要登记 || 状态.需要预警 },
  { label: "全部", test: () => true },
];

function 构建店铺表格行(索引, 店铺, 结果, 列数) {
  const 指标 = 结果?.metrics || {};
  const 告警 = Number(指标.警告订单数 || 0);
  const 待登记 = Number(指标.待登记明细数 || 0);
  const 已上传未逾期 = Number(指标.已上传未逾期数 || 0);
  const 明细 = Number(指标.明细总数 || 0);
  const 新增 = Array.isArray(结果?.newRecords) ? 结果.newRecords.length : 0;
  const 最近结果 = 读取最近结果状态(结果);
  const 状态文本 = 结果?.status === "success"
    ? "排查完成"
    : (结果?.status === "error" ? "排查失败" : "暂无结果");
  const 状态颜色 = 结果?.status === "success"
    ? "brightGreen"
    : (结果?.status === "error" ? "brightRed" : "gray");
  return 构建表格行(店铺表格列定义, [
    { 文本: String(索引 + 1), 颜色: "gray" },
    { 文本: 店铺.name || "未命名" },
    { 文本: 状态文本, 颜色: 状态颜色 },
    { 文本: String(告警), 颜色: 告警 > 0 ? "brightRed" : "" },
    { 文本: String(待登记), 颜色: 待登记 > 0 ? "brightRed" : "" },
    { 文本: String(已上传未逾期), 颜色: 已上传未逾期 > 0 ? "brightGreen" : "" },
    { 文本: String(明细), 颜色: "gray" },
    { 文本: String(新增), 颜色: 新增 > 0 ? "brightYellow" : "" },
    { 文本: 最近结果.文本, 颜色: 最近结果.颜色 || "" },
  ], 列数);
}

function 构建记录明细行(索引, 记录, 是否新增, 列数) {
  const 状态 = 识别开票明细状态(记录);
  const 来源 = String(记录?.source || 记录?.fields?.来源 || "未知来源");
  const 摘要 = String(记录?.summary || 记录?.fields?.摘要 || "-");
  return 构建表格行(记录表格列定义, [
    { 文本: String(索引 + 1), 颜色: "gray" },
    { 文本: 状态.状态, 颜色: 记录状态颜色映射[状态.状态] || "gray" },
    { 文本: 是否新增 ? "●" : "", 颜色: 是否新增 ? "brightYellow" : "" },
    { 文本: 来源 },
    { 文本: 摘要 },
  ], 列数);
}

function 创建店铺页() {
  const 页面 = {
    key: "2",
    title: "店铺",
    state: {
      selection: 0,
      scrollOffset: 0,
      detailStore: null,
      detailRecords: [],
      detailScroll: 0,
      detailFilterMode: 0,
      detailRecord: null,
      detailRecordScroll: 0,
    },
    onEnter() {
      const 店铺列表 = this.ctx.cache.config?.stores || [];
      this.state.detailStore = null;
      this.state.detailRecord = null;
      if (this.state.selection >= 店铺列表.length) {
        this.state.selection = Math.max(0, 店铺列表.length - 1);
      }
    },
    render(app) {
      const 上下文 = app.ctx;
      const 店铺列表 = Array.isArray(上下文.cache.config?.stores) ? 上下文.cache.config.stores : [];
      const 结果对象 = 上下文.cache.results?.stores || {};
      const 列数 = app.columns;
      const 内容高度 = app.contentHeight;

      if (this.state.detailRecord) {
        return this.render记录详情(app, this.state.detailRecord);
      }
      if (this.state.detailStore) {
        return this.render店铺记录明细(app, this.state.detailStore, 结果对象);
      }

      const 行列表 = [];
      行列表.push(着色(适配宽度(`店铺列表（共 ${店铺列表.length} 家，↑↓选择，回车查看巡检明细）`, 列数), "brightBlue"));
      if (店铺列表.length === 0) {
        行列表.push(着色("当前没有店铺配置。", "gray"));
        return 行列表;
      }

      const 可见店数 = Math.max(1, 内容高度 - 3);
      const 最大偏移 = Math.max(0, 店铺列表.length - 可见店数);
      if (this.state.scrollOffset > 最大偏移) {
        this.state.scrollOffset = 最大偏移;
      }
      行列表.push(构建表头(店铺表格列定义, 列数));
      const 结束索引 = Math.min(店铺列表.length, this.state.scrollOffset + 可见店数);
      for (let 索引 = this.state.scrollOffset; 索引 < 结束索引; 索引 += 1) {
        const 店铺 = 店铺列表[索引];
        const 结果 = 结果对象[店铺.id] || null;
        const 行 = 构建店铺表格行(索引, 店铺, 结果, 列数);
        行列表.push(索引 === this.state.selection ? 着色(适配宽度(行, 列数), "reverse") : 适配宽度(行, 列数));
      }
      if (店铺列表.length > 可见店数) {
        行列表.push(着色(适配宽度(`第 ${this.state.scrollOffset + 1}-${结束索引}/${店铺列表.length} 家｜↑↓ 滚动`, 列数), "gray"));
      }
      return 行列表;
    },
    render店铺记录明细(app, 店铺, 结果对象) {
      const 列数 = app.columns;
      const 内容高度 = app.contentHeight;
      const 结果 = 结果对象[店铺.id] || null;
      const 记录列表 = Array.isArray(结果?.records) ? 结果.records : [];
      const 新增标识集合 = new Set((Array.isArray(结果?.newRecords) ? 结果.newRecords : []).map((记录) => 记录?.id || 记录?.summary));
      const 模式 = 记录过滤模式[this.state.detailFilterMode] || 记录过滤模式[1];
      const 明细列表 = 记录列表
        .map((记录) => ({ 记录, 是否新增: 新增标识集合.has(记录?.id || 记录?.summary), 状态: 识别开票明细状态(记录) }))
        .filter((条目) => 模式.test(条目.状态));
      const 最大偏移 = Math.max(0, 明细列表.length - Math.max(1, 内容高度 - 4));
      if (this.state.detailScroll > 最大偏移) this.state.detailScroll = 最大偏移;
      const 行列表 = [];
      行列表.push(着色(适配宽度(`巡检明细：${店铺.name || "未命名"}`, 列数), "brightCyan"));
      行列表.push(着色(适配宽度(`（过滤:${模式.label}，显示 ${明细列表.length}/${记录列表.length} 条，f 切换）`, 列数), "gray"));
      行列表.push(构建表头(记录表格列定义, 列数));
      if (明细列表.length === 0) {
        行列表.push(着色("该店暂无巡检明细记录。", "gray"));
        return 行列表;
      }
      const 起始索引 = this.state.detailScroll;
      const 结束索引 = Math.min(明细列表.length, 起始索引 + Math.max(1, 内容高度 - 4));
      for (let 索引 = 起始索引; 索引 < 结束索引; 索引 += 1) {
        const 条目 = 明细列表[索引];
        const 行 = 构建记录明细行(索引, 条目.记录, 条目.是否新增, 列数);
        行列表.push(适配宽度(行, 列数));
      }
      return 行列表;
    },
    render记录详情(app, 记录) {
      const 列数 = app.columns;
      const 状态 = 识别开票明细状态(记录);
      const 字段列表 = 记录?.fields && typeof 记录.fields === "object" ? Object.entries(记录.fields) : [];
      const 行列表 = [];
      行列表.push(着色(适配宽度("巡检记录详情", 列数), "brightCyan"));
      行列表.push(`状态：${状态.状态}｜需要登记：${状态.需要登记 ? "是" : "否"}｜需要预警：${状态.需要预警 ? "是" : "否"}`);
      行列表.push(`来源：${记录?.source || "未知来源"}`);
      行列表.push(`摘要：${记录?.summary || "-"}`);
      行列表.push("");
      行列表.push(着色(适配宽度("原始字段：", 列数), "brightBlue"));
      for (const [键, 值] of 字段列表) {
        行列表.push(`${键}：${值}`);
      }
      if (字段列表.length === 0) {
        行列表.push("暂无原始字段。");
      }
      return 行列表;
    },
    footer() {
      if (this.state.detailRecord) {
        return "回车/Esc返回明细 q返回店铺列表";
      }
      if (this.state.detailStore) {
        return "f切换过滤 ↑↓滚动 回车/Esc返回店铺列表 q返回店铺列表";
      }
      return "↑↓选择 回车巡检明细 s启动该店巡检 ←→切页 q返回总览";
    },
    handleKey(按键, app) {
      const 店铺列表 = app.ctx.cache.config?.stores || [];

      if (this.state.detailRecord) {
        if (按键 === "enter" || 按键 === "esc" || 按键 === "backspace") {
          this.state.detailRecord = null;
          return true;
        }
        if (按键 === "q") {
          this.state.detailRecord = null;
          this.state.detailStore = null;
          return true;
        }
        return false;
      }

      if (this.state.detailStore) {
        const 结果对象 = app.ctx.cache.results?.stores || {};
        const 结果 = 结果对象[this.state.detailStore.id] || null;
        const 记录列表 = Array.isArray(结果?.records) ? 结果.records : [];
        const 模式 = 记录过滤模式[this.state.detailFilterMode] || 记录过滤模式[1];
        const 明细列表 = 记录列表
          .map((记录) => ({ 记录, 状态: 识别开票明细状态(记录) }))
          .filter((条目) => 模式.test(条目.状态));
        if (按键 === "f") {
          this.state.detailFilterMode = (this.state.detailFilterMode + 1) % 记录过滤模式.length;
          this.state.detailScroll = 0;
          return true;
        }
        if (按键 === "up") {
          this.state.detailScroll = Math.max(0, this.state.detailScroll - 1);
          return true;
        }
        if (按键 === "down") {
          this.state.detailScroll = Math.min(Math.max(0, 明细列表.length - Math.max(1, app.contentHeight - 4)), this.state.detailScroll + 1);
          return true;
        }
        if (按键 === "enter") {
          const 目标 = 明细列表[Math.min(this.state.detailScroll, 明细列表.length - 1)];
          if (目标) {
            this.state.detailRecord = 目标.记录;
            this.state.detailRecordScroll = 0;
          }
          return true;
        }
        if (按键 === "esc" || 按键 === "backspace") {
          this.state.detailStore = null;
          return true;
        }
        return false;
      }

      const 可见店数 = Math.max(1, app.contentHeight - 3);
      const 最大偏移 = Math.max(0, 店铺列表.length - 可见店数);
      if (按键 === "down") {
        if (this.state.selection < 店铺列表.length - 1) {
          this.state.selection += 1;
          if (this.state.selection - this.state.scrollOffset >= 可见店数) {
            this.state.scrollOffset = Math.min(最大偏移, this.state.scrollOffset + 1);
          }
        }
        return true;
      }
      if (按键 === "up") {
        if (this.state.selection > 0) {
          this.state.selection -= 1;
          if (this.state.selection < this.state.scrollOffset) {
            this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 1);
          }
        }
        return true;
      }
      if (按键 === "enter") {
        const 店铺 = 店铺列表[this.state.selection];
        if (店铺) {
          this.state.detailStore = 店铺;
          this.state.detailScroll = 0;
          this.state.detailFilterMode = 0;
        }
        return true;
      }
      if (按键 === "s") {
        const 店铺 = 店铺列表[this.state.selection];
        if (店铺) {
          app.ctx.services.启动单店巡检(店铺).catch(() => {});
        }
        return true;
      }
      return false;
    },
  };

  return 页面;
}

function 脱敏账号(账号) {
  const 标准账号 = String(账号 || "").trim();
  if (!标准账号) {
    return "未配置";
  }
  if (标准账号.length <= 3) {
    return `${标准账号.slice(0, 1)}***`;
  }
  return `${标准账号.slice(0, 3)}***${标准账号.slice(-2)}`;
}

module.exports = {
  创建店铺页,
  读取本地登录状态,
  格式化最近结果,
  读取最近结果状态,
  脱敏账号,
  店铺表格列定义,
  构建店铺表格行,
  构建记录明细行,
};
