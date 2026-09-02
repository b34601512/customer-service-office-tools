// 帮助页：使用说明 + 按键操作。说明文本与 cliHelp.js 保持一致。
const ansi = require("../ansi");
const { titleBanner } = require("../gameUi");

const HELP_LINES = [
  "1. 开始汇总会顺序处理全部已启用平台店铺。",
  "2. 同店、同日、同统计方式已成功时自动跳过，不重复采集。",
  "3. 强制重新采集可选全部店铺、某个平台或某一家店；同记录键覆盖，新的记录追加。",
  "4. 京东、天猫、拼多多会自动填写账号密码；抖音首次登录请人工完成；",
  "   请在自动打开的独立浏览器中人工完成，CLI会在原地等待。",
  "5. 运行前请保存并关闭汇总表；被WPS或Excel占用时会立即停止。",
  "6. 店铺管理可修改编号；新增店铺可直接填6，允许跳过中间编号。",
  "7. 店铺指标只保留平台考核最终数值，不保存客服个人或业务明细。",
  "8. 本程序运行不需要AI；采集页面使用的Chrome属于业务浏览器。",
  "9. 金山页可把本地“数据源”一次同步到金山文档，并回读数量确认结果。"
];

function createHelpPage() {
  return {
    key: "6",
    title: "帮助",
    state: {},
    render(app) {
      const columns = app.columns;
      const lines = [];
      lines.push(...titleBanner("◆ 使用说明 ◆", columns - 2));
      lines.push(...HELP_LINES);
      lines.push("");
      lines.push(ansi.colorize("── 按键操作 ──", "brightCyan"));
      lines.push(" ↑↓ 选择   回车 执行");
      lines.push(" ←→ 或 数字键 切换页面");
      lines.push(" Esc/退格 返回上一级");
      lines.push(" Ctrl+C 退出控制台（需确认）");
      return lines;
    },
    footer() {
      return "←→/数字键切页  Esc 返回总览";
    },
    handleKey(key, app) {
      if (key === "esc" || key === "backspace") {
        app.switchPage(0);
        return true;
      }
      return false;
    }
  };
}

module.exports = {
  createHelpPage,
  HELP_LINES
};