// 该文件用于等待成员接待人数下降到目标值。
const appConfig = require("../../../config/appConfig");
const { waitForPageFunction } = require("../../../engine/pageWait");
const { resolveTableColumnIndexes } = require("./tableColumns");

async function waitForConversationCountAtMost(page, staffName, targetCount) {
  // 这里动态等待接待数下降，避免释放/转接完成后又去读到旧值。
  const columnIndexes = await resolveTableColumnIndexes(page);
  await waitForPageFunction(
    page,
    ([targetName, maxCount, indexes]) => {
      const rows = Array.from(document.querySelectorAll("tr.antd-v5-table-row"));
      const targetRow = rows.find((row) => row.innerText.replace(/\s+/g, " ").includes(targetName));
      if (!targetRow) {
        return false;
      }

      const cells = targetRow.querySelectorAll("td");
      const countText = (cells[indexes.currentConversationCountColumnIndex]?.innerText || "")
        .replace(/\s+/g, " ")
        .trim();
      const countMatch = countText.match(/\d+/);
      const currentCount = countMatch ? Number(countMatch[0]) : 0;
      return currentCount <= maxCount;
    },
    [staffName, targetCount, columnIndexes],
    { timeout: appConfig.pageReadyTimeout }
  );
}

module.exports = {
  waitForConversationCountAtMost
};
