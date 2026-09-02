// 该文件用于读取成员设置页当前可见表格行。
async function readVisibleMemberRows(page) {
  // 这里统一把当前表格可见行压成结构化对象，后续切换开关和读接待数都复用。
  return page.evaluate(() => {
    // 注意：表头列名匹配与 tableColumns.js / rowReady.js 的内联副本手动保持同步。
    const headerTexts = Array.from(document.querySelectorAll("thead th")).map((cell) =>
      (cell.innerText || "").replace(/\s+/g, " ").trim()
    );
    const nameColumnIndex = headerTexts.findIndex((text) => text.includes("成员名称"));
    const currentConversationCountColumnIndex = headerTexts.findIndex((text) =>
      text.includes("当前接待人数")
    );
    if (nameColumnIndex < 0 || currentConversationCountColumnIndex < 0) {
      throw new Error(`成员设置表头未找到关键列：${headerTexts.join(" | ")}`);
    }

    return Array.from(document.querySelectorAll("tr.antd-v5-table-row"))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length <= currentConversationCountColumnIndex) {
          return null;
        }

        const nameCellText = (cells[nameColumnIndex]?.innerText || "").replace(/\s+/g, " ").trim();
        const switches = Array.from(row.querySelectorAll('button[role="switch"]'));
        const countText = (cells[currentConversationCountColumnIndex]?.innerText || "")
          .replace(/\s+/g, " ")
          .trim();
        const countMatch = countText.match(/\d+/);
        return {
          rowKey: row.getAttribute("data-row-key") || "",
          nameCellText,
          switchCount: switches.length,
          hasConversationCount: Boolean(countMatch),
          autoAssignEnabled: switches[0]?.getAttribute("aria-checked") === "true",
          currentConversationCount: countMatch ? Number(countMatch[0]) : 0,
          transferEnabled: switches[1]?.getAttribute("aria-checked") === "true"
        };
      })
      .filter(Boolean);
  });
}

module.exports = {
  readVisibleMemberRows
};
