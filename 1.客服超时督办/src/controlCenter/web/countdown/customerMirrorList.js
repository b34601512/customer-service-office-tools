// 该文件用于解决“倒计时第一层要一眼扫完”的问题：只渲染客户总览行，并把长详情交给详情弹窗。
(function () {
  function createCustomerMirrorCountdownController(options) {
    // 这里创建倒计时总览控制器，首页脚本只需要调用 render 和 bind。
    const {
      document,
      listElement,
      summaryElement,
      detailModalElement,
      detailTitleElement,
      detailSubtitleElement,
      detailBodyElement,
      detailCloseButton,
      escapeHtml,
      formatScanTime
    } = options;
    let rows = [];
    const detailDialog = window.createCustomerMirrorDetailDialog({
      document,
      modalElement: detailModalElement,
      titleElement: detailTitleElement,
      subtitleElement: detailSubtitleElement,
      bodyElement: detailBodyElement,
      closeButton: detailCloseButton,
      escapeHtml,
      formatScanTime,
      renderStatusTags,
      renderCountdownCards,
      renderMetaText,
      renderReasonList
    });

    function formatSecondsDuration(totalSeconds) {
      // 这里把倒计时秒数压成短文本，避免一行总览被长数字挤乱。
      const normalizedSeconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
      const hours = Math.floor(normalizedSeconds / 3600);
      const minutes = Math.floor((normalizedSeconds % 3600) / 60);
      const seconds = normalizedSeconds % 60;

      if (hours > 0) {
        return `${hours}小时${String(minutes).padStart(2, "0")}分`;
      }
      if (minutes > 0) {
        return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
      }

      return `${seconds}秒`;
    }

    function resolveRemainingSeconds(targetAtMs, fallbackSeconds = 0) {
      // 这里优先按目标时间实时倒计时，目标时间缺失时才使用后端剩余秒数。
      const numericTargetAtMs = Number(targetAtMs || 0);
      if (Number.isFinite(numericTargetAtMs) && numericTargetAtMs > 0) {
        return Math.max(0, Math.ceil((numericTargetAtMs - Date.now()) / 1000));
      }

      return Math.max(0, Math.ceil(Number(fallbackSeconds) || 0));
    }

    // 以下 formatFreshnessClock/formatFreshnessAge 与 tui/pages/customers.js:23-43 逐字镜像，修改时双侧同步（issue #552）。
function formatFreshnessClock(timestampMs) {
      const numericTimestampMs = Number(timestampMs || 0);
      if (!Number.isFinite(numericTimestampMs) || numericTimestampMs <= 0) {
        return "未扫描";
      }

      const date = new Date(numericTimestampMs);
      const pad = (value) => String(value).padStart(2, "0");
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    function formatFreshnessAge(ageSeconds) {
      const numericAgeSeconds = Number(ageSeconds);
      if (!Number.isFinite(numericAgeSeconds) || numericAgeSeconds < 0) {
        return "暂无";
      }
      if (numericAgeSeconds < 60) {
        return `${Math.floor(numericAgeSeconds)} 秒前`;
      }
      return `${Math.floor(numericAgeSeconds / 60)} 分钟前`;
    }

    function renderFreshnessWarning(dataFreshness) {
      const freshness = dataFreshness || {};
      if (!freshness.stale) {
        return "";
      }

      const ageSeconds = Number(freshness.ageSeconds);
      const staleMinutes = Math.max(1, Math.floor((Number.isFinite(ageSeconds) ? ageSeconds : 0) / 60));
      return `<div class="customer-mirror-freshness-warning" role="alert" style="color:#b42318;font-weight:700;padding:8px 10px;border:1px solid rgba(179,38,30,.34);border-radius:8px;background:#fff7f6;">⚠ 数据已 ${staleMinutes} 分钟未更新，后台扫描可能已停止/浏览器可能挂掉，按 3 看日志、回 1 重启任务</div>`;
    }

    function renderEmpty(message) {
      // 这里统一渲染空状态，后台未扫描时用户也能看到明确反馈。
      return `<div class="countdown-empty">${escapeHtml(message)}</div>`;
    }

    function renderStatusTags(statusTags) {
      // 这里只渲染后端给出的标签，不在前端再次推断业务状态。
      return (Array.isArray(statusTags) ? statusTags : [])
        .map((tag) => `
          <span class="customer-status-tag is-${escapeHtml(tag.type || "neutral")}">
            ${escapeHtml(tag.label || "")}
          </span>
        `)
        .join("");
    }

    function buildCountdownItems(item) {
      // 这里把超时和漏回复两个倒计时拆成独立短项，用户不用在长句里找重点。
      const items = [];
      const timeoutRemainingSeconds = resolveRemainingSeconds(
        item.timeoutReminderTargetAtMs,
        item.timeoutReminderRemainingSeconds
      );
      const missedReplyRemainingSeconds = resolveRemainingSeconds(
        item.missedReplyReminderTargetAtMs,
        item.missedReplyReminderRemainingSeconds
      );

      if (Number(item.timeoutReminderTargetAtMs || 0) > 0) {
        items.push({
          label: "超时提醒",
          value: timeoutRemainingSeconds === 0 ? "已到点" : `还剩${formatSecondsDuration(timeoutRemainingSeconds)}`
        });
      }
      if (Number(item.missedReplyReminderTargetAtMs || 0) > 0) {
        items.push({
          label: "漏回复",
          value: missedReplyRemainingSeconds === 0 ? "已到点" : `还剩${formatSecondsDuration(missedReplyRemainingSeconds)}`
        });
      }

      return items;
    }

    function renderCountdownCards(item) {
      // 这里复用同一套倒计时短卡，总览和详情看到的状态一致。
      const countdownItems = buildCountdownItems(item);
      if (countdownItems.length === 0) {
        return '<div class="customer-mirror-countdown-card"><span>倒计时</span><strong>暂无</strong></div>';
      }

      return countdownItems
        .map((countdownItem) => `
          <div class="customer-mirror-countdown-card is-active">
            <span>${escapeHtml(countdownItem.label)}</span>
            <strong>${escapeHtml(countdownItem.value)}</strong>
          </div>
        `)
        .join("");
    }

    function renderMetaText(item) {
      // 这里只展示统一判定来源，避免旧页面队列快照继续混入客户镜像。
      const metaParts = [];
      if (item.contactListIndex) {
        metaParts.push(`列表第${Number(item.contactListIndex)}位`);
      }
      if (item.missedReplyScannedAtMs) {
        metaParts.push(`判定 ${formatScanTime(item.missedReplyScannedAtMs)}`);
      }
      if (item.recentReminderSnapshot?.reminderSentAtMs) {
        metaParts.push(`最近提醒 ${formatScanTime(item.recentReminderSnapshot.reminderSentAtMs)}`);
      }

      return metaParts.join("｜") || "暂无判定时间";
    }

    function renderReasonList(reasonText) {
      // 这里把判定原因拆成短标签，详情弹窗里继续复用同一套展示。
      const reasonItems = String(reasonText || "暂无判定依据")
        .split("｜")
        .map((part) => part.trim())
        .filter(Boolean);

      return reasonItems
        .map((reasonItem) => `<span class="customer-mirror-reason">${escapeHtml(reasonItem)}</span>`)
        .join("");
    }

    function hasDangerTag(item) {
      // 这里只根据后端标签类型决定醒目样式，不在前端重新判断业务规则。
      return (item.statusTags || []).some((tag) => tag.type === "danger");
    }

    function renderOverviewRow(item, index) {
      // 这里渲染一行客户总览，严格避免把消息详情展开到第一层。
      const sequenceNumber = index + 1;
      return `
        <article class="customer-mirror-overview-row ${hasDangerTag(item) ? "is-due" : ""}">
          <div class="customer-mirror-sequence" aria-label="序号 ${sequenceNumber}">#${sequenceNumber}</div>
          <div class="customer-mirror-overview-main">
            <div class="customer-mirror-title">
              <strong>${escapeHtml(item.customerName)}</strong>
              <span class="customer-mirror-tags">${renderStatusTags(item.statusTags)}</span>
            </div>
          </div>
          <div class="customer-mirror-countdowns">${renderCountdownCards(item)}</div>
          <div class="customer-mirror-overview-meta">${escapeHtml(renderMetaText(item))}</div>
          <button class="ghost-button customer-mirror-detail-button" type="button" data-customer-detail-index="${index}">
            查看详情
          </button>
        </article>
      `;
    }

    function syncOpenDetailAfterRender() {
      // 这里在总览刷新后同步已打开详情，避免后台轮询导致详情内容停在旧秒数。
      const activeChatId = detailDialog.getActiveChatId();
      if (!activeChatId) {
        return;
      }
      const nextItem = rows.find((item) => item.chatId === activeChatId);
      detailDialog.rerenderIfVisible(nextItem);
    }

    // 这里与 tui/pages/customers.js 的 resolveFreshnessAgeColor 三色规则互为镜像：秒级绿/分钟黄/过期红，阈值60双侧同步（issue #552）。
function renderFreshnessSummaryColor(dataFreshness) {
      // 这里按新鲜度给“X秒/分钟前”上色：秒级=绿(新鲜)，分钟级=黄(偏旧)，过期=红(与警告一致)。
      if (dataFreshness?.stale) {
        return "#b42318";
      }
      if (Number(dataFreshness?.ageSeconds) < 60) {
        return "#1f9d55";
      }
      return "#b7791f";
    }

    function render(items, dataFreshness = {}) {
      // 这里刷新客户总览列表，序号只按当前显示顺序生成，不写回业务数据。
      rows = Array.isArray(items) ? items : [];
      const customerText = rows.length > 0 ? `${rows.length} 个客户` : "暂无客户";
      if (summaryElement) {
        if ("innerHTML" in summaryElement) {
          // 真实浏览器：时间保持默认色，给“X秒/分钟前”单独上色。
          const freshnessAgeColor = renderFreshnessSummaryColor(dataFreshness);
          const clockText = escapeHtml(formatFreshnessClock(dataFreshness.lastScannedAtMs));
          const ageText = escapeHtml(formatFreshnessAge(dataFreshness.ageSeconds));
          summaryElement.innerHTML =
            `${escapeHtml(customerText)}｜数据最后扫描 ${clockText}` +
            `（<span style="color:${freshnessAgeColor};font-weight:700">${ageText}</span>）`;
        } else {
          // 测试 DOM stub 没有 innerHTML，退回纯文本保证 textContent 断言稳定。
          summaryElement.textContent =
            `${customerText}｜数据最后扫描 ${formatFreshnessClock(dataFreshness.lastScannedAtMs)}（${formatFreshnessAge(dataFreshness.ageSeconds)}）`;
        }
      }
      if (!listElement) {
        return;
      }
      const warningHtml = renderFreshnessWarning(dataFreshness);
      if (rows.length === 0) {
        listElement.innerHTML = `${warningHtml}${renderEmpty("当前没有客户镜像数据，等待后台扫描。")}`;
        return;
      }

      listElement.innerHTML = `${warningHtml}${rows.map(renderOverviewRow).join("")}`;
      syncOpenDetailAfterRender();
    }

    function openDetailByIndex(index, triggerButton) {
      // 这里按当前列表下标打开详情，序号只是显示顺序，不当客户身份。
      const normalizedIndex = Number(index);
      if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= rows.length) {
        throw new Error(`打开客户详情失败：序号不存在，序号=${index}`);
      }
      detailDialog.open(rows[normalizedIndex], normalizedIndex + 1, triggerButton);
    }

    function bindListClick() {
      // 这里用事件委托绑定详情按钮，列表每秒重绘也不会丢事件。
      if (!listElement) {
        return;
      }
      listElement.addEventListener("click", (event) => {
        const detailButton = event.target.closest("[data-customer-detail-index]");
        if (!detailButton) {
          return;
        }
        openDetailByIndex(detailButton.dataset.customerDetailIndex, detailButton);
      });
    }

    function bind() {
      // 这里统一绑定总览列表和详情弹窗事件，入口脚本不关心内部节点。
      bindListClick();
      detailDialog.bind();
    }

    return {
      bind,
      closeDetail: detailDialog.close,
      closeDetailIfVisible: detailDialog.closeIfVisible,
      openDetailByIndex,
      render
    };
  }

  window.createCustomerMirrorCountdownController = createCustomerMirrorCountdownController;
})();
