const { DIVIDER } = require("./cliDashboard");

async function showCliHelp(terminal) {
  terminal.clear(); terminal.writeLine(terminal.theme.title("使用说明")); terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("1. 开始汇总会顺序处理天猫、京东、拼多多、抖音全部启用店铺。 ");
  terminal.writeLine("2. 程序会优先复用同店、同日期、同来源且已成功导入的现有源文件。 ");
  terminal.writeLine("3. 账号密码和点击登录尽量自动处理；出现滑块或安全验证时，");
  terminal.writeLine("   请在自动打开的业务浏览器中完成，CLI会在原地等待。 ");
  terminal.writeLine("4. 智能日期在每次启动时更新；手动日期保持固定。单店可独立设置日期。 ");
  terminal.writeLine("5. 运行前请保存并关闭汇总表；WPS或Excel占用时会停止，避免损坏。 ");
  terminal.writeLine("6. 本程序运行不需要AI；业务平台采集仍会使用独立Chrome窗口。 ");
  terminal.writeLine("7. 首页[A]进入金山文档三步菜单：同步明细、调整日期筛选、原样确认客服姓名勾选。 ");
  terminal.writeLine("8. 首页[B]可选择一家或全部店铺，忽略旧源表并在本次重新下载、汇总。 ");
  await terminal.pause();
}

module.exports = { showCliHelp };
