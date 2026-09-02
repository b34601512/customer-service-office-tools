// 该文件用于维护运行日志弹窗和日志复制。
function openLogModal(event) {
  // 该函数用于打开日志弹窗，避免把运行日志长期铺在首页。
  lastLogTriggerId = event?.currentTarget?.id || "openLogButton";
  logModal.classList.remove("hidden");
  logModal.setAttribute("aria-hidden", "false");
  setBodyModalState();
  logOutput.scrollTop = logOutput.scrollHeight;
  logCloseButton.focus();
}

function closeLogModal() {
  // 该函数用于关闭日志弹窗并把焦点还给触发按钮。
  logModal.classList.add("hidden");
  logModal.setAttribute("aria-hidden", "true");
  setBodyModalState();
  const trigger = document.getElementById(lastLogTriggerId);
  if (trigger && !trigger.disabled) trigger.focus();
}

function copyTextWithTextarea(text) {
  // 该函数用于兼容 file 或旧浏览器环境下 Clipboard API 不可用的情况。
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("浏览器拒绝复制到剪贴板");
}

async function copyLogToClipboard() {
  // 该函数用于复制弹窗里的完整日志，方便问题复盘。
  const text = logOutput.textContent.trim();
  if (!text || text === "日志加载中" || text === "暂时还没有运行日志。") {
    setFeedback("当前没有可复制的日志。", "error");
    return;
  }
  try {
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {
        copied = false;
      }
    }
    if (!copied) copyTextWithTextarea(text);
    setFeedback("日志已复制。", "success");
  } catch (error) {
    setFeedback(`复制日志失败：${error.message || String(error)}`, "error");
  }
}
