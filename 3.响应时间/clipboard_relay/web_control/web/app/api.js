async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `请求失败：${response.status}`);
  }
  return payload;
}

async function saveFullConfig() {
  const payload = await requestJson("/api/config/save", { method: "POST", body: JSON.stringify(collectForm()) });
  renderForm(payload.form);
  return payload;
}

async function saveBuyerUrlConfig() {
  const payload = await requestJson("/api/config/save-buyer-urls", {
    method: "POST",
    body: JSON.stringify({
      jd_url: buyerUrlState.selectedUrl,
      jd_urls: buyerUrlState.entries.map((entry) => entry.url).filter(Boolean).join("\n"),
      jd_url_entries: buyerUrlState.entries.map((entry) => ({ url: entry.url, note: entry.note })),
    }),
  });
  renderForm(payload.form);
  return payload;
}

async function saveCredentialConfig() {
  const payload = await requestJson("/api/config/save-credentials", {
    method: "POST",
    body: JSON.stringify({
      service_username: credentialState.service.selected.username,
      service_password: credentialState.service.selected.password,
      service_credential_entries: credentialState.service.entries.map((entry) => ({ username: entry.username, password: entry.password, note: entry.note })),
      web_username: credentialState.web.selected.username,
      web_password: credentialState.web.selected.password,
      web_credential_entries: credentialState.web.entries.map((entry) => ({ username: entry.username, password: entry.password, note: entry.note })),
    }),
  });
  renderForm(payload.form);
  return payload;
}

async function openLoginTarget(target) {
  if (isMainFlowControllable(window.latestRuntime || {})) {
    setFeedback("主流程运行中不能重新打开登录页，请先停止当前测试。", "error");
    return;
  }
  if (lockedLoginTargets.has(target)) {
    return;
  }
  lockedLoginTargets.add(target);
  pendingLoginTargets.add(target);
  renderIndicators(window.latestRuntime?.indicators || {});
  renderWorkflow(window.latestRuntime || {});
  try {
    setFeedback("正在打开登录页，请稍候，不要重复点击。", "info");
    await saveFullConfig();
    const payload = await requestJson("/api/login/open-target", { method: "POST", body: JSON.stringify({ target }) });
    pendingLoginTargets.delete(target);
    setFeedback(payload.message, "success");
  } catch (error) {
    pendingLoginTargets.delete(target);
    lockedLoginTargets.delete(target);
    renderIndicators(window.latestRuntime?.indicators || {});
    renderWorkflow(window.latestRuntime || {});
    setFeedback(error.message, "error");
  }
}
