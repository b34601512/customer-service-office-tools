// 该文件用于定位成员设置页里的目标成员表格行。
const { searchMember } = require("./search");

async function getMemberRowLocator(page, staffName) {
  await searchMember(page, staffName);
  const rowLocator = page.locator("tr.antd-v5-table-row").filter({ hasText: staffName }).first();
  if ((await rowLocator.count()) === 0) {
    throw new Error(`成员设置页没有找到客服「${staffName}」对应的表格行。`);
  }

  return rowLocator;
}

module.exports = {
  getMemberRowLocator
};
