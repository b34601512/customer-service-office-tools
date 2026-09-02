// 该文件用于解析成员设置页表格列索引。
async function resolveTableColumnIndexes(page) {
  // 这里通过表头标题动态定位列号，避免不同筛选态下列序变化导致读错单元格。
  // 注意：表头列名匹配与 visibleRows.js / rowReady.js 的内联副本手动保持同步。
  return page.evaluate(() => {
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

    return {
      nameColumnIndex,
      currentConversationCountColumnIndex
    };
  });
}

module.exports = {
  resolveTableColumnIndexes
};
