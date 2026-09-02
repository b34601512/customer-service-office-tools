const { clickLocatorWhenReady } = require("../../shared/browserActionEngine");

function normalizeScope(scope) {
  const mode = String(scope?.mode || "客服岗位").trim() || "客服岗位";
  const values = Array.isArray(scope?.values)
    ? scope.values.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!values.length) {
    throw new Error("京东下载失败：客服筛选没有配置目标岗位或客服组。");
  }
  return { mode, values: [...new Set(values)] };
}

async function findCustomerScopeRow(surface) {
  const label = surface.getByText("客服范围", { exact: true }).first();
  if ((await label.count()) === 0 || !(await label.isVisible())) {
    throw new Error("京东下载失败：没有找到“客服范围”筛选控件。");
  }
  let row = label;
  for (let level = 0; level < 6; level += 1) {
    const text = String(await row.innerText().catch(() => ""));
    if (text.includes("客服范围") && (text.includes("客服组") || text.includes("客服岗位"))) {
      return row;
    }
    row = row.locator("xpath=..");
  }
  throw new Error("京东下载失败：无法定位“客服范围”的筛选行。");
}

async function findScopeControls(row) {
  const typeControl = row.locator(".kf-manage-lite-select").filter({ has: row.locator("#type") }).first();
  const groupControl = row.locator(".kf-manage-lite-select").filter({ has: row.locator("#groupId") }).first();
  if (await typeControl.count() && await groupControl.count()) {
    return [typeControl, groupControl];
  }
  const candidates = row.locator(
    "input:not([type='hidden']), [role='combobox'], .el-select, .ant-select, [class*='select']"
  );
  const controls = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if ((await candidate.isVisible().catch(() => false)) && (await candidate.isEnabled().catch(() => true))) {
      controls.push(candidate);
    }
  }
  return controls;
}

async function clickExactVisibleOption(surface, value) {
  // 京东下拉层由前端异步挂载；点击类型控件后不能立即假设选项已经进入 DOM。
  const deadline = Date.now() + 10000;
  let lastCount = 0;
  while (Date.now() <= deadline) {
    const options = surface.getByText(value, { exact: true });
    lastCount = await options.count();
    for (let index = 0; index < lastCount; index += 1) {
      const option = options.nth(index);
      if (await option.isVisible().catch(() => false)) {
        await clickLocatorWhenReady(option, `京东客服筛选选项${value}`, { timeoutMs: 5000 });
        return;
      }
    }
    await surface.waitForTimeout(200);
  }
  throw new Error(`京东下载失败：客服筛选选项“${value}”没有出现（动态等待10秒，匹配节点数=${lastCount}）。`);
}

async function clickVisibleScopeOption(surface, value, { allowRoleGroupFallback = false } = {}) {
  try {
    await clickExactVisibleOption(surface, value);
    return value;
  } catch (error) {
    if (!allowRoleGroupFallback || value !== "售前") throw error;
  }

  const jdOptions = surface.locator(".kf-manage-lite-select-item-option").filter({ hasText: "售前" });
  for (let index = 0; index < await jdOptions.count(); index += 1) {
    const candidate = jdOptions.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const text = String(await candidate.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    await candidate.click({ force: true, timeout: 5000 });
    return text;
  }

  const textMatches = surface.getByText("售前", { exact: false });
  for (let index = (await textMatches.count()) - 1; index >= 0; index -= 1) {
    const candidate = textMatches.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const text = String(await candidate.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (text.includes("售前")) {
      await clickLocatorWhenReady(candidate, `京东客服组${text}`, { timeoutMs: 5000 });
      return text;
    }
  }

  const candidates = surface.locator(
    "[role='option'], .el-select-dropdown__item, .ant-select-item-option, .ant-select-item-option-content, li, [class*='dropdown'] [class*='item'], [class*='option']"
  );
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const text = String(await candidate.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (text.includes("售前")) {
      await clickLocatorWhenReady(candidate, `京东客服组${text}`, { timeoutMs: 5000 });
      return text;
    }
  }
  throw error;
}

async function clickVisibleDropdownText(surface, value) {
  const jdOptions = surface.locator(".kf-manage-lite-select-item-option").filter({ hasText: value });
  for (let index = 0; index < await jdOptions.count(); index += 1) {
    const candidate = jdOptions.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ force: true, timeout: 5000 });
      return;
    }
  }
  const textMatches = surface.getByText(value, { exact: true });
  for (let index = (await textMatches.count()) - 1; index >= 0; index -= 1) {
    const candidate = textMatches.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await clickLocatorWhenReady(candidate, `京东客服范围类型${value}`, { timeoutMs: 5000 });
      return;
    }
  }
  const candidates = surface.locator(
    "[role='option'], .el-select-dropdown__item, .ant-select-item-option, .ant-select-item-option-content, li, [class*='dropdown'] [class*='item'], [class*='option']"
  );
  const deadline = Date.now() + 10000;
  while (Date.now() <= deadline) {
    for (let index = 0; index < await candidates.count(); index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const text = String(await candidate.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (text === value) {
        await clickLocatorWhenReady(candidate, `京东客服范围类型${value}`, { timeoutMs: 5000 });
        return;
      }
    }
    await surface.waitForTimeout(200);
  }
  throw new Error(`京东下载失败：客服筛选选项“${value}”没有出现（下拉选项节点未找到）。`);
}

async function clickCustomerScopeMode(surface, requestedMode) {
  try {
    await clickExactVisibleOption(surface, requestedMode);
    return requestedMode;
  } catch (error) {
    if (requestedMode !== "客服岗位") throw error;
  }
  // 当前京东页面默认就停在“客服组”；菜单只是在展示可选类型，直接沿用当前值更安全。
  const currentGroup = surface.getByText("客服组", { exact: true });
  if (await currentGroup.count()) {
    await clickLocatorWhenReady(currentGroup.first(), "京东当前客服组类型", { timeoutMs: 5000 });
    return "客服组";
  }
  await clickVisibleDropdownText(surface, "客服组");
  return "客服组";
}

async function clearSelectedScopeValues(row) {
  const closeButtons = row.locator(
    ".el-tag__close, .ant-select-selection-item-remove, [aria-label*='删除'], [aria-label*='移除'], [aria-label*='清除']"
  );
  for (let index = (await closeButtons.count()) - 1; index >= 0; index -= 1) {
    const closeButton = closeButtons.nth(index);
    if (await closeButton.isVisible().catch(() => false)) {
      await clickLocatorWhenReady(closeButton, "京东清除客服筛选残留", { timeoutMs: 5000 });
    }
  }
}

async function applyJdCustomerServiceScope(surface, scope) {
  const normalizedScope = normalizeScope(scope);
  const row = await findCustomerScopeRow(surface);
  let controls = await findScopeControls(row);
  if (controls.length < 2) {
    throw new Error("京东下载失败：“客服范围”控件结构异常，无法安全设置筛选。");
  }
  let effectiveMode;
  if (normalizedScope.mode === "客服岗位") {
    // 当前京东三家店页面的类型控件固定显示“客服组”；配置中的“客服岗位=售前”
    // 作为业务意图保留，实际通过客服组下的售前组完成筛选。
    await clickLocatorWhenReady(controls[0], "京东当前客服范围类型", { timeoutMs: 5000 });
    await clickVisibleDropdownText(surface, "客服组");
    effectiveMode = "客服组";
  } else {
    await clickLocatorWhenReady(controls[0], "京东客服范围类型", { timeoutMs: 5000 });
    effectiveMode = await clickCustomerScopeMode(surface, normalizedScope.mode);
  }
  await clearSelectedScopeValues(row);
  controls = await findScopeControls(row);
  await clickLocatorWhenReady(controls[1], "京东客服岗位或客服组", { timeoutMs: 5000 });
  // 客服组是可搜索多选框；部分账号不会自动展开选项，先输入业务关键词触发列表加载。
  const valueInput = controls[1].locator("input").first();
  if (await valueInput.count().catch(() => 0)) {
    await valueInput.fill(normalizedScope.values[0]).catch(() => {});
  }
  for (const value of normalizedScope.values) {
    await clickVisibleScopeOption(surface, value, {
      allowRoleGroupFallback: effectiveMode === "客服组"
    });
  }
  const actual = await readJdCustomerServiceScopeState(surface);
  return { ...actual, requestedMode: normalizedScope.mode, effectiveMode };
}

async function readJdCustomerServiceScopeState(surface) {
  const row = await findCustomerScopeRow(surface);
  const text = String(await row.innerText()).replace(/\s+/g, " ").trim();
  return {
    text,
    mode: text.includes("客服岗位") ? "客服岗位" : text.includes("客服组") ? "客服组" : "",
    valuesText: text
  };
}

function assertJdCustomerServiceScope(actual, expected) {
  const normalizedExpected = normalizeScope(expected);
  const actualMode = actual?.effectiveMode || actual?.mode;
  if (actualMode !== normalizedExpected.mode && !(normalizedExpected.mode === "客服岗位" && actualMode === "客服组")) {
    throw new Error(`京东下载已停止：客服筛选类型不一致，期望“${normalizedExpected.mode}”，实际“${actual?.mode || "未识别"}”。`);
  }
  const missingValues = normalizedExpected.values.filter((value) => {
    if (value === "售前" && actualMode === "客服组") return !String(actual?.valuesText || "").includes("售前");
    return !String(actual?.valuesText || "").includes(value);
  });
  if (missingValues.length) {
    throw new Error(`京东下载已停止：客服筛选未命中“${missingValues.join("、")}”，拒绝导出。`);
  }
}

module.exports = {
  normalizeScope,
  applyJdCustomerServiceScope,
  readJdCustomerServiceScopeState,
  assertJdCustomerServiceScope
};
