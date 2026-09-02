// 该文件用于维护配置弹窗和新增关键词弹窗的显隐状态。
function isModalElementVisible(modalElement) {
  // 这里统一判断弹窗是否可见，避免多个弹窗互相覆盖 body 滚动状态。
  return Boolean(modalElement && modalElement.classList && !modalElement.classList.contains("hidden"));
}

function refreshModalOpenState() {
  // 这里按真实可见弹窗刷新页面滚动锁，避免关闭小弹窗时把底层配置弹窗也解锁。
  if (!document.body || !document.body.classList) {
    return;
  }

  const knownModals = [configModal, keywordAddModal].filter(Boolean);
  const documentModals = typeof document.querySelectorAll === "function"
    ? Array.from(document.querySelectorAll(".config-modal"))
    : [];
  const hasVisibleModal = [...knownModals, ...documentModals].some((modalElement) => isModalElementVisible(modalElement));
  document.body.classList.toggle("modal-open", hasVisibleModal);
}

function isKeywordAddModalVisible() {
  // 这里单独识别新增关键词弹窗，按 Escape 时要优先关闭最上层。
  return isModalElementVisible(keywordAddModal);
}

function setKeywordAddModalVisible(isVisible) {
  // 这里统一控制新增关键词弹窗显隐，避免按钮、遮罩和键盘关闭各写一套逻辑。
  if (!keywordAddModal) {
    return;
  }

  keywordAddModal.classList.toggle("hidden", !isVisible);
  keywordAddModal.setAttribute("aria-hidden", isVisible ? "false" : "true");
  refreshModalOpenState();
}

function openKeywordAddModal(fieldId, triggerButton) {
  // 这里让新增关键词先进入弹窗，确认后才回写当前分类列表。
  if (!keywordAddModal || !keywordAddForm || !keywordAddTextInput) {
    throw new Error("新增关键词弹窗缺失，无法继续新增。");
  }

  const config = getKeywordEditorConfig(fieldId);
  const editorTitle = getKeywordEditorTitle(fieldId);
  keywordAddFieldId = fieldId;
  keywordAddTriggerButton = triggerButton || document.activeElement;
  if (keywordAddModalTitle) {
    keywordAddModalTitle.textContent = `新增${editorTitle}`;
  }
  if (keywordAddModalSubtitle) {
    keywordAddModalSubtitle.textContent = "确认后加入当前列表，点击保存后正式生效。";
  }
  keywordAddTextInput.value = "";
  if (typeof keywordAddTextInput.setCustomValidity === "function") {
    keywordAddTextInput.setCustomValidity("");
  }
  keywordAddForm.querySelectorAll("[name='keywordAddMatchMode']").forEach((input) => {
    input.checked = input.value === config.defaultMatchMode;
  });
  setKeywordAddModalVisible(true);
  if (typeof keywordAddTextInput.focus === "function") {
    keywordAddTextInput.focus();
  }
}

function closeKeywordAddModal(options = {}) {
  // 这里只关闭新增弹窗，不影响底层配置弹窗当前停留的页面。
  const triggerButton = keywordAddTriggerButton;
  setKeywordAddModalVisible(false);
  keywordAddFieldId = "";
  keywordAddTriggerButton = null;
  if (keywordAddTextInput) {
    keywordAddTextInput.value = "";
  }
  if (options.restoreFocus !== false && triggerButton && typeof triggerButton.focus === "function") {
    triggerButton.focus();
  }
}

function submitKeywordAddModal(event) {
  // 这里把弹窗输入转换成一条关键词规则，并继续复用原有保存前同步链路。
  event.preventDefault();
  const fieldId = keywordAddFieldId;
  const keywordText = String(keywordAddTextInput?.value || "").trim();
  if (!fieldId) {
    throw new Error("新增关键词目标分类缺失。");
  }
  if (!keywordText) {
    if (keywordAddTextInput && typeof keywordAddTextInput.setCustomValidity === "function") {
      keywordAddTextInput.setCustomValidity("关键词不能为空。");
    }
    if (keywordAddTextInput && typeof keywordAddTextInput.reportValidity === "function") {
      keywordAddTextInput.reportValidity();
    }
    return;
  }

  const checkedMatchMode = keywordAddForm.querySelector("[name='keywordAddMatchMode']:checked");
  const editorTitle = getKeywordEditorTitle(fieldId);
  if (keywordAddTextInput && typeof keywordAddTextInput.setCustomValidity === "function") {
    keywordAddTextInput.setCustomValidity("");
  }
  addKeywordRuleRow(fieldId, {
    text: keywordText,
    matchMode: checkedMatchMode?.value
  });
  closeKeywordAddModal({ restoreFocus: false });
  setConfigFeedback(`${editorTitle}已新增，点击保存后生效。`, false, {
    type: "success",
    title: "关键词已新增"
  });
}

function bindKeywordAddModalActions() {
  // 这里只绑定新增关键词小弹窗，确保所有关键词分类都走同一套新增体验。
  if (!keywordAddModal || !keywordAddForm) {
    return;
  }

  keywordAddForm.addEventListener("submit", submitKeywordAddModal);
  [keywordAddCloseButton, keywordAddCancelButton].filter(Boolean).forEach((button) => {
    button.addEventListener("click", () => closeKeywordAddModal());
  });
  keywordAddModal.addEventListener("click", (event) => {
    if (event.target === keywordAddModal) {
      closeKeywordAddModal();
    }
  });
  if (keywordAddTextInput) {
    keywordAddTextInput.addEventListener("input", () => {
      if (typeof keywordAddTextInput.setCustomValidity === "function") {
        keywordAddTextInput.setCustomValidity("");
      }
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isKeywordAddModalVisible()) {
      return;
    }
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    closeKeywordAddModal();
  });
}
