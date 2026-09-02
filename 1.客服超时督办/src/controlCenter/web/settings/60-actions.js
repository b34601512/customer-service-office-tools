// 该文件用于绑定配置中心表单、增删行和保存动作。
function bindKeywordEditorActions(actionRoot) {
  // 这里只绑定关键词编辑器自己的增删和同步行为，避免散落到保存逻辑里。
  if (!actionRoot || typeof actionRoot.querySelectorAll !== "function") {
    return;
  }

  actionRoot.querySelectorAll("[data-keyword-add]").forEach((button) => {
    button.addEventListener("click", () => {
      openKeywordAddModal(button.dataset.keywordAdd, button);
    });
  });

  actionRoot.querySelectorAll("[data-keyword-rows]").forEach((rowsElement) => {
    const fieldId = rowsElement.dataset.keywordRows;
    rowsElement.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-keyword-remove]");
      if (!removeButton) {
        return;
      }

      const row = removeButton.closest("[data-keyword-row]");
      if (row) {
        row.remove();
      }
      if (rowsElement.querySelectorAll("[data-keyword-row]").length === 0) {
        renderKeywordEditor(fieldId, []);
      }
      syncKeywordEditorToTextarea(fieldId);
    });
    rowsElement.addEventListener("input", () => {
      syncKeywordEditorToTextarea(fieldId);
    });
    rowsElement.addEventListener("change", () => {
      syncKeywordEditorToTextarea(fieldId);
    });
  });
}

function bindConfigActions() {
  // 这里统一绑定配置页事件，只处理跳转、增删和保存。
  const actionRoot = configModal || document;
  actionRoot.querySelectorAll("[data-config-page-target]").forEach((button) => {
    button.addEventListener("click", () => {
      showConfigPage(button.dataset.configPageTarget);
    });
  });
  bindKeywordEditorActions(actionRoot);
  bindKeywordAddModalActions();

  actionRoot.querySelectorAll("[data-link]").forEach((button) => {
    button.addEventListener("click", () => {
      window.open(button.dataset.link, "_blank", "noopener");
      showConfigFeedbackToast(`已打开「${button.textContent}」。`, "success", {
        title: "已打开新页面"
      });
    });
  });

  configForm.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      updateCheckboxHint(checkbox, "启用中", "已关闭");
    });
  });

  addNotificationGroupButton.addEventListener("click", () => {
    const groups = collectNotificationGroupsFromForm({ keepBlankRows: true });
    groups.push(createNotificationGroupDraft({ enabled: true }));
    renderNotificationGroups(groups);
    setSectionFeedback(privateConfigFeedback, "已新增一条空白通知群，请补全备注和 webhook 后再保存。", false, {
      type: "success",
      title: "通知群已新增"
    });
  });

  addStaffButton.addEventListener("click", () => {
    const staffDirectory = collectStaffDirectoryFromForm({ keepBlankRows: true });
    staffDirectory.push(createStaffDraft());
    renderStaffDirectory(staffDirectory);
    setSectionFeedback(privateConfigFeedback, "已新增一条空白成员，请补全姓名和手机号后再保存。", false, {
      type: "success",
      title: "成员已新增"
    });
  });

  document.getElementById("notificationGroupsList").addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-action='remove-notification-group']");
    if (!removeButton) {
      return;
    }

    const targetGroupId = String(removeButton.dataset.groupId || "").trim();
    const groups = collectNotificationGroupsFromForm({ keepBlankRows: true }).filter(
      (group) => group.id !== targetGroupId
    );
    renderNotificationGroups(groups);
    setSectionFeedback(privateConfigFeedback, "通知群草稿已删除，记得点「保存企微提醒」后才会真正生效。", false, {
      type: "success",
      title: "通知群已删除"
    });
  });

  document.getElementById("notificationGroupsList").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-field='enabled']");
    if (!checkbox) {
      return;
    }

    const label = checkbox.closest(".checkbox-row")?.querySelector("em");
    if (label) {
      label.textContent = checkbox.checked ? "启用中" : "已停用";
    }
  });

  document.getElementById("staffDirectoryList").addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-action='remove-staff']");
    if (!removeButton) {
      return;
    }

    const targetStaffId = String(removeButton.dataset.staffId || "").trim();
    const staffDirectory = collectStaffDirectoryFromForm({ keepBlankRows: true }).filter(
      (staff) => staff.id !== targetStaffId
    );
    renderStaffDirectory(staffDirectory);
    setSectionFeedback(privateConfigFeedback, "成员草稿已删除，记得点「保存企微提醒」后才会真正生效。", false, {
      type: "success",
      title: "成员已删除"
    });
  });
  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = event.submitter || configForm.querySelector("button[type='submit']");
    if (submitButton) {
      setConfigButtonBusy(submitButton, "正在保存...");
    }
    setConfigFeedback("生产配置正在保存，请稍候。", false, {
      type: "pending",
      title: "正在保存",
      showToast: false
    });

    try {
      syncAllKeywordEditorsToTextareas();
      const payload = {
        targetUrl: document.getElementById("targetUrl").value.trim(),
        timeoutReminderThresholdSeconds: document.getElementById("timeoutReminderThresholdSeconds").value.trim(),
        missedReplyMonitorEnabled: document.getElementById("missedReplyMonitorEnabled").checked,
        onlinePresenceMonitorEnabled: document.getElementById("onlinePresenceMonitorEnabled").checked,
        transferAutoOpenEnabled: document.getElementById("transferAutoOpenEnabled").checked,
        transferAutoCloseEnabled: document.getElementById("transferAutoCloseEnabled").checked,
        onlinePresenceScanIntervalMs: document.getElementById("onlinePresenceScanIntervalMs").value.trim(),
        onlinePresenceWorkStartTime: document.getElementById("onlinePresenceWorkStartTime").value.trim(),
        missedReplyScanIntervalMs: document.getElementById("missedReplyScanIntervalMs").value.trim(),
        missedReplyMaxContactsPerScan: document.getElementById("missedReplyMaxContactsPerScan").value.trim(),
        missedReplyTemporaryReplyKeywords: document.getElementById("missedReplyTemporaryReplyKeywords").value,
        missedReplyCustomerResolutionKeywords: document.getElementById("missedReplyCustomerResolutionKeywords").value,
        missedReplyCustomerClosingKeywords: document.getElementById("missedReplyCustomerClosingKeywords").value,
        missedReplyInvalidAgentReplyKeywords: document.getElementById("missedReplyInvalidAgentReplyKeywords").value,
        missedReplyPlatformNoticeKeywords: document.getElementById("missedReplyPlatformNoticeKeywords").value,
        groupChatFilterEnabled: document.getElementById("groupChatFilterEnabled").checked,
        offDutyAutomationEnabled: document.getElementById("offDutyAutomationEnabled").checked,
        offDutyScanIntervalMs: document.getElementById("offDutyScanIntervalMs").value.trim(),
        offDutyPreSalesEarlyStartTime: document.getElementById("offDutyPreSalesEarlyStartTime").value.trim(),
        offDutyPreSalesLateStartTime: document.getElementById("offDutyPreSalesLateStartTime").value.trim(),
        offDutyAfterSalesEarlyStartTime: document.getElementById("offDutyAfterSalesEarlyStartTime").value.trim(),
        offDutyAfterSalesLateStartTime: document.getElementById("offDutyAfterSalesLateStartTime").value.trim(),
        offDutyPreSalesEarlyCloseTime: document.getElementById("offDutyPreSalesEarlyCloseTime").value.trim(),
        offDutyPreSalesLateCloseTime: document.getElementById("offDutyPreSalesLateCloseTime").value.trim(),
        offDutyAfterSalesEarlyCloseTime: document.getElementById("offDutyAfterSalesEarlyCloseTime").value.trim(),
        offDutyAfterSalesLateCloseTime: document.getElementById("offDutyAfterSalesLateCloseTime").value.trim(),
        offDutyTomorrowShiftNotificationEnabled: document.getElementById("offDutyTomorrowShiftNotificationEnabled").checked
      };
      const result = await requestJson("/api/config/save", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      fillConfig(result.config);
      if (submitButton) {
        clearConfigButtonBusy(submitButton);
      }
      setConfigFeedback(result.message, false, {
        type: "success",
        title: "配置已保存"
      });
    } catch (error) {
      if (submitButton) {
        clearConfigButtonBusy(submitButton);
      }
      setConfigFeedback(error.message, true, {
        title: "配置保存失败"
      });
    }
  });

  wecomConfigForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = event.submitter || wecomConfigForm.querySelector("button[type='submit']");
    if (submitButton) {
      setConfigButtonBusy(submitButton, "正在保存...");
    }
    setSectionFeedback(privateConfigFeedback, "企微提醒配置正在保存，请稍候。", false, {
      type: "pending",
      title: "正在保存",
      showToast: false
    });

    try {
      const payload = {
        notificationGroups: collectNotificationGroupsFromForm(),
        staffDirectory: collectStaffDirectoryFromForm()
      };
      const result = await requestJson("/api/private-config/wecom/save", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      fillWecomConfig(result.wecomRobot);
      if (submitButton) {
        clearConfigButtonBusy(submitButton);
      }
      setSectionFeedback(privateConfigFeedback, result.message, false, {
        type: "success",
        title: "保存成功"
      });
    } catch (error) {
      if (submitButton) {
        clearConfigButtonBusy(submitButton);
      }
      setSectionFeedback(privateConfigFeedback, error.message, true, {
        title: "保存失败"
      });
    }
  });
}

async function bootstrapConfigPage() {
  // 这里统一编排配置页初始化顺序，保证界面先拿到配置再绑定保存动作。
  bindConfigActions();
  await loadConfigInitialState();
}
