function splitBuyerUrls(text) {
  // 该函数用于把买家咨询链接按行清洗成唯一列表，弹窗和保存走同一套规则。
  const urls = [];
  const seen = new Set();
  String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .forEach((item) => {
      const url = item.trim();
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    });
  return urls;
}

function normalizeBuyerUrlEntries(entries = [], selectedUrl = "") {
  // 该函数用于统一清理链接和备注，保证前端状态、保存 payload 和后端规则一致。
  const out = [];
  const seen = new Set();
  entries.forEach((entry) => {
    const url = String(entry?.url || "").trim();
    const note = String(entry?.note || "").trim();
    if (!url && !note) return;
    if (url) {
      if (seen.has(url)) return;
      seen.add(url);
    }
    out.push({ url, note });
  });
  const selected = String(selectedUrl || "").trim();
  if (selected && !seen.has(selected)) {
    out.unshift({ url: selected, note: "" });
  }
  return out;
}

function syncBuyerUrlStateFromForm(form = {}) {
  // 该函数用于把后端表单数据同步成本地弹窗状态，避免弹窗和真实保存字段分叉。
  const rawEntries = Array.isArray(form.jd_url_entries)
    ? form.jd_url_entries
    : splitBuyerUrls(form.jd_urls || "").map((url) => ({ url, note: "" }));
  const selectedUrl = String(form.jd_url || "").trim();
  const entries = normalizeBuyerUrlEntries(rawEntries, selectedUrl);
  buyerUrlState.selectedUrl = selectedUrl || entries.find((entry) => entry.url)?.url || "";
  buyerUrlState.entries = entries;
}

function normalizeBuyerUrlDraft() {
  // 该函数用于应用弹窗内容时去空、去重，并保证当前单选链接仍在链接库里。
  const selectedText = String(buyerUrlDraftRows[buyerUrlDraftSelectedIndex]?.url || "").trim();
  const entries = normalizeBuyerUrlEntries(buyerUrlDraftRows, "");
  const firstUrl = entries.find((entry) => entry.url)?.url || "";
  const previousSelectedUrl = String(buyerUrlState.selectedUrl || "").trim();
  const previousStillExists = previousSelectedUrl && entries.some((entry) => entry.url === previousSelectedUrl);
  const selectedUrl = selectedText && entries.some((entry) => entry.url === selectedText) ? selectedText : previousStillExists ? previousSelectedUrl : firstUrl;
  return { entries, selectedUrl };
}

function buyerUrlLabel(entry, index) {
  const note = String(entry?.note || "").trim();
  return note || `链接${index + 1}`;
}

function describeBuyerUrlState() {
  const selectedIndex = Math.max(0, buyerUrlState.entries.findIndex((entry) => entry.url === buyerUrlState.selectedUrl));
  if (!buyerUrlState.selectedUrl) {
    return buyerUrlState.entries.length > 0 ? `已记录 ${buyerUrlState.entries.length} 个店铺，未填写可用链接` : "未配置买家咨询链接";
  }
  return `当前使用：${buyerUrlLabel(buyerUrlState.entries[selectedIndex], selectedIndex)}｜共 ${buyerUrlState.entries.length} 个`;
}

function updateBuyerUrlManagerView() {
  if (!buyerUrlSummaryElement) return;
  const current = buyerUrlState.selectedUrl || "未选择";
  buyerUrlSummaryElement.innerHTML = `
    <span>${escapeHtml(describeBuyerUrlState())}</span>
    <strong title="${escapeHtml(current)}">${escapeHtml(current)}</strong>
  `;
}

function buildBuyerUrlManager(def) {
  const row = document.createElement("div");
  row.className = `form-row buyer-url-manager${def.wide ? " wide-row" : ""}`;
  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = def.label;
  const body = document.createElement("div");
  body.className = "buyer-url-manager-body";
  buyerUrlSummaryElement = document.createElement("div");
  buyerUrlSummaryElement.className = "buyer-url-summary";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "管理链接";
  button.addEventListener("click", openBuyerUrlDialog);
  body.appendChild(buyerUrlSummaryElement);
  body.appendChild(button);
  row.appendChild(label);
  row.appendChild(body);
  updateBuyerUrlManagerView();
  return row;
}

function setBuyerUrlDialogFeedback(message, state = "info") {
  if (!buyerUrlDialogFeedback) return;
  buyerUrlDialogFeedback.textContent = message || "";
  buyerUrlDialogFeedback.dataset.state = state;
}

function renderBuyerUrlDialog() {
  if (!buyerUrlList) return;
  buyerUrlList.innerHTML = "";
  buyerUrlDraftRows.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "buyer-url-item";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "buyerUrlActive";
    radio.checked = index === buyerUrlDraftSelectedIndex;
    radio.addEventListener("change", () => {
      buyerUrlDraftSelectedIndex = index;
      renderBuyerUrlDialog();
    });

    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.className = "buyer-url-note-input";
    noteInput.value = entry.note || "";
    noteInput.placeholder = "店铺备注";
    noteInput.addEventListener("input", (event) => {
      buyerUrlDraftRows[index].note = event.currentTarget.value;
    });

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "buyer-url-link-input";
    urlInput.value = entry.url || "";
    urlInput.placeholder = "粘贴店铺链接";
    urlInput.addEventListener("input", (event) => {
      buyerUrlDraftRows[index].url = event.currentTarget.value;
    });
    urlInput.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text") || "";
      const pastedUrls = splitBuyerUrls(text);
      if (pastedUrls.length <= 1) return;
      event.preventDefault();
      buyerUrlDraftRows.splice(index, 1, ...pastedUrls.map((url) => ({ url, note: "" })));
      buyerUrlDraftSelectedIndex = index;
      renderBuyerUrlDialog();
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "small-danger";
    removeButton.textContent = "删除";
    removeButton.disabled = buyerUrlDraftRows.length <= 1;
    removeButton.addEventListener("click", () => {
      buyerUrlDraftRows.splice(index, 1);
      buyerUrlDraftSelectedIndex = Math.min(buyerUrlDraftSelectedIndex, buyerUrlDraftRows.length - 1);
      renderBuyerUrlDialog();
    });

    item.appendChild(radio);
    item.appendChild(noteInput);
    item.appendChild(urlInput);
    item.appendChild(removeButton);
    buyerUrlList.appendChild(item);
  });
}

function openBuyerUrlDialog() {
  if (!buyerUrlOverlay) return;
  buyerUrlDraftRows = buyerUrlState.entries.length > 0 ? buyerUrlState.entries.map((entry) => ({ ...entry })) : [{ url: buyerUrlState.selectedUrl || "", note: "" }];
  buyerUrlDraftSelectedIndex = Math.max(0, buyerUrlDraftRows.findIndex((entry) => entry.url === buyerUrlState.selectedUrl));
  setBuyerUrlDialogFeedback("", "info");
  renderBuyerUrlDialog();
  buyerUrlOverlay.classList.remove("hidden");
}

function addBuyerUrlRow() {
  buyerUrlDraftRows.push({ url: "", note: "" });
  buyerUrlDraftSelectedIndex = buyerUrlDraftRows.length - 1;
  renderBuyerUrlDialog();
}

function commitBuyerUrlDraft() {
  // 该函数用于把弹窗草稿同步到真实表单状态；关闭弹窗和点击应用都走这里，避免输入丢失。
  const normalized = normalizeBuyerUrlDraft();
  if (normalized.entries.length === 0) {
    setBuyerUrlDialogFeedback("买家咨询链接不能为空，请至少填写一个店铺链接。", "error");
    return false;
  }
  buyerUrlState.selectedUrl = normalized.selectedUrl;
  buyerUrlState.entries = normalized.entries;
  window.latestForm = {
    ...(window.latestForm || {}),
    jd_url: buyerUrlState.selectedUrl,
    jd_urls: buyerUrlState.entries.map((entry) => entry.url).filter(Boolean).join("\n"),
    jd_url_options: buyerUrlState.entries.map((entry) => entry.url).filter(Boolean),
    jd_url_entries: buyerUrlState.entries.map((entry) => ({ ...entry })),
  };
  updateBuyerUrlManagerView();
  return true;
}

async function closeBuyerUrlDialog(options = {}) {
  if (!buyerUrlOverlay) return false;
  const saveDraft = options.saveDraft !== false;
  if (saveDraft && !commitBuyerUrlDraft()) {
    return false;
  }
  const persist = options.persist !== false;
  if (persist) {
    try {
      await saveBuyerUrlConfig();
      setFeedback("买家咨询店铺信息已保存。", "success");
    } catch (error) {
      setBuyerUrlDialogFeedback(`保存失败：${error.message}`, "error");
      setFeedback(error.message, "error");
      return false;
    }
  }
  buyerUrlOverlay.classList.add("hidden");
  return true;
}

async function applyBuyerUrlDialog() {
  if (!commitBuyerUrlDraft()) {
    return;
  }
  await closeBuyerUrlDialog({ saveDraft: false });
}
