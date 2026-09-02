const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  readIndexHtml,
  readCssBundle,
  settingsScript,
  settingsHtmlPath,
  styleEntryPath,
  createIndexConfigModalHarness,
  createSettingsPageHarness
} = require("./controlCenterWebAppHelpers");

test("控制台首页应该只保留实时日志入口，不直接展示日志内容", () => {
  const indexHtml = readIndexHtml();

  assert.match(indexHtml, /data-route="\/logs"/);
  assert.doesNotMatch(indexHtml, /id="logOutput"/);
  assert.doesNotMatch(indexHtml, /data-log-channel/);
});

test("控制台首页应该使用树状流程并把配置中心放进弹窗", () => {
  const indexHtml = readIndexHtml();

  assert.match(indexHtml, /class="action-workflow" id="workflowGrid"/);
  assert.match(indexHtml, /class="workflow-tree"/);
  assert.match(indexHtml, /id="openConfigModalButton"/);
  assert.match(indexHtml, /id="configModal" class="config-modal hidden"/);
  assert.match(
    indexHtml,
    /<span class="workflow-dot">1<\/span>[\s\S]*<strong class="workflow-title">配置中心<\/strong>[\s\S]*<span class="workflow-dot">2<\/span>[\s\S]*<strong class="workflow-title">首次登录<\/strong>/
  );
  assert.doesNotMatch(indexHtml, /data-link="\/settings"/);
});

test("首页配置中心按钮应该在首页脚本同时存在时打开弹窗", () => {
  const { elements } = createIndexConfigModalHarness();

  elements.openConfigModalButton.events.click();

  assert.equal(elements.configModal.classList.contains("hidden"), false);
  assert.equal(elements.configModal.attributes["aria-hidden"], "false");
  assert.equal(elements.openConfigModalButton.attributes["aria-expanded"], "true");
});

test("控制台网页应该声明红底督字专属图标", () => {
  const pages = [
    readIndexHtml(),
    fs.readFileSync(settingsHtmlPath, "utf8"),
    fs.readFileSync(path.join(__dirname, "../../src/controlCenter/web/viewer.html"), "utf8"),
    fs.readFileSync(path.join(__dirname, "../../src/controlCenter/web/logs.html"), "utf8")
  ];
  const iconSvg = fs.readFileSync(
    path.join(__dirname, "../../src/controlCenter/web/assets/supervisor-icon.svg"),
    "utf8"
  );

  for (const pageHtml of pages) {
    assert.match(pageHtml, /<link rel="icon" href="\/assets\/supervisor-icon\.svg" type="image\/svg\+xml" \/>/);
    assert.match(pageHtml, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
    assert.match(pageHtml, /<meta name="theme-color" content="#d9252a" \/>/);
  }
  assert.match(iconSvg, /#d9252a/);
  assert.match(iconSvg, />督<\/text>/);
});

test("运行巡检应该用按钮打开客户倒计时明细弹窗", () => {
  const indexHtml = readIndexHtml();

  assert.match(indexHtml, /id="openCountdownModalButton"/);
  assert.match(indexHtml, /id="openCountdownModalButton"[\s\S]*id="countdownAttentionBadge"/);
  assert.match(indexHtml, /id="countdownModal"[\s\S]*id="customerMirrorList"/);
  assert.match(indexHtml, /id="customerMirrorDetailModal"[\s\S]*id="customerMirrorDetailBody"/);
  assert.match(indexHtml, /\/countdown\/customerMirrorDetailDialog\.js/);
  assert.match(indexHtml, /\/countdown\/customerMirrorList\.js/);
  assert.match(indexHtml, /id="openResourceUsageModalButton"/);
  assert.match(indexHtml, /id="resourceUsageModal"[\s\S]*id="resourceUsageSummary"[\s\S]*id="resourceUsageProcessList"/);
  assert.match(indexHtml, /客户判定列表/);
  assert.match(indexHtml, /系统完整联系人快照/);
  assert.doesNotMatch(indexHtml, /id="timeoutCountdownList"/);
  assert.doesNotMatch(indexHtml, /id="missedReplyCountdownList"/);
  assert.doesNotMatch(indexHtml, /id="missedReplyDecisionList"/);
  assert.doesNotMatch(indexHtml, /id="queueTotalCountValue"/);
  assert.doesNotMatch(indexHtml, /id="queueAvailableCountValue"/);
  assert.doesNotMatch(indexHtml, /id="queueOverdueCountValue"/);
  assert.doesNotMatch(indexHtml, /id="latestActionTitle"/);
  assert.doesNotMatch(indexHtml, /class="dashboard-grid"/);
  assert.doesNotMatch(indexHtml, /class="summary-grid"/);
});

test("倒计时明细按钮应该有右上角数字角标样式", () => {
  const styleCss = readCssBundle(styleEntryPath);

  assert.match(styleCss, /\.action-button\s*,[\s\S]*position: relative/);
  assert.match(styleCss, /\.action-button-badge\s*\{[\s\S]*position: absolute/);
  assert.match(styleCss, /\.action-button-badge\s*\{[\s\S]*top: -9px/);
  assert.match(styleCss, /\.action-button-badge\s*\{[\s\S]*right: -9px/);
  assert.match(styleCss, /\.action-button-badge\.hidden\s*\{[\s\S]*display: none/);
});

test("配置中心应该拆成目录入口和六个独立配置页", () => {
  const indexHtml = readIndexHtml();
  const paramsSection = indexHtml.match(/data-config-page="params"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(indexHtml, /data-config-page="hub"[\s\S]*data-config-page-target="params"[\s\S]*参数设置/);
  assert.match(indexHtml, /data-config-page="hub"[\s\S]*data-config-page-target="timeoutReminder"[\s\S]*超时提醒配置/);
  assert.match(indexHtml, /data-config-page="hub"[\s\S]*data-config-page-target="missedReply"[\s\S]*漏回复设置/);
  assert.match(indexHtml, /data-config-page="hub"[\s\S]*data-config-page-target="onlinePresence"[\s\S]*上班监控/);
  assert.match(indexHtml, /data-config-page="hub"[\s\S]*data-config-page-target="offDuty"[\s\S]*下班监控配置/);
  assert.match(indexHtml, /data-config-page="hub"[\s\S]*data-config-page-target="wecom"[\s\S]*企微提醒/);
  assert.match(indexHtml, /id="configForm" class="config-form-pages"/);
  assert.match(indexHtml, /data-config-page="params"[\s\S]*保存参数设置/);
  assert.doesNotMatch(indexHtml, /queueScanIntervalMs/);
  assert.doesNotMatch(indexHtml, /queueClickTimeoutMs/);
  assert.doesNotMatch(paramsSection, /timeoutReminderThresholdSeconds/);
  assert.doesNotMatch(paramsSection, /offDutyAutomationEnabled/);
  assert.match(indexHtml, /data-config-page="timeoutReminder"[\s\S]*id="timeoutReminderThresholdSeconds"[\s\S]*保存超时提醒配置/);
  assert.match(indexHtml, /data-config-page="onlinePresence"[\s\S]*id="onlinePresenceMonitorEnabled"[\s\S]*保存上班监控/);
  assert.match(indexHtml, /data-config-page="missedReply"[\s\S]*data-config-page-target="missedReplyRuntime"[\s\S]*运行参数/);
  assert.match(indexHtml, /data-config-page="missedReply"[\s\S]*data-config-page-target="missedReplyTemporaryKeywords"[\s\S]*稍等类关键词/);
  assert.match(indexHtml, /data-config-page="missedReply"[\s\S]*data-config-page-target="missedReplyResolutionKeywords"[\s\S]*客户主动结案/);
  assert.match(indexHtml, /data-config-page="missedReply"[\s\S]*data-config-page-target="missedReplyClosingKeywords"[\s\S]*客户弱收尾/);
  assert.match(indexHtml, /data-config-page="missedReply"[\s\S]*data-config-page-target="missedReplyInvalidKeywords"[\s\S]*无效人工回复/);
  assert.match(indexHtml, /data-config-page="missedReply"[\s\S]*data-config-page-target="missedReplyPlatformNoticeKeywords"[\s\S]*平台提示过滤/);
  assert.match(indexHtml, /data-config-page="missedReplyRuntime"[\s\S]*保存运行参数/);
  assert.doesNotMatch(indexHtml, /missedReplyRecentContactLimit/);
  assert.match(indexHtml, /data-config-page="missedReplyTemporaryKeywords"[\s\S]*保存稍等类关键词/);
  assert.match(indexHtml, /data-config-page="missedReplyResolutionKeywords"[\s\S]*保存客户主动结案/);
  assert.match(indexHtml, /data-config-page="missedReplyClosingKeywords"[\s\S]*保存客户弱收尾/);
  assert.match(indexHtml, /data-config-page="missedReplyInvalidKeywords"[\s\S]*保存无效人工回复/);
  assert.match(indexHtml, /data-config-page="missedReplyPlatformNoticeKeywords"[\s\S]*保存平台提示过滤/);
  assert.match(indexHtml, /data-config-page="offDuty"[\s\S]*id="offDutyAutomationEnabled"[\s\S]*保存下班监控配置/);
  assert.match(indexHtml, /data-config-page="wecom"[\s\S]*id="wecomConfigForm"/);
});

test("漏回复设置页应该只做分类入口，不直接堆具体配置", () => {
  const indexHtml = readIndexHtml();
  const missedReplyMenuSection = indexHtml.match(
    /data-config-page="missedReply"[\s\S]*?<\/section>/
  )?.[0] || "";

  assert.match(missedReplyMenuSection, /class="config-page-menu missed-reply-page-menu"/);
  assert.match(missedReplyMenuSection, /data-config-page-target="missedReplyRuntime"/);
  assert.doesNotMatch(missedReplyMenuSection, /id="missedReplyMonitorEnabled"/);
  assert.doesNotMatch(missedReplyMenuSection, /data-keyword-editor=/);
});

test("漏回复关键词应该使用逐行独立配置，不再暴露旧的大文本框", () => {
  const indexHtml = readIndexHtml();
  const settingsHtml = fs.readFileSync(settingsHtmlPath, "utf8");

  [indexHtml, settingsHtml].forEach((pageHtml) => {
    assert.match(pageHtml, /data-keyword-editor="missedReplyTemporaryReplyKeywords"/);
    assert.match(pageHtml, /data-keyword-editor="missedReplyCustomerResolutionKeywords"/);
    assert.match(pageHtml, /data-keyword-editor="missedReplyCustomerClosingKeywords"/);
    assert.match(pageHtml, /data-keyword-editor="missedReplyInvalidAgentReplyKeywords"/);
    assert.match(pageHtml, /data-keyword-editor="missedReplyPlatformNoticeKeywords"/);
    assert.match(pageHtml, /data-keyword-add="missedReplyTemporaryReplyKeywords"/);
    assert.match(pageHtml, /data-keyword-rows="missedReplyTemporaryReplyKeywords"/);
    assert.match(pageHtml, /id="missedReplyTemporaryReplyKeywords"[\s\S]*hidden/);
    assert.doesNotMatch(pageHtml, /class="wide-field keyword-field"/);
    assert.doesNotMatch(pageHtml, /格式：关键词 \| 完全匹配/);
  });
});

test("新增关键词应该使用弹窗确认，不直接在当前页面追加空白行", () => {
  const indexHtml = readIndexHtml();
  const settingsHtml = fs.readFileSync(settingsHtmlPath, "utf8");

  [indexHtml, settingsHtml].forEach((pageHtml) => {
    assert.match(pageHtml, /id="keywordAddModal"[\s\S]*id="keywordAddForm"[\s\S]*id="keywordAddText"/);
    assert.match(pageHtml, /name="keywordAddMatchMode"[\s\S]*value="exact"/);
    assert.match(pageHtml, /name="keywordAddMatchMode"[\s\S]*value="startsWith"/);
    assert.match(pageHtml, /name="keywordAddMatchMode"[\s\S]*value="includes"/);
  });
  assert.match(settingsScript, /function openKeywordAddModal/);
  assert.match(settingsScript, /openKeywordAddModal\(button\.dataset\.keywordAdd, button\)/);
  assert.doesNotMatch(settingsScript, /addKeywordRuleRow\(button\.dataset\.keywordAdd\)/);
});

test("漏回复关键词保存前应该同步逐行编辑器并使用原生单选项", () => {
  assert.match(settingsScript, /data-keyword-match-mode[\s\S]*type="radio"/);
  assert.match(settingsScript, /完全匹配[\s\S]*开头匹配[\s\S]*包含匹配/);
  assert.doesNotMatch(settingsScript, /missedReplyRecentContactLimit/);
  assert.match(settingsScript, /syncAllKeywordEditorsToTextareas\(\);[\s\S]*const payload = \{/);
});

test("配置中心目录按钮应该只打开对应独立配置页", () => {
  const { configPages, configPageButtons, elements } = createSettingsPageHarness();
  const missedReplyButton = configPageButtons.find(
    (button) => button.dataset.configPageTarget === "missedReply"
  );

  missedReplyButton.events.click();

  const pageByName = Object.fromEntries(configPages.map((page) => [page.dataset.configPage, page]));
  assert.equal(pageByName.hub.classList.contains("hidden"), true);
  assert.equal(pageByName.params.classList.contains("hidden"), true);
  assert.equal(pageByName.timeoutReminder.classList.contains("hidden"), true);
  assert.equal(pageByName.missedReply.classList.contains("hidden"), false);
  assert.equal(pageByName.missedReplyRuntime.classList.contains("hidden"), true);
  assert.equal(pageByName.onlinePresence.classList.contains("hidden"), true);
  assert.equal(pageByName.offDuty.classList.contains("hidden"), true);
  assert.equal(pageByName.wecom.classList.contains("hidden"), true);
  assert.equal(elements.configModalTitle.textContent, "漏回复设置");
});

test("超时提醒、无人在线和下班监控按钮应该打开各自独立配置页", () => {
  const { configPages, configPageButtons, elements } = createSettingsPageHarness();
  const timeoutReminderButton = configPageButtons.find(
    (button) => button.dataset.configPageTarget === "timeoutReminder"
  );
  const offDutyButton = configPageButtons.find(
    (button) => button.dataset.configPageTarget === "offDuty"
  );
  const onlinePresenceButton = configPageButtons.find(
    (button) => button.dataset.configPageTarget === "onlinePresence"
  );
  const pageByName = Object.fromEntries(configPages.map((page) => [page.dataset.configPage, page]));

  timeoutReminderButton.events.click();

  assert.equal(pageByName.timeoutReminder.classList.contains("hidden"), false);
  assert.equal(pageByName.params.classList.contains("hidden"), true);
  assert.equal(pageByName.offDuty.classList.contains("hidden"), true);
  assert.equal(elements.configModalTitle.textContent, "超时提醒配置");

  onlinePresenceButton.events.click();

  assert.equal(pageByName.timeoutReminder.classList.contains("hidden"), true);
  assert.equal(pageByName.onlinePresence.classList.contains("hidden"), false);
  assert.equal(pageByName.offDuty.classList.contains("hidden"), true);
  assert.equal(elements.configModalTitle.textContent, "上班监控");

  offDutyButton.events.click();

  assert.equal(pageByName.timeoutReminder.classList.contains("hidden"), true);
  assert.equal(pageByName.onlinePresence.classList.contains("hidden"), true);
  assert.equal(pageByName.offDuty.classList.contains("hidden"), false);
  assert.equal(pageByName.missedReply.classList.contains("hidden"), true);
  assert.equal(elements.configModalTitle.textContent, "下班监控配置");
});

test("漏回复分类按钮应该只打开对应子页面", () => {
  const { configPages, configPageButtons, elements } = createSettingsPageHarness();
  const runtimeButton = configPageButtons.find(
    (button) => button.dataset.configPageTarget === "missedReplyRuntime"
  );

  runtimeButton.events.click();

  const pageByName = Object.fromEntries(configPages.map((page) => [page.dataset.configPage, page]));
  assert.equal(pageByName.missedReply.classList.contains("hidden"), true);
  assert.equal(pageByName.missedReplyRuntime.classList.contains("hidden"), false);
  assert.equal(pageByName.missedReplyTemporaryKeywords.classList.contains("hidden"), true);
  assert.equal(pageByName.missedReplyClosingKeywords.classList.contains("hidden"), true);
  assert.equal(pageByName.missedReplyInvalidKeywords.classList.contains("hidden"), true);
  assert.equal(pageByName.missedReplyPlatformNoticeKeywords.classList.contains("hidden"), true);
  assert.equal(elements.configModalTitle.textContent, "运行参数");
});

test("控制台首页不应该再展示独立最近反馈卡片", () => {
  const indexHtml = readIndexHtml();

  assert.doesNotMatch(indexHtml, /id="actionFeedback"/);
  assert.doesNotMatch(indexHtml, /最近反馈/);
});

test("控制台首页不应该再展示独立运行状态卡片", () => {
  const indexHtml = readIndexHtml();

  assert.doesNotMatch(indexHtml, /<header class="hero">/);
  assert.doesNotMatch(indexHtml, /id="taskStatusCard"/);
  assert.doesNotMatch(indexHtml, /id="taskStatusTag"/);
  assert.doesNotMatch(indexHtml, /id="taskStatusText"/);
  assert.match(indexHtml, /class="action-workflow"[\s\S]*<h1>客服督办控制台<\/h1>/);
  assert.match(indexHtml, /id="workflowStepStart"[\s\S]*id="stopTaskButton"/);
});

test("首页停止退出按钮应该使用红色危险样式", () => {
  const indexHtml = readIndexHtml();
  const styleCss = readCssBundle(styleEntryPath);
  const lastPlainButtonRuleIndex = styleCss.lastIndexOf(".action-button,");
  const lastDangerButtonRuleIndex = styleCss.lastIndexOf(".action-button-danger");

  assert.match(indexHtml, /class="action-button action-button-danger" id="stopTaskButton"/);
  assert.match(styleCss, /\.action-button-danger\s*\{[\s\S]*#d93025/);
  assert.ok(lastDangerButtonRuleIndex > lastPlainButtonRuleIndex);
});

test("流程头部不应该重复展示运行时长", () => {
  const indexHtml = readIndexHtml();

  assert.doesNotMatch(indexHtml, /id="runtimeDurationValue"/);
  assert.doesNotMatch(indexHtml, /运行时长：/);
  assert.match(indexHtml, /id="workflowStartTime"/);
});

test("流程头部应该展示最近真实判定而不是旧扫描时间", () => {
  const indexHtml = readIndexHtml();

  assert.match(indexHtml, /最近判定：<strong id="monitorUpdatedAtValue">暂无<\/strong>/);
  assert.doesNotMatch(indexHtml, /最近扫描/);
  assert.doesNotMatch(indexHtml, /id="queueUpdatedAtValue"/);
});
