// 该文件用于提供前端通用工具、请求和反馈能力。
function bindClick(element, handler) {
  // 该函数用于集中绑定按钮，避免空元素导致页面初始化中断。
  if (!element) return;
  element.addEventListener("click", handler);
}

function uniqueId(prefix) {
  // 该函数用于给新增配置行生成前端临时 ID，保存时后端会再次清洗。
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function escapeHtml(value) {
  // 该函数用于渲染日志和摘要文本，避免配置内容破坏页面结构。
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setFeedback(message, state = "info") {
  // 该函数用于在主界面可见区域反馈操作结果。
  feedback.textContent = message || "";
  feedback.dataset.state = state;
}

function setConfigFeedback(message, state = "info") {
  // 该函数用于在配置弹窗内部反馈保存和校验结果。
  configFeedback.textContent = message || "";
  configFeedback.dataset.state = state;
}

function setCommentFeedback(message, state = "info") {
  // 该函数用于在评论库弹窗内部反馈保存和校验结果。
  commentFeedback.textContent = message || "";
  commentFeedback.dataset.state = state;
}

function setBodyModalState() {
  // 该函数用于按真实弹窗状态锁定页面滚动，避免关闭一个弹窗误解锁另一个弹窗。
  const hasOpenModal = [configModal, commentModal, addCommentModal, logModal].some((modal) => modal && !modal.classList.contains("hidden"));
  document.body.classList.toggle("modal-open", hasOpenModal);
}

function requestJson(url, options = {}) {
  // 该函数用于统一请求后端接口，并把中文错误抛给按钮处理。
  return fetch(url, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...options,
  })
    .then((response) => response.json().then((payload) => ({ response, payload })))
    .then(({ response, payload }) => {
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || `请求失败：${response.status}`);
      }
      return payload;
    });
}

function enabledCommentCount(form) {
  // 该函数用于统计启用评论数量，避免评论库全关后用户不知情。
  const comments = Array.isArray(form?.comments) ? form.comments : [];
  return comments.filter((item) => item.enabled && String(item.text || "").trim()).length;
}
