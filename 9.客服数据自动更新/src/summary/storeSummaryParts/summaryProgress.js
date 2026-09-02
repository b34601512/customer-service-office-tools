function notifyStoreProgress(task, onTaskProgress, patch) {
  // 这个函数只把当前店铺的一次动作反馈给首页任务行。
  if (typeof onTaskProgress === "function") {
    onTaskProgress({
      ...task,
      updatedAt: new Date().toISOString(),
      ...patch,
      id: task.id
    });
  }
}

module.exports = {
  notifyStoreProgress
};
