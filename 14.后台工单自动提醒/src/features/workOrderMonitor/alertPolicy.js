// 本文件是提醒判定业务真源（纯函数）：输入上一轮状态+本轮观测，输出提醒事件与新状态。
// 规则（用户 2026-09-03 两次修正后）：
// 1) 计数新增→提醒（带新单订单号）。
// 2) 纠纷**看状态不看判责**（实测判责列会把已关闭单误当未判责刷屏）：待商家处理/待商家回复→每 merchantPendingRepeatMinutes（默认30，0=关）重发；
//    待客户确认/关闭等=客服已处理或完结→不提醒；状态转完结→静默停发不补报。
// 3) 操作列含“去申诉”的单→只随新增提醒一次，永不重发。
// 4) 登录失效→节流提醒；恢复→提醒一次；首轮可配置基线提醒。
// 5) 无状态列的页型（京喜工单解析不出状态）天然不参与重发，只随计数新增提醒。
// 发送时一单一消息（messageText.expandMessages），事件内部仍按页签聚合。

const STATUS = {
  OK: "ok",
  LOGIN_REQUIRED: "login_required",
  PAGE_ERROR: "page_error"
};

const ATTENTION_STATUSES = new Set(["待商家处理", "待商家回复"]);

function nowMs(now) {
  return now instanceof Date ? now.getTime() : Number(now) || Date.now();
}

// 是否持续催办：去申诉机会单永不重发；仅待商家处理/待商家回复重发。
function needsRepeat(tk) {
  if (tk.canAppeal) return false;
  return ATTENTION_STATUSES.has(String(tk.status || ""));
}

// observations: { [sourceId]: { status, counts, ticketsByLabel, meta } }
// state.sources: { [sourceId]: { counts, status, loginAlertAt, lastAlertAt, tickets: { [label]: [record] } } }
function mergeTickets(prevByLabel, currentByLabel, counts, t, options, events, sourceId, meta, changes) {
  const repeatMs = (options.merchantPendingRepeatMinutes === undefined ? 30 : Number(options.merchantPendingRepeatMinutes)) * 60000;
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
      firePendingRepeat(label, carried, repeatMs, t, events, sourceId, meta, counts);
      continue;
    }
    const merged = [];
    const newTickets = [];
    for (const raw of currentByLabel[label]) {
      const p = prevById.get(raw.id);
      const rec = { ...raw, firstSeenAt: p ? p.firstSeenAt : t, lastAlertAt: p ? p.lastAlertAt || t : t };
      if (!p) newTickets.push(rec);
      merged.push(rec);
    }
    nextByLabel[label] = merged;
    if (changeByLabel[label] && newTickets.length > 0) changeByLabel[label].tickets = newTickets;
    firePendingRepeat(label, merged, repeatMs, t, events, sourceId, meta, counts);
  }
  return nextByLabel;
}

function firePendingRepeat(label, list, repeatMs, t, events, sourceId, meta, counts) {
  if (!(repeatMs > 0)) return;
  const due = list.filter((tk) => needsRepeat(tk) && t - (tk.lastAlertAt || 0) >= repeatMs);
  if (due.length === 0) return;
  events.push({ type: "pending_handling", sourceId, meta, label, tickets: due, counts, at: t });
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
    next.tickets = mergeTickets(prev.tickets || {}, obs.ticketsByLabel || {}, currentCounts, t, options, events, sourceId, meta, changes);
    state.sources[sourceId] = next;
  }

  state.lastRoundAt = t;
  return events;
}

module.exports = { evaluateRound, mergeTickets, needsRepeat, STATUS };
