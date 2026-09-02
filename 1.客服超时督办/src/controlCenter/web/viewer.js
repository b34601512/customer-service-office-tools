const viewerFeedback = document.getElementById("viewerFeedback");
const viewerStatusText = document.getElementById("viewerStatusText");
const feedbackStack = document.getElementById("feedbackStack");

const FEEDBACK_TYPE_META = {
  info: {
    title: "等待操作",
    className: "is-info"
  },
  pending: {
    title: "正在处理",
    className: "is-pending"
  },
  success: {
    title: "操作成功",
    className: "is-success"
  },
  error: {
    title: "操作失败",
    className: "is-error"
  }
};

let feedbackToastSerial = 0;

function escapeHtml(value) {
  // 这里统一转义查看页提示文案，避免特殊字符把页面结构打坏。
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveFeedbackElements(container) {
  return {
    title: container.querySelector("[data-feedback-title]"),
    message: container.querySelector("[data-feedback-message]")
  };
}

function renderFeedbackBanner(container, message, type = "info", options = {}) {
  // 这里统一渲染查看页反馈条，让每次打开入口都有清晰反馈。
  const meta = FEEDBACK_TYPE_META[type] || FEEDBACK_TYPE_META.info;
  const refs = resolveFeedbackElements(container);
  container.className = `feedback-banner ${meta.className}`;
  if (refs.title) {
    refs.title.textContent = options.title || meta.title;
  }
  if (refs.message) {
    refs.message.textContent = String(message || "");
  }
}

function showFeedbackToast(message, type = "success", options = {}) {
  // 这里补一个右上角浮层提示，避免用户不确定是否真的打开成功。
  const meta = FEEDBACK_TYPE_META[type] || FEEDBACK_TYPE_META.info;
  const toast = document.createElement("section");
  toast.className = `feedback-toast ${meta.className}`;
  toast.dataset.toastId = `feedback-toast-${Date.now()}-${(feedbackToastSerial += 1)}`;
  toast.innerHTML = `
    <strong class="feedback-toast-title">${escapeHtml(options.title || meta.title)}</strong>
    <p class="feedback-toast-message">${escapeHtml(message)}</p>
  `;
  feedbackStack.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, options.durationMs || (type === "error" ? 5000 : 2800));
}

function setViewerFeedback(message, isError = false, options = {}) {
  // 这里统一收口查看页反馈，横幅和浮层保持同一口径。
  const type = options.type || (isError ? "error" : "success");
  renderFeedbackBanner(viewerFeedback, message, type, options);
  if (options.showToast ?? !options.silent) {
    showFeedbackToast(message, type, options);
  }
}

function setButtonBusy(button, pendingText) {
  // 这里统一切换按钮的处理中态，避免重复点击同一个入口。
  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add("is-busy");
  button.dataset.originalText = originalText;
  button.textContent = pendingText;
}

function clearButtonBusy(button, fallbackText = "") {
  // 这里统一恢复按钮文本和可点击状态，确保动作结束后界面回到稳定态。
  const originalText = button.dataset.originalText || fallbackText || button.textContent;
  button.disabled = false;
  button.classList.remove("is-busy");
  button.textContent = originalText;
  delete button.dataset.originalText;
}

// requestJson 由 /shared/requestJson.js 提供，与 logs.js/app/settings 共用同一份实现（issue #551）。

function bindActions() {
  // 这里统一绑定查看页动作，让报表、文档和目录入口都走一致交互。
  document.querySelectorAll("[data-link]").forEach((button) => {
    button.addEventListener("click", () => {
      window.open(button.dataset.link, "_blank", "noopener");
      setViewerFeedback(`已打开「${button.textContent}」。`, false, {
        type: "success",
        title: "已打开新页面"
      });
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      setButtonBusy(button, "正在处理...");
      setViewerFeedback(`正在执行「${button.textContent}」。`, false, {
        type: "pending",
        title: "正在处理",
        showToast: false
      });
      try {
        const result = await requestJson(`/api/actions/${button.dataset.action}`, {
          method: "POST",
          body: "{}"
        });
        clearButtonBusy(button);
        setViewerFeedback(result.message, false, {
          type: "success",
          title: "动作已完成"
        });
      } catch (error) {
        clearButtonBusy(button);
        setViewerFeedback(error.message, true, {
          title: "动作失败"
        });
      }
    });
  });
}

function bootstrap() {
  // 这里统一初始化查看页，让页面一打开就清楚自己承担的职责。
  viewerStatusText.textContent = "这里集中放查看类入口，首页只保留启动和配置入口。";
  setViewerFeedback("查看中心已加载完成。", false, {
    type: "info",
    title: "查看中心就绪",
    showToast: false
  });
  bindActions();
}

bootstrap();
