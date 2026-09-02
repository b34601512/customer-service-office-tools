(() => {
  const STORAGE_KEY = "refund_reminder_note_presets_v1";
  const DEFAULT_PRESETS = ["已通知拦截"];
  const MAX_CUSTOM_PRESETS = 20;
  let activeDialog = null;

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function formatLocalDateTime(date = new Date()) {
    // 该函数只负责生成客服备注里需要的一致时间格式。
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    return `${year}年${month}月${day}日 ${hour}:${minute}:${second}`;
  }

  function loadCustomPresets() {
    // 该函数只负责读取自定义备注选项，读不到时直接返回空列表。
    try {
      const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return uniquePresets(raw);
    } catch (_error) {
      return [];
    }
  }

  function saveCustomPresets(items) {
    // 该函数只负责持久化自定义备注选项，默认选项不写入存储。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(uniquePresets(items).slice(0, MAX_CUSTOM_PRESETS)));
  }

  function uniquePresets(items) {
    const output = [];
    const seen = new Set(DEFAULT_PRESETS);
    items.forEach((item) => {
      const text = normalizeText(item);
      if (!text || seen.has(text)) return;
      seen.add(text);
      output.push(text);
    });
    return output;
  }

  function buildFinalNote(baseText, includeTime) {
    // 该函数只负责按勾选状态把备注正文和当前时间组合起来。
    const text = normalizeText(baseText);
    if (!includeTime) return text;
    const timeText = formatLocalDateTime();
    return text ? `${text}，${timeText}` : timeText;
  }

  function createButton(text, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    return button;
  }

  function open(options = {}) {
    // 该函数打开备注面板并返回用户最终选择的备注文本。
    if (activeDialog) activeDialog.close(null);
    return new Promise((resolve) => {
      activeDialog = createDialog(options, (value) => {
        activeDialog = null;
        resolve(value);
      });
    });
  }

  function createDialog(options, done) {
    const root = document.createElement("div");
    let editingPresetText = "";
    root.className = "note-dialog-backdrop";
    root.innerHTML = `
      <section class="note-dialog" role="dialog" aria-modal="true" aria-labelledby="noteDialogTitle">
        <div class="note-dialog-head">
          <strong id="noteDialogTitle">订单备注</strong>
          <button type="button" class="note-dialog-close" title="关闭备注面板">关闭</button>
        </div>
        <div class="note-dialog-body">
          <div class="note-preset-list" data-note-presets></div>
          <label class="note-time-toggle"><input type="checkbox" data-note-include-time checked /> 保存时追加当前时间</label>
          <textarea class="note-textarea" data-note-text rows="4" maxlength="200"></textarea>
          <div class="note-custom-row">
            <input type="text" data-note-custom-input maxlength="60" placeholder="新增自定义备注选项" />
            <button type="button" data-note-add-custom>添加选项</button>
            <button type="button" data-note-cancel-edit hidden>取消编辑</button>
          </div>
        </div>
        <div class="note-dialog-actions">
          <button type="button" data-note-clear>清空备注</button>
          <button type="button" data-note-cancel>取消</button>
          <button type="button" class="primary" data-note-save>保存备注</button>
        </div>
      </section>`;

    const textarea = root.querySelector("[data-note-text]");
    const includeTimeInput = root.querySelector("[data-note-include-time]");
    const presetList = root.querySelector("[data-note-presets]");
    const customInput = root.querySelector("[data-note-custom-input]");
    const addButton = root.querySelector("[data-note-add-custom]");
    textarea.value = normalizeText(options.currentNote);

    function close(value) {
      root.remove();
      done(value);
    }

    function renderPresets() {
      presetList.innerHTML = "";
      DEFAULT_PRESETS.forEach((text) => presetList.appendChild(createPresetButton(text, false)));
      loadCustomPresets().forEach((text) => presetList.appendChild(createPresetButton(text, true)));
    }

    function createPresetButton(text, custom) {
      const item = document.createElement("span");
      item.className = "note-preset-item";
      const presetButton = createButton(text, "note-preset-button");
      presetButton.title = `一键填入备注：${text}`;
      presetButton.addEventListener("click", () => {
        textarea.value = text;
        textarea.focus();
      });
      item.appendChild(presetButton);
      if (custom) {
        const editButton = createButton("编辑", "note-preset-edit");
        editButton.title = `编辑自定义备注选项：${text}`;
        editButton.addEventListener("click", () => startEditCustomPreset(text));
        item.appendChild(editButton);

        const removeButton = createButton("删除", "note-preset-remove");
        removeButton.title = `删除自定义备注选项：${text}`;
        removeButton.addEventListener("click", () => {
          saveCustomPresets(loadCustomPresets().filter((itemText) => itemText !== text));
          if (editingPresetText === text) cancelEditCustomPreset();
          renderPresets();
        });
        item.appendChild(removeButton);
      }
      return item;
    }

    function saveCustomPreset() {
      const text = normalizeText(customInput.value);
      if (!text) {
        setTemporaryButtonState(addButton, "未填写", "请先填写备注选项。", "error");
        return;
      }
      if (text.length > 60) {
        setTemporaryButtonState(addButton, "过长", "备注选项不能超过 60 个字。", "error");
        return;
      }
      const currentPresets = loadCustomPresets();
      const existing = new Set([...DEFAULT_PRESETS, ...currentPresets.filter((item) => item !== editingPresetText)]);
      if (existing.has(text)) {
        setTemporaryButtonState(addButton, "已存在", "该备注选项已经存在。", "success");
        return;
      }
      const nextPresets = editingPresetText
        ? currentPresets.map((item) => item === editingPresetText ? text : item)
        : [...currentPresets, text];
      saveCustomPresets(nextPresets);
      customInput.value = "";
      editingPresetText = "";
      syncCustomEditState();
      renderPresets();
      setTemporaryButtonState(addButton, "已保存", "自定义备注选项已保存，下次可直接一键使用。", "success");
    }

    function startEditCustomPreset(text) {
      editingPresetText = text;
      customInput.value = text;
      customInput.focus();
      syncCustomEditState();
    }

    function cancelEditCustomPreset() {
      editingPresetText = "";
      customInput.value = "";
      syncCustomEditState();
    }

    function syncCustomEditState() {
      const cancelButton = root.querySelector("[data-note-cancel-edit]");
      addButton.textContent = editingPresetText ? "保存修改" : "添加选项";
      addButton.title = editingPresetText ? `保存对「${editingPresetText}」的修改` : "新增自定义备注选项";
      addButton.dataset.originalText = addButton.textContent;
      addButton.dataset.originalTitle = addButton.title;
      cancelButton.hidden = !editingPresetText;
    }

    root.querySelector("[data-note-save]").addEventListener("click", () => close(buildFinalNote(textarea.value, includeTimeInput.checked)));
    root.querySelector("[data-note-clear]").addEventListener("click", () => close(""));
    root.querySelector("[data-note-cancel]").addEventListener("click", () => close(null));
    root.querySelector(".note-dialog-close").addEventListener("click", () => close(null));
    root.querySelector("[data-note-cancel-edit]").addEventListener("click", cancelEditCustomPreset);
    addButton.addEventListener("click", saveCustomPreset);
    customInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveCustomPreset();
      }
    });
    root.addEventListener("click", (event) => {
      if (event.target === root) close(null);
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close(null);
    });

    document.body.appendChild(root);
    syncCustomEditState();
    renderPresets();
    textarea.focus();
    return { close };
  }

  function setTemporaryButtonState(button, text, title, state) {
    window.buttonFeedback.setButtonState(button, { text, title, state, timeout: 2200 });
  }

  window.noteDialogModule = {
    buildFinalNote,
    formatLocalDateTime,
    loadCustomPresets,
    open,
  };
})();
