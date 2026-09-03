// 帮助页：静态使用说明，内容与旧 CLI 帮助保持一致。
const ansi = require("../ansi");
const { fit } = require("../width");
const { CLI_BRAND_METADATA } = require("../../cliConstants");

const HELP_LINES = [
  "1. 开始汇总会顺序处理天猫、京东、拼多多、抖音全部启用店铺。",
  "2. 程序会优先复用同店、同日期、同来源且已成功导入的现有源文件。",
  "3. 账号密码和点击登录尽量自动处理；出现滑块或安全验证时，",
  "   请在自动打开的业务浏览器中完成，程序会在原地等待。",
  "4. 智能日期在每次启动时更新；手动日期保持固定。单店可独立设置日期。",
  "5. 运行前请保存并关闭汇总表；WPS 或 Excel 占用时会停止，避免损坏。",
  "6. 本程序运行不需要AI；业务平台采集仍会使用独立 Chrome 窗口。",
  "7. 金山页执行三步：同步明细、调整日期筛选、原样确认客服姓名勾选。",
  "8. 汇总页可↑↓选中店铺回车重跑，或选全部店铺强制重新下载、汇总。",
  "",
  "按键说明：",
  "  总览页快捷操作：↑↓选择动作，回车执行（开始全部汇总 / 全部强制重下 / 退出程序）。",
  "  各页统一：↑↓移动选择，回车执行；←→ 或数字键 1-6 切换页面。",
  "  汇总页保留快捷键：S=开始全部，F=全部强制重下，回车店铺行=单店重跑。",
  "  Esc 返回上一级或取消输入；q 返回总览；Ctrl+C 退出（会先确认）。"
];

function createHelpPage() {
  return {
    key: "6",
    title: "帮助",
    render(app) {
      const columns = app.columns;
      const lines = [ansi.colorize("使用说明", "brightBlue"), ""];
      HELP_LINES.forEach((line) => lines.push(fit(line, columns)));
      lines.push("");
      lines.push(ansi.colorize(`作者：${CLI_BRAND_METADATA.authorDisplayName}    微信：${CLI_BRAND_METADATA.officialWechatId}    官网：${CLI_BRAND_METADATA.officialWebsiteUrl}`, "gray"));
      return lines;
    },
    footer() {
      return "帮助页 | ←→切页 Ctrl+C退出";
    }
  };
}

module.exports = { createHelpPage };
