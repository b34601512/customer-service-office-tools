// 本文件是提醒判定业务真源（纯函数）：输入上一轮状态+本轮观测，输出提醒事件与新状态。
// 规则见 #624：计数新增→提醒；登录失效→节流提醒；恢复登录→提醒一次；首发轮可配置基线提醒。

const STATUS = {
  OK: "ok",
  LOGIN_REQUIRED: "login_required",
  PAGE_ERROR: "page_error"
};

function nowMs(now) {
  return now instanceof Date ? now.getTime() : Number(now) || Date.now();
}

// observations: { [sourceId]: { status, counts, loginOk } }
// state.sources: { [sourceId]: { counts, status, loginAlertAt, lastAlertAt, baselineAnnounced } }
function evaluateRound(state, observations, options, now) {
  const t = nowMs(now);
  const events = [];
  state.sources = state.sources || {};

  for (const [sourceId, obs] of Object.entries(observations)) {
    const meta = obs.meta; // { platformName, storeName, sourceName, url, watch, mentionedMobileList }
    const prev = state.sources[sourceId] || { counts: null, status: null, loginAlertAt: 0, lastAlertAt: 0 };
    const next = { ...prev };

    if (obs.status === STATUS.LOGIN_REQUIRED) {
      const throttleMs = (Number(options.loginAlertThrottleMinutes) || 0) * 60000;
      if (prev.status !== STATUS.LOGIN_REQUIRED || t - (prev.loginAlertAt || 0) >= throttleMs) {
        events.push({ type: "login_required", sourceId, meta, at: t });
        next.loginAlertAt = t;
      }
      next.status = STATUS.LOGIN_REQUIRED;
      state.sources[sourceId] = next;
      continue;
    }

    if (obs.status !== STATUS.OK) {
      next.status = obs.status || STATUS.PAGE_ERROR;
      state.sources[sourceId] = next;
      continue;
    }

    // 登录恢复提醒
    if (prev.status === STATUS.LOGIN_REQUIRED) {
      events.push({ type: "login_restored", sourceId, meta, at: t });
    }

    const prevCounts = prev.counts;
    const isFirstObservation = prevCounts === null || prevCounts === undefined;
    const changes = [];
    const currentCounts = obs.counts || {};

    if (isFirstObservation) {
      if (options.alertOnFirstRun) {
        for (const [label, count] of Object.entries(currentCounts)) {
          if (count > 0) {
            changes.push({ label, from: 0, to: count, newItems: count });
          }
        }
        if (changes.length > 0) {
          events.push({ type: "count_increase", sourceId, meta, changes, counts: currentCounts, at: t });
          next.lastAlertAt = t;
        }
      }
    } else {
      for (const [label, count] of Object.entries(currentCounts)) {
        const before = Number(prevCounts[label]);
        const previous = Number.isFinite(before) ? before : count;
        if (count > previous) {
          changes.push({ label, from: previous, to: count, newItems: count - previous });
        }
      }
      if (changes.length > 0) {
        events.push({ type: "count_increase", sourceId, meta, changes, counts: currentCounts, at: t });
        next.lastAlertAt = t;
      } else {
        // 可选：仍未清零时按 repeatReminderMinutes 重复提醒（默认 0 = 关闭，避免过度设计）。
        const repeatMs = (Number(options.repeatReminderMinutes) || 0) * 60000;
        const stillPending = Object.values(currentCounts).some((c) => c > 0);
        const hadPending = Object.values(prevCounts).some((c) => Number(c) > 0);
        if (repeatMs > 0 && stillPending && hadPending && t - (prev.lastAlertAt || 0) >= repeatMs) {
          events.push({ type: "pending_repeat", sourceId, meta, changes: [], counts: currentCounts, at: t });
          next.lastAlertAt = t;
        }
      }
    }

    next.counts = currentCounts;
    next.status = STATUS.OK;
    state.sources[sourceId] = next;
  }

  state.lastRoundAt = t;
  return events;
}

module.exports = { evaluateRound, STATUS };
