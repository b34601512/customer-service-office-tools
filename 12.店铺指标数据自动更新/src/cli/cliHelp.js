const { DIVIDER } = require("./cliDashboard");

async function showCliHelp(terminal) {
  terminal.clear();
  terminal.writeLine(terminal.theme.title("使用说明"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("1. 开始汇总会顺序处理全部已启用平台店铺。");
  terminal.writeLine("2. 同店、同日、同统计方式已成功时自动跳过，不重复采集。");
  terminal.writeLine("3. 强制重新采集可选全部店铺、某个平台或某一家店；同记录键覆盖，新的记录追加。");
  terminal.writeLine("4. 京东、天猫、拼多多会自动填写账号密码；抖音首次登录请人工完成；");
  terminal.writeLine("   请在自动打开的独立浏览器中人工完成，CLI会在原地等待。");
  terminal.writeLine("5. 运行前请保存并关闭汇总表；被WPS或Excel占用时会立即停止。");
  terminal.writeLine("6. 店铺管理可修改编号；新增店铺可直接填6，允许跳过中间编号。");
  terminal.writeLine("7. 店铺指标只保留平台考核最终数值，不保存客服个人或业务明细。");
  terminal.writeLine("8. 本程序运行不需要AI；采集页面使用的Chrome属于业务浏览器。");
  terminal.writeLine("9. 首页[A]可把本地“数据源”一次同步到金山文档，并回读数量确认结果。");
  await terminal.pause();
}

module.exports = {
  showCliHelp
};
