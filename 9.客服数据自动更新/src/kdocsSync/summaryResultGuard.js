function assertSummaryCompleteBeforeKdocsSync(summaryResult) {
  const successCount = Number(summaryResult?.successCount);
  const errorCount = Number(summaryResult?.errorCount);
  const totalCount = Number(summaryResult?.totalCount);
  const complete = summaryResult?.status === "success" &&
    Number.isInteger(totalCount) && totalCount > 0 &&
    Number.isInteger(successCount) && successCount === totalCount &&
    Number.isInteger(errorCount) && errorCount === 0;
  if (complete) return;

  const detail = String(summaryResult?.detail || "未取得完整汇总结果");
  throw new Error(`汇总未全部成功，已停止金山同步和透视筛选。${detail}`);
}

module.exports = { assertSummaryCompleteBeforeKdocsSync };
