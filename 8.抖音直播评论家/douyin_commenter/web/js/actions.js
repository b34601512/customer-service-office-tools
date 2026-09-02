// 该文件用于维护后端动作请求和实时事件流。
async function runAction(button, message, callback, afterSuccess = null, afterFailure = null) {
  // 该函数用于执行按钮动作，保证点击后立刻有反馈且按钮不会重复触发。
  try {
    button.disabled = true;
    setFeedback(message, "info");
    const payload = await callback();
    setFeedback(payload.message || "操作已完成。", "success");
    if (typeof afterSuccess === "function") afterSuccess(payload);
  } catch (error) {
    setFeedback(error.message, "error");
    if (typeof afterFailure === "function") afterFailure(error);
  } finally {
    button.disabled = false;
  }
}

function connectEvents() {
  // 该函数用于连接后端事件流，实时刷新日志和运行状态。
  const source = new EventSource("/api/events");
  source.addEventListener("log", (event) => {
    const payload = JSON.parse(event.data);
    appendLogLine(payload.line);
  });
  source.addEventListener("state", (event) => {
    renderRuntime(JSON.parse(event.data));
  });
}
