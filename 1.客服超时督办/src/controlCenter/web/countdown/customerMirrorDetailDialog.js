// 该文件用于解决“客户详情必须从总览列表拆出去”的问题：只负责详情弹窗的渲染、打开和关闭。
(function () {
  function createCustomerMirrorDetailDialog(options) {
    // 这里创建客户详情弹窗控制器，让列表模块不直接操作弹窗内部结构。
    const {
      document,
      modalElement,
      titleElement,
      subtitleElement,
      bodyElement,
      closeButton,
      escapeHtml,
      formatScanTime,
      renderStatusTags,
      renderCountdownCards,
      renderMetaText,
      renderReasonList
    } = options;
    let triggerButton = null;
    let activeItem = null;
    let activeSequenceNumber = 0;

    function renderFactRow(label, value) {
      // 这里把一条详情事实渲染成固定行，避免消息原文继续挤到总览层。
      if (!value) {
        return "";
      }

      return `
        <div class="customer-mirror-detail-fact-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `;
    }

    function renderMessageFacts(item) {
      // 这里集中渲染客户消息原文，保证总览页不再出现长文本详情。
      const detailRows = [];
      if (item.latestMessageText || item.latestMessageRoleLabel) {
        const senderText = item.latestMessageSenderName ? `｜${item.latestMessageSenderName}` : "";
        const timeText = item.latestMessageAtMs ? `｜${formatScanTime(item.latestMessageAtMs)}` : "";
        detailRows.push(
          renderFactRow(
            "最后有效消息",
            `${item.latestMessageRoleLabel || "未知"}：${item.latestMessageText || "无内容"}${senderText}${timeText}`
          )
        );
      }
      if (item.lastCustomerMessageText) {
        detailRows.push(renderFactRow("需处理客户消息", item.lastCustomerMessageText));
      }
      if (item.recentAgentReplyText) {
        detailRows.push(renderFactRow("最近人工处理", item.recentAgentReplyText));
      }

      return detailRows.join("") || '<div class="countdown-empty">当前客户暂无可核对的消息详情。</div>';
    }

    function formatReminderDuration(totalSeconds) {
      // 这里把提醒时长压成复盘短文本，避免详情里只看到裸秒数。
      const normalizedSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
      if (normalizedSeconds >= 3600) {
        const hours = Math.floor(normalizedSeconds / 3600);
        const minutes = Math.floor((normalizedSeconds % 3600) / 60);
        return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
      }
      if (normalizedSeconds >= 60) {
        return `${Math.floor(normalizedSeconds / 60)}分钟`;
      }

      return `${normalizedSeconds}秒`;
    }

    function renderRecentReminderFacts(item) {
      // 这里只展示统一引擎发提醒那一刻保存的快照，不在详情里重新判定。
      const snapshot = item.recentReminderSnapshot;
      if (!snapshot) {
        return '<div class="countdown-empty">暂无最近提醒记录。</div>';
      }

      const assigneeText = [snapshot.assigneeName, snapshot.assigneeRoleLabel]
        .filter(Boolean)
        .join("｜");
      return [
        renderFactRow("提醒时间", formatScanTime(snapshot.reminderSentAtMs)),
        renderFactRow("提醒类型", snapshot.reminderKindLabel || "未记录"),
        renderFactRow("提醒原因", snapshot.reasonLabel || "未记录"),
        renderFactRow("超时时长", formatReminderDuration(snapshot.pendingDurationSeconds)),
        renderFactRow("当时分配状态", snapshot.assignmentStatusLabel || "未记录"),
        renderFactRow("当时接待客服", assigneeText),
        renderFactRow("当时客户消息", snapshot.lastCustomerMessageText || "未记录"),
        renderFactRow("当时人工处理", snapshot.recentAgentReplyText || "无人工回复记录"),
        renderFactRow("发送目标", snapshot.dispatchTarget || "未记录"),
        renderFactRow("通知群", snapshot.webhookName || "未记录")
      ].join("");
    }

    function renderDetailBody(item) {
      // 这里把完整判定依据和消息事实放到二层弹窗，第一层只保留可扫视信息。
      return `
        <section class="customer-mirror-detail-section">
          <h3>当前状态</h3>
          <div class="customer-mirror-detail-tags">${renderStatusTags(item.statusTags)}</div>
          <div class="customer-mirror-detail-countdowns">${renderCountdownCards(item)}</div>
          <div class="customer-mirror-detail-meta">${escapeHtml(renderMetaText(item))}</div>
        </section>
        <section class="customer-mirror-detail-section">
          <h3>最近提醒复盘</h3>
          <div class="customer-mirror-detail-facts">${renderRecentReminderFacts(item)}</div>
        </section>
        <section class="customer-mirror-detail-section">
          <h3>判定依据</h3>
          <div class="customer-mirror-detail-reasons">${renderReasonList(item.reasonText)}</div>
          ${renderFactRow("列表预览", item.previewText || "无预览内容")}
        </section>
        <section class="customer-mirror-detail-section">
          <h3>消息详情</h3>
          <div class="customer-mirror-detail-facts">${renderMessageFacts(item)}</div>
        </section>
      `;
    }

    function syncVisible(isVisible) {
      // 这里统一同步详情弹窗显隐状态，避免多个位置各自改 class 和 aria。
      if (!modalElement) {
        return;
      }

      modalElement.classList.toggle("hidden", !isVisible);
      modalElement.setAttribute("aria-hidden", isVisible ? "false" : "true");
    }

    function open(item, sequenceNumber, trigger) {
      // 这里打开单个客户详情，并记录触发按钮以便关闭后回到原行。
      if (!item) {
        throw new Error("打开客户详情失败：未找到客户数据。");
      }
      activeItem = item;
      activeSequenceNumber = Number(sequenceNumber || 0);
      triggerButton = trigger || null;
      if (titleElement) {
        titleElement.textContent = `#${activeSequenceNumber} ${item.customerName || "未识别客户"}`;
      }
      if (subtitleElement) {
        subtitleElement.textContent = "客户完整消息、判定依据和倒计时状态。";
      }
      if (bodyElement) {
        bodyElement.innerHTML = renderDetailBody(item);
      }
      syncVisible(true);
      if (closeButton && typeof closeButton.focus === "function") {
        closeButton.focus();
      }
    }

    function close() {
      // 这里关闭详情弹窗并把焦点还给当前客户行按钮。
      syncVisible(false);
      activeItem = null;
      activeSequenceNumber = 0;
      if (triggerButton && typeof triggerButton.focus === "function") {
        triggerButton.focus();
      }
      triggerButton = null;
    }

    function closeIfVisible() {
      // 这里给外层 Escape 处理使用：详情打开时只关闭详情，不连带关闭总览弹窗。
      if (!modalElement || modalElement.classList.contains("hidden")) {
        return false;
      }
      close();
      return true;
    }

    function rerenderIfVisible(nextItem) {
      // 这里在后台刷新倒计时时同步更新已打开详情，避免详情里的秒数停住。
      if (!nextItem || !modalElement || modalElement.classList.contains("hidden")) {
        return;
      }
      activeItem = nextItem;
      if (bodyElement) {
        bodyElement.innerHTML = renderDetailBody(nextItem);
      }
    }

    function bind() {
      // 这里只绑定详情弹窗自己的关闭入口，不接管外层倒计时弹窗。
      if (closeButton) {
        closeButton.addEventListener("click", close);
      }
      if (modalElement) {
        modalElement.addEventListener("click", (event) => {
          if (event.target === modalElement) {
            close();
          }
        });
      }
    }

    return {
      bind,
      close,
      closeIfVisible,
      open,
      rerenderIfVisible,
      getActiveSequenceNumber() {
        // 这里暴露当前序号给总览刷新时定位同一个显示位置。
        return activeSequenceNumber;
      },
      getActiveChatId() {
        // 这里优先用 chatId 在刷新后找回同一个客户，避免排序没变时详情过期。
        return activeItem?.chatId || "";
      }
    };
  }

  window.createCustomerMirrorDetailDialog = createCustomerMirrorDetailDialog;
})();
