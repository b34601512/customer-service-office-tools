// 该文件用于把后端配置渲染回表单和企微配置卡片。
function fillConfig(config) {
  // 这里统一把服务端配置写回表单，避免保存后界面继续显示旧值。
  modeChip.textContent = `当前模式：${config.modeName}`;
  document.getElementById("targetUrl").value = config.targetUrl;
  document.getElementById("timeoutReminderThresholdSeconds").value = config.timeoutReminderThresholdSeconds;
  document.getElementById("missedReplyMonitorEnabled").checked = Boolean(config.missedReplyMonitorEnabled);
  document.getElementById("onlinePresenceMonitorEnabled").checked = Boolean(config.onlinePresenceMonitorEnabled);
  document.getElementById("transferAutoOpenEnabled").checked = Boolean(config.transferAutoOpenEnabled);
  document.getElementById("transferAutoCloseEnabled").checked = Boolean(config.transferAutoCloseEnabled);
  document.getElementById("onlinePresenceScanIntervalMs").value = config.onlinePresenceScanIntervalMs;
  document.getElementById("onlinePresenceWorkStartTime").value = config.onlinePresenceWorkStartTime;
  document.getElementById("missedReplyScanIntervalMs").value = config.missedReplyScanIntervalMs;
  document.getElementById("missedReplyMaxContactsPerScan").value = config.missedReplyMaxContactsPerScan;
  setKeywordEditorValue("missedReplyTemporaryReplyKeywords", config.missedReplyTemporaryReplyKeywords);
  setKeywordEditorValue("missedReplyCustomerResolutionKeywords", config.missedReplyCustomerResolutionKeywords);
  setKeywordEditorValue("missedReplyCustomerClosingKeywords", config.missedReplyCustomerClosingKeywords);
  setKeywordEditorValue("missedReplyInvalidAgentReplyKeywords", config.missedReplyInvalidAgentReplyKeywords);
  setKeywordEditorValue("missedReplyPlatformNoticeKeywords", config.missedReplyPlatformNoticeKeywords);
  document.getElementById("groupChatFilterEnabled").checked = Boolean(config.groupChatFilterEnabled);
  document.getElementById("offDutyAutomationEnabled").checked = Boolean(config.offDutyAutomationEnabled);
  document.getElementById("offDutyScanIntervalMs").value = config.offDutyScanIntervalMs;
  document.getElementById("offDutyPreSalesEarlyStartTime").value = config.offDutyPreSalesEarlyStartTime;
  document.getElementById("offDutyPreSalesLateStartTime").value = config.offDutyPreSalesLateStartTime;
  document.getElementById("offDutyAfterSalesEarlyStartTime").value = config.offDutyAfterSalesEarlyStartTime;
  document.getElementById("offDutyAfterSalesLateStartTime").value = config.offDutyAfterSalesLateStartTime;
  document.getElementById("offDutyPreSalesEarlyCloseTime").value = config.offDutyPreSalesEarlyCloseTime;
  document.getElementById("offDutyPreSalesLateCloseTime").value = config.offDutyPreSalesLateCloseTime;
  document.getElementById("offDutyAfterSalesEarlyCloseTime").value = config.offDutyAfterSalesEarlyCloseTime;
  document.getElementById("offDutyAfterSalesLateCloseTime").value = config.offDutyAfterSalesLateCloseTime;
  document.getElementById("offDutyTomorrowShiftNotificationEnabled").checked = Boolean(
    config.offDutyTomorrowShiftNotificationEnabled
  );
  updateCheckboxHint(document.getElementById("offDutyAutomationEnabled"), "启用中", "已关闭");
  updateCheckboxHint(document.getElementById("missedReplyMonitorEnabled"), "启用中", "已关闭");
  updateCheckboxHint(document.getElementById("onlinePresenceMonitorEnabled"), "启用中", "已关闭");
  updateCheckboxHint(document.getElementById("transferAutoOpenEnabled"), "自动补开", "已关闭");
  updateCheckboxHint(document.getElementById("transferAutoCloseEnabled"), "自动关闭", "已关闭");
  updateCheckboxHint(document.getElementById("offDutyTomorrowShiftNotificationEnabled"), "启用中", "已关闭");
  updateCheckboxHint(document.getElementById("groupChatFilterEnabled"), "启用中", "已关闭");
}

function collectNotificationGroupsFromForm(options = {}) {
  // 这里统一从页面收口通知群列表，保存和增删都复用同一套取值逻辑。
  const keepBlankRows = Boolean(options.keepBlankRows);
  return Array.from(document.querySelectorAll("[data-notification-group]"))
    .map((element) => ({
      id: element.dataset.groupId || "",
      name: element.querySelector("[data-field='name']").value.trim(),
      webhookUrl: element.querySelector("[data-field='webhookUrl']").value.trim(),
      enabled: element.querySelector("[data-field='enabled']").checked
    }))
    .filter((group) => keepBlankRows || group.name || group.webhookUrl);
}

function collectStaffDirectoryFromForm(options = {}) {
  // 这里统一从页面收口成员清单，保存和增删都复用同一套取值逻辑。
  const keepBlankRows = Boolean(options.keepBlankRows);
  return Array.from(document.querySelectorAll("[data-staff-row]"))
    .map((element) => ({
      id: element.dataset.staffId || "",
      name: element.querySelector("[data-field='name']").value.trim(),
      mobile: element.querySelector("[data-field='mobile']").value.trim(),
      userId: String(element.dataset.staffUserId || "").trim(),
      inlineMentionEnabled: String(element.dataset.staffInlineMentionEnabled || "true").trim() !== "false"
    }))
    .filter((staff) => keepBlankRows || staff.name || staff.mobile || staff.userId);
}

function buildNotificationGroupCardHtml(group, index) {
  // 这里把每个通知群渲染成独立卡片，方便主管增删、备注和启停。
  return `
    <article class="notification-group-card" data-notification-group data-group-id="${escapeConfigHtml(group.id)}">
      <div class="notification-group-card-head">
        <strong class="notification-group-card-title">通知群 ${index + 1}</strong>
      </div>
      <div class="notification-group-grid">
        <label>
          <span>备注</span>
          <input data-field="name" value="${escapeConfigHtml(group.name)}" placeholder="例如：全员群 / 主管群" />
        </label>
        <label>
          <span>Webhook</span>
          <input data-field="webhookUrl" value="${escapeConfigHtml(group.webhookUrl)}" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
        </label>
        <label class="checkbox-field">
          <span>状态</span>
          <span class="checkbox-row">
            <input data-field="enabled" type="checkbox" ${group.enabled ? "checked" : ""} />
            <em>${group.enabled ? "启用中" : "已停用"}</em>
          </span>
        </label>
        <div class="notification-group-actions">
          <button class="mini-button mini-button-danger" data-action="remove-notification-group" data-group-id="${escapeConfigHtml(group.id)}" type="button">删除</button>
        </div>
      </div>
    </article>
  `;
}

function buildStaffCardHtml(staff, index) {
  // 这里把成员卡片压到最小可维护结构，界面只保留当前真正需要人工维护的姓名和手机号。
  return `
    <article
      class="staff-card"
      data-staff-row
      data-staff-id="${escapeConfigHtml(staff.id)}"
      data-staff-user-id="${escapeConfigHtml(staff.userId)}"
      data-staff-inline-mention-enabled="${staff.inlineMentionEnabled !== false ? "true" : "false"}"
    >
      <div class="staff-card-head">
        <strong class="staff-card-title">成员 ${index + 1}</strong>
      </div>
      <div class="staff-card-grid">
        <label>
          <span>姓名</span>
          <input data-field="name" value="${escapeConfigHtml(staff.name)}" placeholder="例如：苏哲" />
        </label>
        <label>
          <span>手机号</span>
          <input data-field="mobile" value="${escapeConfigHtml(staff.mobile)}" placeholder="例如：13800000000" />
        </label>
        <div class="staff-card-actions">
          <button class="mini-button mini-button-danger" data-action="remove-staff" data-staff-id="${escapeConfigHtml(staff.id)}" type="button">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderNotificationGroups(groups) {
  // 这里统一渲染通知群列表，旧双群配置和新多群配置都走同一个界面。
  const listElement = document.getElementById("notificationGroupsList");
  const normalizedGroups = (Array.isArray(groups) ? groups : []).map((group) =>
    createNotificationGroupDraft(group)
  );
  if (normalizedGroups.length === 0) {
    listElement.innerHTML = '<div class="notification-group-empty">当前还没有通知群。点击右上角「新增通知群」后，填入 webhook 并启用即可。</div>';
    return;
  }

  listElement.innerHTML = normalizedGroups
    .map((group, index) => buildNotificationGroupCardHtml(group, index))
    .join("");
}

function renderStaffDirectory(staffDirectory) {
  // 这里统一渲染成员清单，让成员资料以后只维护一份。
  const listElement = document.getElementById("staffDirectoryList");
  const normalizedDirectory = (Array.isArray(staffDirectory) ? staffDirectory : []).map((staff) =>
    createStaffDraft(staff)
  );
  if (normalizedDirectory.length === 0) {
    listElement.innerHTML =
    '<div class="staff-directory-empty">当前还没有成员。点击右上角「新增成员」后，逐行填写姓名和手机号即可。</div>';
    return;
  }

  listElement.innerHTML = normalizedDirectory
    .map((staff, index) => buildStaffCardHtml(staff, index))
    .join("");
}

function fillWecomConfig(wecomRobot) {
  // 这里统一把企微提醒配置写回表单，通知群和成员清单都在同一处维护。
  renderNotificationGroups(wecomRobot.notificationGroups || []);
  renderStaffDirectory(wecomRobot.staffDirectory || []);
}
