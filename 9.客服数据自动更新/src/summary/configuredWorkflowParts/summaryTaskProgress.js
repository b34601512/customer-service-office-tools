function notifySummaryTaskProgress(task, onTaskProgress, patch) {
  // 这个函数只把一次状态变化更新到当前店铺任务行。
  if (typeof onTaskProgress !== "function") {
    return;
  }
  onTaskProgress({
    ...task,
    updatedAt: new Date().toISOString(),
    ...patch,
    id: task.id,
    platformKey: task.platformKey,
    platformLabel: task.platformLabel,
    storeKey: task.storeKey,
    storeDisplayName: task.storeDisplayName,
    dataSourceName: task.dataSourceName
  });
}

module.exports = {
  notifySummaryTaskProgress
};
