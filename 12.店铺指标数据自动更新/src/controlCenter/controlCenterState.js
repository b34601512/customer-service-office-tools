function createInitialControlCenterState() {
  return {
    status: "idle",
    stage: "等待开始",
    detail: "选择“开始汇总”后自动运行全部已启用平台店铺。",
    startedAt: "",
    completedAt: "",
    activeStoreKey: "",
    storeResults: [],
    result: null,
    error: null
  };
}

function createControlCenterStateStore() {
  let state = createInitialControlCenterState();
  const listeners = new Set();
  return {
    read() {
      return { ...state };
    },
    update(patch) {
      state = { ...state, ...patch };
      const stateSnapshot = { ...state };
      for (const listener of listeners) {
        try {
          listener(stateSnapshot);
        } catch (_listenerError) {
          // 状态监听只负责展示，不能反向打断采集主任务。
        }
      }
      return stateSnapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new Error("状态监听器必须是函数。");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

module.exports = {
  createInitialControlCenterState,
  createControlCenterStateStore
};
