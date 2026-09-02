function buildField(def, value) {
  if (def.type === "buyerUrls") {
    return buildBuyerUrlManager(def);
  }
  if (def.type === "credentials") {
    return buildCredentialManager(def);
  }
  const row = document.createElement("label");
  row.className = `${def.type === "checkbox" ? "form-row checkbox-row" : "form-row"}${def.wide ? " wide-row" : ""}`;
  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = def.hint ? `${def.label}（${def.hint}）` : def.label;
  row.appendChild(label);
  if (def.type === "checkbox") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = def.key;
    input.checked = Boolean(value);
    row.appendChild(input);
    return row;
  }
  if (def.type === "select") {
    const select = document.createElement("select");
    select.name = def.key;
    const options = Array.isArray(window.latestForm?.[def.optionsKey]) ? window.latestForm[def.optionsKey] : [];
    const values = options.length > 0 ? options : [value].filter(Boolean);
    values.forEach((optionValue, index) => {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = `链接${index + 1}：${optionValue}`;
      option.selected = optionValue === value;
      select.appendChild(option);
    });
    select.value = value ?? "";
    row.appendChild(select);
    return row;
  }
  if (def.type === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.name = def.key;
    textarea.rows = 6;
    textarea.value = value ?? "";
    row.appendChild(textarea);
    return row;
  }
  const input = document.createElement("input");
  input.type = def.type || "text";
  input.name = def.key;
  input.value = value ?? "";
  row.appendChild(input);
  return row;
}

function renderForm(form) {
  window.latestForm = form || {};
  syncBuyerUrlStateFromForm(window.latestForm);
  syncCredentialStateFromForm(window.latestForm);
  if (!configForm) {
    updateBuyerUrlManagerView();
    updateCredentialManagerView("service");
    updateCredentialManagerView("web");
    return;
  }
  configForm.innerHTML = "";
  fieldDefs.forEach((def) => {
    configForm.appendChild(buildField(def, window.latestForm[def.key]));
  });
  const tip = document.createElement("p");
  tip.className = "form-tip";
  tip.textContent = "多值格式统一用英文逗号分隔，例如 0.5,0.86 / 3,5 / 60,60；当前版本固定走内置内容直连发送。";
  configForm.appendChild(tip);
}

function collectForm() {
  const payload = {};
  fieldDefs.forEach((def) => {
    if (def.type === "buyerUrls" || def.type === "credentials") {
      return;
    }
    const field = configForm?.querySelector(`[name="${def.key}"]`);
    if (field) {
      payload[def.key] = def.type === "checkbox" ? field.checked : field.value;
      return;
    }
    payload[def.key] = window.latestForm?.[def.key] ?? "";
  });
  payload.jd_url = buyerUrlState.selectedUrl;
  payload.jd_url_entries = buyerUrlState.entries.map((entry) => ({ url: entry.url, note: entry.note }));
  payload.jd_urls = buyerUrlState.entries.map((entry) => entry.url).filter(Boolean).join("\n");
  payload.service_username = credentialState.service.selected.username;
  payload.service_password = credentialState.service.selected.password;
  payload.service_credential_entries = credentialState.service.entries.map((entry) => ({ username: entry.username, password: entry.password, note: entry.note }));
  payload.web_username = credentialState.web.selected.username;
  payload.web_password = credentialState.web.selected.password;
  payload.web_credential_entries = credentialState.web.entries.map((entry) => ({ username: entry.username, password: entry.password, note: entry.note }));
  return payload;
}
