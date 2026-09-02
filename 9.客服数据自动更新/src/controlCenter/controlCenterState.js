function createDefaultControlCenterState() {
  // 这里只保存正式首页会展示的本轮汇总状态。
  return {
    lastError: "",
    lastAction: "",
    summaryTasks: [],
    summaryRunStartedAt: "",
    summaryRunFinishedAt: "",
    summaryRunDurationMs: 0,
    summaryResult: null,
    projectConfig: null
  };
}

const state = createDefaultControlCenterState();
const stateListeners = new Set();

function getControlCenterState() {
  // 这里统一暴露内存状态，避免前端直接拼业务逻辑。
  return JSON.parse(JSON.stringify(state));
}

function patchControlCenterState(partialState) {
  // 这里只更新首页运行态；每个汇总任务自行携带店铺身份。
  Object.assign(state, partialState);
  const stateSnapshot = getControlCenterState();
  for (const stateListener of stateListeners) {
    try {
      stateListener(stateSnapshot);
    } catch (_listenerError) {
      // 界面监听失败不能反向中断下载和写表主任务。
    }
  }
  return stateSnapshot;
}

function subscribeControlCenterState(stateListener) {
  if (typeof stateListener !== "function") {
    throw new Error("控制台状态监听器必须是函数。");
  }
  stateListeners.add(stateListener);
  return () => stateListeners.delete(stateListener);
}

module.exports = {
  createDefaultControlCenterState,
  getControlCenterState,
  patchControlCenterState,
  subscribeControlCenterState
};
