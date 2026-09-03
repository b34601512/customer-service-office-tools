// 本文件是提醒判定业务真源（纯函数）：输入上一轮状态+本轮观测，输出提醒事件与新状态。
// 规则：计数新增→提醒（带新单订单号）；POP判责未出→每 verdictPendingRepeatMinutes 重发；判责新出→补一次并停止；
// 登录失效→节流提醒；恢复→提醒一次；首轮可配置基线提醒。判责概念仅对 popDispute 生效，其他类型单视为“已定”不重发。

const STATUS = {
  OK: "ok",
  LOGIN_REQUIRED: "login_required",
  PAGE_ERROR: "page_error"
};

function nowMs(now) {
  return now instanceof Date ? now.getTime() : Number(now) || Date.now();
}

// observations: { [sourceId]: { status, counts, ticketsByLabel, meta } }
// state.sources: { [sourceId]: { counts, status, loginAlertAt, lastAlertAt, tickets: { [label]: [record] } } }

// 工单记录合并（纯函数，就地改 events/不碰外部状态）：
// 新单→记 lastAlertAt=now（随 count_increase 带出订单号，不另发）；
// 未定→定：补发 verdict_decided 一次；仍未定且超过 verdictPendingRepeatMinutes（默认30，0=关）→verdict_pending 重发。
// 只有 popDispute 有判责概念；其他类型单视为已定不重发。深读失败的页签沿用旧记录。
function mergeTickets(prevByLabel, currentByLabel, counts, sourceType, t, options, events, sourceId, meta, changes) {
  const repeatMs = (options.verdictPendingRepeatMinutes === undefined ? 30 : Number(options.verdictPendingRepeatMinutes)) * 60000;
  const verdictTrack = sourceType === "popDispute";
  const nextByLabel = {};
  const changeByLabel = {};
  for (const c of changes || []) changeByLabel[c.label] = c;
  const allLabels = new Set([
    ...Object.keys(prevByLabel),
    ...Object.keys(currentByLabel),
    ...Object.keys(counts)
  ]);
  for (const label of allLabels) {
    const count = Number(counts[label]);
    if (count === 0) continue; // 清零→记录删除（单子已离开该页签）
    if (!(label in counts)) {
      // 本轮没观测到这个页签：原样保留，不重发也不丢
      nextByLabel[label] = (prevByLabel[label] || []).map((tk) => ({ ...tk }));
      continue;
    }
    const prevList = prevByLabel[label] || [];
    const prevById = new Map(prevList.map((tk) => [tk.id, tk]));
    const hasCur = Object.prototype.hasOwnProperty.call(currentByLabel, label);
    if (!hasCur) {
      // 深读失败：沿用旧记录继续参与重发判定（数据旧但不漏提醒）
      const carried = prevList.map((tk) => ({ ...tk }));
      nextByLabel[label] = carried;
      firePendingRepeat(label, carried, verdictTrack, repeatMs, t, events, sourceId, meta, counts);
      continue;
    }
    const merged = [];
    const newTickets = [];
    const decidedNow = [];
    for (const raw of currentByLabel[label]) {
      const decided = verdictTrack ? Boolean(raw.decided) : true;
      const p = prevById.get(raw.id);
      let rec;
      if (!p) {
        rec = { ...raw, decided, firstSeenAt: t, lastAlertAt: t };
        newTickets.push(rec);
      } else if (!p.decided && decided) {
        rec = { ...raw, decided, firstSeenAt: p.firstSeenAt, lastAlertAt: t };
        decidedNow.push(rec);
      } else {
        rec = { ...raw, decided, firstSeenAt: p.firstSeenAt, lastAlertAt: p.lastAlertAt || t };
        if (decided && !rec.verdict && p.verdict) rec.verdict = p.verdict;
      }
      merged.push(rec);
    }
    nextByLabel[label] = merged;
    if (changeByLabel[label] && newTickets.length > 0) changeByLabel[label].tickets = newTickets;
    if (verdictTrack) {
      if (decidedNow.length > 0) {
        events.push({ type: "verdict_decided", sourceId, meta, label, tickets: decidedNow, counts, at: t });
      }
      firePendingRepeat(label, merged, true, repeatMs, t, events, sourceId, meta, counts);
    }
  }
  return nextByLabel;
}

function firePendingRepeat(label, list, verdictTrack, repeatMs, t, events, sourceId, meta, counts) {
  if (!verdictTrack || !(repeatMs > 0)) return;
  const due = list.filter((tk) => !tk.decided && t - (tk.lastAlertAt || 0) >= repeatMs);
  if (due.length === 0) return;
  events.push({ type: "verdict_pending", sourceId, meta, label, tickets: due, counts, at: t });
  due.forEach((tk) => { tk.lastAlertAt = t; });
}

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
    // 工单级状态机（订单号/判责）：新增单写进本轮 count_increase 事件，判责重发/补报在这里起事件。
    const srcType = (obs.meta && obs.meta.sourceType) || "";
    next.tickets = mergeTickets(prev.tickets || {}, obs.ticketsByLabel || {}, currentCounts, srcType, t, options, events, sourceId, meta, changes);
    state.sources[sourceId] = next;
  }

  state.lastRoundAt = t;
  return events;
}

module.exports = { evaluateRound, mergeTickets, STATUS };
