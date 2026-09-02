// 该文件用于维护评论库弹窗的打开、编辑和保存。
let commentSaveFeedbackTimerId = null;

function restoreSaveCommentButton() {
  // 该函数用于把保存按钮从结果反馈状态恢复成默认操作按钮，避免旧状态误导下一次保存。
  if (!saveCommentButton) return;
  saveCommentButton.textContent = "保存评论库";
  saveCommentButton.removeAttribute("data-save-state");
  saveCommentButton.disabled = false;
}

function setSaveCommentButtonFeedback(message, state, restoreDelayMs = 0) {
  // 该函数用于把评论库保存结果直接显示在按钮上，让反馈出现在用户刚点击的位置。
  if (!saveCommentButton) return;
  if (commentSaveFeedbackTimerId !== null) {
    window.clearTimeout(commentSaveFeedbackTimerId);
    commentSaveFeedbackTimerId = null;
  }
  saveCommentButton.textContent = message;
  saveCommentButton.dataset.saveState = state;
  if (restoreDelayMs > 0) {
    commentSaveFeedbackTimerId = window.setTimeout(() => {
      commentSaveFeedbackTimerId = null;
      restoreSaveCommentButton();
    }, restoreDelayMs);
  }
}

function openCommentModal() {
  // 该函数用于单独打开评论库弹窗，避免和运行配置混在一起维护。
  const form = latestForm || {};
  commentDrafts = Array.isArray(form.comments) ? form.comments.map((item) => ({ ...item })) : [];
  setCommentFeedback("");
  restoreSaveCommentButton();
  renderCommentImportMode();
  renderCommentDrafts();
  commentModal.classList.remove("hidden");
  commentModal.setAttribute("aria-hidden", "false");
  setBodyModalState();
}

function closeCommentModal() {
  // 该函数用于关闭评论库弹窗。
  commentModal.classList.add("hidden");
  commentModal.setAttribute("aria-hidden", "true");
  setBodyModalState();
}

function renderCommentDrafts() {
  // 该函数用于渲染评论库配置行。
  commentList.innerHTML = "";
  commentDrafts.forEach((comment, index) => {
    const row = document.createElement("div");
    row.className = "comment-row";
    const sentCount = Math.max(0, Number(comment.sent_count || 0));
    row.innerHTML = `
      <label class="comment-enabled"><input type="checkbox" ${comment.enabled ? "checked" : ""} /><span>启用</span></label>
      <span class="comment-count">已发 ${sentCount} 次</span>
      <textarea rows="2" placeholder="购买场景问题">${escapeHtml(comment.text || "")}</textarea>
      <button class="small-danger" type="button" ${commentDrafts.length <= 1 ? "disabled" : ""}>删除</button>
    `;
    row.querySelector('input[type="checkbox"]').addEventListener("change", (event) => {
      commentDrafts[index].enabled = event.currentTarget.checked;
    });
    row.querySelector("textarea").addEventListener("input", (event) => {
      commentDrafts[index].text = event.currentTarget.value;
    });
    row.querySelector(".small-danger").addEventListener("click", () => {
      commentDrafts.splice(index, 1);
      renderCommentDrafts();
    });
    commentList.appendChild(row);
  });
}

function renderCommentImportMode() {
  // 该函数用于根据切分方式显示自定义分隔符输入框，避免无关配置干扰导入。
  if (!importCustomDelimiterField || !importSplitMode) return;
  importCustomDelimiterField.classList.toggle("hidden", importSplitMode.value !== "custom");
}

function openCommentImportPicker() {
  // 该函数用于打开本地文件选择器，实际解析在选择文件后执行。
  if (!commentImportFileInput) return;
  renderCommentImportMode();
  commentImportFileInput.value = "";
  commentImportFileInput.click();
}

function readFileAsBase64(file) {
  // 该函数用于把本地文件读成 base64，后端统一负责文档解析和切分。
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",", 2)[1] : value);
    };
    reader.onerror = () => reject(new Error("读取文件失败，请重新选择文件。"));
    reader.readAsDataURL(file);
  });
}

function normalizeImportedCommentText(value) {
  // 该函数用于前端追加前再次清理空白，避免重复判断和显示不一致。
  return String(value || "").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}

function appendImportedCommentDrafts(items) {
  // 该函数用于把导入结果追加到评论库草稿，并跳过已存在的重复评论。
  const existing = new Set(commentDrafts.map((item) => normalizeImportedCommentText(item.text)));
  let addedCount = 0;
  let skippedCount = 0;
  (Array.isArray(items) ? items : []).forEach((item) => {
    const text = normalizeImportedCommentText(item?.text);
    if (!text) return;
    if (existing.has(text)) {
      skippedCount += 1;
      return;
    }
    existing.add(text);
    commentDrafts.push({ id: uniqueId("comment"), text, enabled: true, sent_count: 0 });
    addedCount += 1;
  });
  return { addedCount, skippedCount };
}

async function importSelectedCommentFile(event) {
  // 该函数用于导入选中的文档，把识别出的评论加入草稿但不直接写配置。
  const file = event?.currentTarget?.files?.[0];
  if (!file) return;
  try {
    importCommentButton.disabled = true;
    setCommentFeedback("正在识别评论文件。", "info");
    const contentBase64 = await readFileAsBase64(file);
    const payload = await requestJson("/api/comments/import", {
      method: "POST",
      body: JSON.stringify({
        file_name: file.name,
        content_base64: contentBase64,
        split_mode: importSplitMode?.value || "line",
        custom_delimiters: importCustomDelimiters?.value || "",
      }),
    });
    const result = appendImportedCommentDrafts(payload.comments);
    renderCommentDrafts();
    const duplicateText = result.skippedCount ? `，跳过重复 ${result.skippedCount} 条` : "";
    setCommentFeedback(`已导入 ${result.addedCount} 条评论${duplicateText}，保存评论库后生效。`, result.addedCount ? "success" : "info");
  } catch (error) {
    setCommentFeedback(error.message, "error");
    setFeedback(error.message, "error");
  } finally {
    importCommentButton.disabled = false;
    commentImportFileInput.value = "";
  }
}

function openAddCommentModal() {
  // 该函数用于打开新增评论弹窗，避免点击新增就产生空评论。
  addCommentFeedback.textContent = "";
  addCommentFeedback.dataset.state = "info";
  newCommentTextInput.value = "";
  addCommentModal.classList.remove("hidden");
  addCommentModal.setAttribute("aria-hidden", "false");
  setBodyModalState();
  newCommentTextInput.focus();
}

function closeAddCommentModal() {
  // 该函数用于关闭新增评论弹窗，不修改评论库草稿。
  addCommentModal.classList.add("hidden");
  addCommentModal.setAttribute("aria-hidden", "true");
  setBodyModalState();
  addCommentButton.focus();
}

function saveNewCommentDraft() {
  // 该函数用于把新增评论弹窗里的有效内容加入评论库草稿。
  const text = String(newCommentTextInput.value || "").trim();
  if (!text) {
    addCommentFeedback.textContent = "评论内容不能为空。";
    addCommentFeedback.dataset.state = "error";
    newCommentTextInput.focus();
    return;
  }
  commentDrafts.push({ id: uniqueId("comment"), text, enabled: true, sent_count: 0 });
  renderCommentDrafts();
  setCommentFeedback("新增评论已加入列表，记得保存评论库。", "success");
  closeAddCommentModal();
}

function collectCommentPayload() {
  // 该函数用于把评论库弹窗草稿收集成后端配置对象，并保留当前运行配置。
  const form = latestForm || {};
  return {
    active_room_id: form.active_room_id || "",
    live_rooms: Array.isArray(form.live_rooms) ? form.live_rooms : [],
    active_account_id: form.active_account_id || "",
    account_profiles: Array.isArray(form.account_profiles) ? form.account_profiles : [],
    comments: commentDrafts.map((item) => ({ id: item.id, text: item.text, enabled: Boolean(item.enabled), sent_count: Math.max(0, Number(item.sent_count || 0)) })),
    schedule: form.schedule || { random_countdown_seconds: 30 },
    work_task: form.work_task || { total_count: 500 },
    browser: form.browser || { executable_path: "" },
  };
}

async function saveComments() {
  // 该函数用于保存独立评论库弹窗里的评论。
  try {
    saveCommentButton.disabled = true;
    setCommentFeedback("");
    setSaveCommentButtonFeedback("保存中", "running");
    const payload = await requestJson("/api/config/save", {
      method: "POST",
      body: JSON.stringify(collectCommentPayload()),
    });
    latestForm = payload.form;
    renderSummary(latestForm);
    saveCommentButton.disabled = false;
    setSaveCommentButtonFeedback("已保存", "success", 5000);
  } catch (error) {
    saveCommentButton.disabled = false;
    setSaveCommentButtonFeedback("保存失败", "error", 5000);
    setFeedback(error.message, "error");
    setCommentFeedback(error.message, "error");
  }
}
