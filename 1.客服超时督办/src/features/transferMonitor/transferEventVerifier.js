const { log } = require("../../engine/logger");
const {
  normalizeTransferTimestamp,
  normalizeTransferValue
} = require("./transferMonitorPolicy");
const { fetchTransferMessages } = require("./transferApiClient");
const TRANSFER_SYSTEM_MESSAGE_TYPE = 10000;
const MANUAL_TRANSFER_PAYLOAD_TYPE = 0;
const SYSTEM_ASSIGN_PAYLOAD_TYPE = 3;
const TRANSFER_EVENT_MATCH_WINDOW_MS = 2 * 60 * 1000;

function parseTransferMessageContent(rawContent) {
  // 这里统一把消息 content 还原成对象，避免接口偶发改成字符串时判定层直接失明。
  if (!rawContent) {
    return {};
  }

  if (typeof rawContent === "string") {
    try {
      return JSON.parse(rawContent);
    } catch (error) {
      throw new Error(`转接消息 content 不是合法 JSON：${error.message}`);
    }
  }

  if (typeof rawContent === "object") {
    return rawContent;
  }

  throw new Error(`转接消息 content 类型无法识别：${typeof rawContent}`);
}

function normalizeTransferEvent(message) {
  // 这里把原始消息压成最小判定结构，让“人工转接 / 系统分配”判断只看同一套字段。
  const content = parseTransferMessageContent(message?.content);
  if (Number(content?.type) !== TRANSFER_SYSTEM_MESSAGE_TYPE) {
    return null;
  }

  const payload = content?.payload && typeof content.payload === "object"
    ? content.payload
    : {};
  const subPayload = payload?.subPayload && typeof payload.subPayload === "object"
    ? payload.subPayload
    : {};

  return {
    messageId: normalizeTransferValue(message?.id),
    timestamp: normalizeTransferTimestamp(message?.timestamp || message?.createdAt),
    payloadType: Number(payload?.type),
    opUserId: normalizeTransferValue(subPayload?.opUser?.userId || subPayload?.opUser?.id),
    opUserName: normalizeTransferValue(subPayload?.opUser?.username || subPayload?.opUser?.name),
    assigneeUserId: normalizeTransferValue(
      subPayload?.assigneeUser?.userId || subPayload?.assigneeUser?.id
    ),
    assigneeUserName: normalizeTransferValue(
      subPayload?.assigneeUser?.username || subPayload?.assigneeUser?.name
    )
  };
}

function extractTransferEvents(messages) {
  // 这里统一从消息列表里筛出系统事件，避免上层流程反复解析同一份脏结构。
  return (Array.isArray(messages) ? messages : [])
    .map(normalizeTransferEvent)
    .filter(Boolean)
    .sort((left, right) => right.timestamp - left.timestamp);
}

function buildEventPriority(event) {
  if (
    Number(event?.payloadType) === MANUAL_TRANSFER_PAYLOAD_TYPE &&
    event?.opUserId &&
    event?.assigneeUserId &&
    event.opUserId !== event.assigneeUserId
  ) {
    return 0;
  }

  if (Number(event?.payloadType) === SYSTEM_ASSIGN_PAYLOAD_TYPE) {
    return 1;
  }

  if (
    Number(event?.payloadType) === MANUAL_TRANSFER_PAYLOAD_TYPE &&
    event?.opUserId &&
    event?.opUserId === event?.assigneeUserId
  ) {
    return 2;
  }

  return 3;
}

function findBestMatchedTransferEvent(candidate, events) {
  // 这里用“目标客服 + 本次分配时间”双条件锁定当前事件，避免把旧转接误当成本轮动作。
  const targetAssigneeUserId = normalizeTransferValue(candidate?.assignedToUserId);
  const targetTimestamp = normalizeTransferTimestamp(candidate?.lastAssignedTimestamp);
  if (!targetAssigneeUserId || targetTimestamp <= 0) {
    return null;
  }

  const matchedEvents = (Array.isArray(events) ? events : []).filter((event) => {
    if (event.assigneeUserId !== targetAssigneeUserId) {
      return false;
    }

    if (event.timestamp <= 0) {
      return false;
    }

    return Math.abs(event.timestamp - targetTimestamp) <= TRANSFER_EVENT_MATCH_WINDOW_MS;
  });

  return matchedEvents.sort((left, right) => {
    const leftDistance = Math.abs(left.timestamp - targetTimestamp);
    const rightDistance = Math.abs(right.timestamp - targetTimestamp);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    const leftPriority = buildEventPriority(left);
    const rightPriority = buildEventPriority(right);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return right.timestamp - left.timestamp;
  })[0] || null;
}

function decideTransferCandidateSource(candidate, messages) {
  // 这里把“候选接待变化”最终裁决为人工转接还是系统分配，主流程只消费这个结论。
  const events = extractTransferEvents(messages);
  const matchedEvent = findBestMatchedTransferEvent(candidate, events);
  if (!matchedEvent) {
    return {
      shouldRemind: false,
      sourceLabel: "未匹配事件",
      skipReason: "未找到与本次分配时间对齐的转接事件"
    };
  }

  if (
    Number(matchedEvent.payloadType) === MANUAL_TRANSFER_PAYLOAD_TYPE &&
    matchedEvent.opUserId &&
    matchedEvent.assigneeUserId &&
    matchedEvent.opUserId !== matchedEvent.assigneeUserId
  ) {
    return {
      shouldRemind: true,
      sourceLabel: "人工转接",
      matchedEvent
    };
  }

  if (Number(matchedEvent.payloadType) === SYSTEM_ASSIGN_PAYLOAD_TYPE) {
    return {
      shouldRemind: false,
      sourceLabel: "系统分配",
      skipReason: "命中系统分配事件",
      matchedEvent
    };
  }

  if (
    Number(matchedEvent.payloadType) === MANUAL_TRANSFER_PAYLOAD_TYPE &&
    matchedEvent.opUserId &&
    matchedEvent.opUserId === matchedEvent.assigneeUserId
  ) {
    return {
      shouldRemind: false,
      sourceLabel: "同人操作",
      skipReason: "操作人与接收人相同，不属于人工转给另一位客服",
      matchedEvent
    };
  }

  return {
    shouldRemind: false,
    sourceLabel: `未支持类型${Number(matchedEvent.payloadType)}`,
    skipReason: `当前事件类型=${Number(matchedEvent.payloadType)}，不属于人工转人工提醒范围`,
    matchedEvent
  };
}

async function verifyTransferCandidateByMessages(page, candidate) {
  // 这里串行读取会话消息并裁决来源，确保真正发提醒前只剩“人工转人工”事件。
  const messages = await fetchTransferMessages(page, candidate.chatId);
  const decision = decideTransferCandidateSource(candidate, messages);
  const matchedEvent = decision.matchedEvent;
  const operatorName = normalizeTransferValue(matchedEvent?.opUserName);
  const assigneeName = normalizeTransferValue(matchedEvent?.assigneeUserName);

  if (decision.shouldRemind) {
    log(
      "主线:完成",
      "转接监控",
      "命中人工转接",
      `客户=${candidate.customerName}，转出=${operatorName || matchedEvent.opUserId}，转入=${assigneeName || matchedEvent.assigneeUserId}`
    );
  } else {
    log(
      "主线:执行",
      "转接监控",
      "跳过非人工转接",
      `客户=${candidate.customerName}，来源=${decision.sourceLabel}，原因=${decision.skipReason}`
    );
  }

  return decision;
}

module.exports = {
  decideTransferCandidateSource,
  extractTransferEvents,
  verifyTransferCandidateByMessages
};
