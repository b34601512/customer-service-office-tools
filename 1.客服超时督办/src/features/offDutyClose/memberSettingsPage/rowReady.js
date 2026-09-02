// 该文件用于等待目标成员行关键数据渲染完整。
const appConfig = require("../../../config/appConfig");
const { waitForPageFunction } = require("../../../engine/pageWait");

async function waitForMemberRowDataReady(page, staffName) {
  // 这里继续等待目标成员行把两个开关和接待人数都渲染完整，避免把“未渲染”误读成“已关闭”。
  await waitForPageFunction(
    page,
    (targetName) => {
      // 注意：表头列名匹配与 tableColumns.js / visibleRows.js 的副本手动保持同步。
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const headerTexts = Array.from(document.querySelectorAll("thead th")).map((cell) =>
        normalize(cell.innerText || cell.textContent || "")
      );
      const nameColumnIndex = headerTexts.findIndex((text) => text.includes("成员名称"));
      const currentConversationCountColumnIndex = headerTexts.findIndex((text) =>
        text.includes("当前接待人数")
      );
      if (nameColumnIndex < 0 || currentConversationCountColumnIndex < 0) {
        return false;
      }

      const rows = Array.from(document.querySelectorAll("tr.antd-v5-table-row"));
      const targetRow = rows.find((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const nameCellText = normalize(cells[nameColumnIndex]?.innerText || "");
        return nameCellText.includes(targetName);
      });
      if (!targetRow) {
        return false;
      }

      const cells = Array.from(targetRow.querySelectorAll("td"));
      if (cells.length <= currentConversationCountColumnIndex) {
        return false;
      }

      const switches = Array.from(targetRow.querySelectorAll('button[role="switch"]'));
      if (switches.length < 2) {
        return false;
      }

      const switchStatesReady = switches
        .slice(0, 2)
        .every((item) => ["true", "false"].includes(item.getAttribute("aria-checked") || ""));
      if (!switchStatesReady) {
        return false;
      }

      const countText = normalize(cells[currentConversationCountColumnIndex]?.innerText || "");
      return /\d+/.test(countText);
    },
    staffName,
    { timeout: appConfig.pageReadyTimeout }
  );
}

module.exports = {
  waitForMemberRowDataReady
};
