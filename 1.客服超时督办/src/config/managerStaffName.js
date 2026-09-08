const appConfig = require("./appConfig");

function resolveManagerStaffName() {
  const name = String(appConfig.managerStaffName || "").trim();
  if (!name) throw new Error("请在控制台「配置」填写主管姓名，并在「企微」维护同名成员的提醒信息；保存后重启后台。");
  return name;
}

module.exports = { resolveManagerStaffName };
