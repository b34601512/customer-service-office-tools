// 该文件用于维护漏回复关键词逐行编辑器。
function createNotificationGroupDraft(input = {}) {
  // 这里统一生成通知群草稿，避免新增、删除和回填时各自拼字段。
  notificationGroupSerial += 1;
  return {
    id: String(input.id || `notification_group_${Date.now()}_${notificationGroupSerial}`),
    name: String(input.name || "").trim(),
    webhookUrl: String(input.webhookUrl || "").trim(),
    enabled: input.enabled !== false
  };
}

function createStaffDraft(input = {}) {
  // 这里统一生成成员草稿，让成员清单新增和旧配置迁移走同一套结构。
  staffDirectorySerial += 1;
  return {
    id: String(input.id || `staff_${Date.now()}_${staffDirectorySerial}`),
    name: String(input.name || "").trim(),
    mobile: String(input.mobile || "").trim(),
    userId: String(input.userId || "").trim(),
    inlineMentionEnabled: input.inlineMentionEnabled !== false
  };
}

function updateCheckboxHint(checkbox, checkedText = "启用中", uncheckedText = "已关闭") {
  // 这里统一刷新勾选项状态文案，避免保存前用户看不出当前到底开着还是关着。
  const hint = checkbox?.closest(".checkbox-row")?.querySelector("em");
  if (!hint) {
    return;
  }

  hint.textContent = checkbox.checked ? checkedText : uncheckedText;
}

function getKeywordEditorConfig(fieldId) {
  // 这里按字段找到对应编辑器配置，新增关键词行时才能使用正确默认匹配方式。
  return KEYWORD_EDITOR_CONFIGS.find((item) => item.fieldId === fieldId) || {
    fieldId,
    defaultMatchMode: "exact"
  };
}

function normalizeKeywordMatchMode(value, fallback = "exact") {
  // 这里统一识别中英文匹配方式，避免旧配置和新单选项混在一起时保存走偏。
  const rawValue = String(value || "").trim();
  if (KEYWORD_MATCH_MODE_LABELS[rawValue]) {
    return rawValue;
  }
  if (KEYWORD_MATCH_MODE_BY_LABEL[rawValue]) {
    return KEYWORD_MATCH_MODE_BY_LABEL[rawValue];
  }
  if (KEYWORD_MATCH_MODE_LABELS[fallback]) {
    return fallback;
  }

  return "exact";
}

function formatKeywordRuleLine(item) {
  // 这里把服务端规则显示成“关键词 | 匹配方式”，主管复制修改时不会丢失匹配方式。
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return String(item || "").trim();
  }

  const text = String(item.text || item.keyword || item.value || item.label || "").trim();
  if (!text) {
    return "";
  }

  const matchMode = normalizeKeywordMatchMode(item.matchMode, "exact");
  return `${text} | ${KEYWORD_MATCH_MODE_LABELS[matchMode]}`;
}

function parseKeywordRuleLine(line, defaultMatchMode = "exact") {
  // 这里兼容旧的“关键词 | 匹配方式”文本格式，保证历史配置能直接迁移到逐行编辑器。
  const rawLine = String(line || "").trim();
  if (!rawLine) {
    return null;
  }

  const [textPart, ...matchModeParts] = rawLine.split(/[|｜]/);
  const text = String(textPart || "").trim();
  if (!text) {
    return null;
  }

  return {
    text,
    matchMode: normalizeKeywordMatchMode(matchModeParts.join("|"), defaultMatchMode)
  };
}

function normalizeKeywordRuleForEditor(item, defaultMatchMode = "exact") {
  // 这里把数组配置和旧文本配置都转成同一种行结构，界面只管渲染这一种结构。
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const text = String(item.text || item.keyword || item.value || item.label || "").trim();
    if (!text) {
      return null;
    }

    return {
      text,
      matchMode: normalizeKeywordMatchMode(item.matchMode, defaultMatchMode)
    };
  }

  return parseKeywordRuleLine(item, defaultMatchMode);
}

function normalizeKeywordRulesForEditor(value, defaultMatchMode = "exact") {
  // 这里统一把配置源整理成关键词行，空行直接丢掉，避免保存垃圾配置。
  const sourceItems = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return sourceItems
    .map((item) => normalizeKeywordRuleForEditor(item, defaultMatchMode))
    .filter(Boolean);
}

function findKeywordRowsElement(fieldId) {
  // 这里集中查找关键词行容器，便于首页弹窗和独立设置页共用同一套脚本。
  const selector = `[data-keyword-rows="${fieldId}"]`;
  if (configModal && typeof configModal.querySelector === "function") {
    const modalRowsElement = configModal.querySelector(selector);
    if (modalRowsElement) {
      return modalRowsElement;
    }
  }
  if (typeof document.querySelector === "function") {
    return document.querySelector(selector);
  }

  return null;
}

function findKeywordEditorElement(fieldId) {
  // 这里集中查找关键词编辑器，新增弹窗需要从当前编辑器拿到分类标题。
  const selector = `[data-keyword-editor="${fieldId}"]`;
  if (configModal && typeof configModal.querySelector === "function") {
    const modalEditorElement = configModal.querySelector(selector);
    if (modalEditorElement) {
      return modalEditorElement;
    }
  }
  if (typeof document.querySelector === "function") {
    return document.querySelector(selector);
  }

  return null;
}

function getKeywordEditorTitle(fieldId) {
  // 这里只读取用户能看到的分类名称，避免新增弹窗写死某一类关键词。
  const editorElement = findKeywordEditorElement(fieldId);
  return String(editorElement?.querySelector(".keyword-rule-editor-head strong")?.textContent || "关键词").trim();
}

function buildKeywordRuleRowHtml(fieldId, rule, index) {
  // 这里把每个关键词做成独立行，匹配方式用原生单选项，减少主管理解成本。
  const normalizedMatchMode = normalizeKeywordMatchMode(rule.matchMode, getKeywordEditorConfig(fieldId).defaultMatchMode);
  const radioName = `${fieldId}_${index}_matchMode`;
  const matchModeHtml = KEYWORD_MATCH_MODE_OPTIONS.map((option) => `
        <label class="keyword-rule-radio">
          <input
            data-keyword-match-mode
            name="${escapeConfigHtml(radioName)}"
            type="radio"
            value="${escapeConfigHtml(option.value)}"
            ${normalizedMatchMode === option.value ? "checked" : ""}
          />
          <span>${escapeConfigHtml(option.label)}</span>
        </label>
      `).join("");

  return `
    <article class="keyword-rule-row" data-keyword-row>
      <label class="keyword-rule-text">
        <span>关键词 ${index + 1}</span>
        <input data-keyword-text value="${escapeConfigHtml(rule.text || "")}" placeholder="例如：稍等" />
      </label>
      <fieldset class="keyword-rule-modes">
        <legend>匹配方式</legend>
        <div class="keyword-rule-radio-group">
          ${matchModeHtml}
        </div>
      </fieldset>
      <button class="mini-button mini-button-danger" data-keyword-remove type="button">删除</button>
    </article>
  `;
}

function renderKeywordEditor(fieldId, rules) {
  // 这里只负责把关键词规则画到页面上，实际保存仍通过隐藏文本域走原配置链路。
  const rowsElement = findKeywordRowsElement(fieldId);
  if (!rowsElement) {
    return;
  }

  const config = getKeywordEditorConfig(fieldId);
  const normalizedRules = normalizeKeywordRulesForEditor(rules, config.defaultMatchMode);
  const visibleRules = normalizedRules.length > 0 ? normalizedRules : [
    {
      text: "",
      matchMode: config.defaultMatchMode
    }
  ];
  rowsElement.innerHTML = visibleRules
    .map((rule, index) => buildKeywordRuleRowHtml(fieldId, rule, index))
    .join("");
}

function collectKeywordEditorRules(fieldId, options = {}) {
  // 这里从逐行编辑器收集关键词，保存时只保留真正填写了内容的行。
  const rowsElement = findKeywordRowsElement(fieldId);
  if (!rowsElement || typeof rowsElement.querySelectorAll !== "function") {
    return [];
  }

  const config = getKeywordEditorConfig(fieldId);
  const keepBlankRows = Boolean(options.keepBlankRows);
  return Array.from(rowsElement.querySelectorAll("[data-keyword-row]"))
    .map((row) => {
      const textInput = row.querySelector("[data-keyword-text]");
      const checkedMatchMode = row.querySelector("[data-keyword-match-mode]:checked");
      return {
        text: String(textInput?.value || "").trim(),
        matchMode: normalizeKeywordMatchMode(checkedMatchMode?.value, config.defaultMatchMode)
      };
    })
    .filter((rule) => keepBlankRows || rule.text);
}

function syncKeywordEditorToTextarea(fieldId) {
  // 这里把逐行编辑器同步回隐藏文本域，让后端继续按原来的格式解析配置。
  const textarea = document.getElementById(fieldId);
  const rowsElement = findKeywordRowsElement(fieldId);
  if (!textarea || !rowsElement) {
    return;
  }

  textarea.value = collectKeywordEditorRules(fieldId)
    .map((rule) => formatKeywordRuleLine(rule))
    .filter(Boolean)
    .join("\n");
}

function syncAllKeywordEditorsToTextareas() {
  // 这里在保存前统一同步，避免用户刚输入完还没触发失焦就提交导致漏保存。
  KEYWORD_EDITOR_CONFIGS.forEach((config) => {
    syncKeywordEditorToTextarea(config.fieldId);
  });
}

function setKeywordEditorValue(fieldId, value) {
  // 这里统一回填隐藏文本域和逐行编辑器，保存后页面不会停留在旧值。
  const config = getKeywordEditorConfig(fieldId);
  const rules = normalizeKeywordRulesForEditor(value, config.defaultMatchMode);
  const textarea = document.getElementById(fieldId);
  if (textarea) {
    textarea.value = rules
      .map((rule) => formatKeywordRuleLine(rule))
      .filter(Boolean)
      .join("\n");
  }
  renderKeywordEditor(fieldId, rules);
}

function addKeywordRuleRow(fieldId, ruleInput = {}) {
  // 这里只负责把弹窗确认后的关键词写回当前编辑器，新增入口不再直接改页面结构。
  const config = getKeywordEditorConfig(fieldId);
  const keywordText = String(ruleInput.text || "").trim();
  const rules = collectKeywordEditorRules(fieldId, { keepBlankRows: !keywordText });
  rules.push({
    text: keywordText,
    matchMode: normalizeKeywordMatchMode(ruleInput.matchMode, config.defaultMatchMode)
  });
  renderKeywordEditor(fieldId, rules);
  syncKeywordEditorToTextarea(fieldId);

  const rowsElement = findKeywordRowsElement(fieldId);
  const textInputs = rowsElement ? rowsElement.querySelectorAll("[data-keyword-text]") : [];
  const lastInput = textInputs[textInputs.length - 1];
  if (lastInput && typeof lastInput.focus === "function") {
    lastInput.focus();
  }
}
