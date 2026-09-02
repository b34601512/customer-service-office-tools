// 配置页：店铺配置只读总览 + 启用/停用切换；新增/修改/删除请使用 CLI 模式。
const { 着色 } = require("../共享路径").ansi;
const { 适配宽度 } = require("../共享路径").width;
const { 脱敏账号 } = require("./stores");

function 创建配置页() {
  const 页面 = {
    key: "4",
    title: "配置",
    state: {
      selection: 0,
      message: "",
    },
    onEnter() {
      const 店铺列表 = this.ctx.cache.config?.stores || [];
      if (this.state.selection >= 店铺列表.length) {
        this.state.selection = Math.max(0, 店铺列表.length - 1);
      }
    },
    render(app) {
      const 上下文 = app.ctx;
      const 店铺列表 = Array.isArray(上下文.cache.config?.stores) ? 上下文.cache.config.stores : [];
      const 列数 = app.columns;

      const 行列表 = [];
      行列表.push(着色(适配宽度(`店铺配置（共 ${店铺列表.length} 家｜t 启用/停用）`, 列数), "brightBlue"));

      if (店铺列表.length === 0) {
        行列表.push(着色("当前没有店铺配置。请在 CLI 模式（npm run panel:cli）中新增店铺。", "gray"));
        return 行列表;
      }

      for (let 索引 = 0; 索引 < 店铺列表.length; 索引 += 1) {
        const 店铺 = 店铺列表[索引];
        const 选中 = 索引 === this.state.selection;
        const 启用文字 = 店铺.enabled === false ? 着色("停用", "gray") : 着色("启用", "brightGreen");
        const 地址 = String(店铺.targetUrl || "-");
        const 账号 = 脱敏账号(店铺.username || 店铺.phoneNumber || "");
        const 第一行 = `  [${索引 + 1}] ${店铺.name || "未命名"} (${店铺.id || "-"})｜${启用文字}｜账号：${账号}`;
        const 第二行 = `      目标地址：${地址}`;
        行列表.push(选中 ? 着色(适配宽度(第一行, 列数), "reverse") : 适配宽度(第一行, 列数));
        行列表.push(适配宽度(第二行, 列数));
      }

      行列表.push("");
      行列表.push(着色("新增、修改、删除店铺请使用 CLI 模式：npm run panel:cli", "gray"));

      if (this.state.message) {
        行列表.push(着色(this.state.message, "brightYellow"));
      }

      return 行列表;
    },
    footer() {
      return "↑↓选择 t启用/停用 ←→切页 q返回总览";
    },
    handleKey(按键, app) {
      const 上下文 = app.ctx;
      const 店铺列表 = 上下文.cache.config?.stores || [];

      if (按键 === "down") {
        if (this.state.selection < 店铺列表.length - 1) {
          this.state.selection += 1;
        }
        return true;
      }
      if (按键 === "up") {
        if (this.state.selection > 0) {
          this.state.selection -= 1;
        }
        return true;
      }
      if (按键 === "t" || 按键 === "T") {
        const 店铺 = 店铺列表[this.state.selection];
        if (店铺) {
          try {
            上下文.services.切换店铺启用状态(店铺.id);
            this.state.message = `[完成] 已${店铺.enabled === false ? "启用" : "停用"}：${店铺.name}`;
          } catch (错误) {
            this.state.message = `[失败] ${错误 instanceof Error ? 错误.message : String(错误)}`;
          }
        }
        return true;
      }
      return false;
    },
  };

  return 页面;
}

module.exports = {
  创建配置页,
};
