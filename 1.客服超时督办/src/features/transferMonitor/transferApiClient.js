const { randomUUID } = require("crypto");
const appConfig = require("../../config/appConfig");
const { assertFullTargetUrl } = require("../../config/appRuntimeConfig");
const { log } = require("../../engine/logger");
const { parseStaffDisplayName, parseStaffRoleGroup } = require("../shared/staffIdentity");
const { filterGroupChatContacts, isOfficialGroupChatContact, normalizeGroupChatFilterConfig } = require("./groupChatFilter");

const TRANSFER_MONITOR_CONTACTS_PAGE_SIZE = 100;
const MIN_CONTACTS_PAGE_SIZE = 1;
const MAX_CONTACTS_PAGE_SIZE = 100;
const snapshotSummaryLogStateByPage = new WeakMap();

function normalizeApiLogModule(options) {
  // 这里允许复用同一套接口读取能力，但日志仍按调用方模块区分，避免排障时混成转接监控。
  return String(options?.logModuleName || "转接监控").trim() || "转接监控";
}

function normalizeContactsPageSize(value) {
  // 这里把联系人页大小收口，避免调用方传入异常值导致接口一次拉太多或拉不到数据。
  const numericValue = Math.floor(Number(value || TRANSFER_MONITOR_CONTACTS_PAGE_SIZE));
  if (!Number.isFinite(numericValue)) {
    return TRANSFER_MONITOR_CONTACTS_PAGE_SIZE;
  }

  return Math.min(MAX_CONTACTS_PAGE_SIZE, Math.max(MIN_CONTACTS_PAGE_SIZE, numericValue));
}

function shouldLogSnapshotSummary(page, logModuleName, summaryKey) {
  // 这里只在同一页面同一模块的快照摘要变化时打印，避免轮询接口每轮刷相同日志。
  if (!page || typeof page !== "object") {
    return true;
  }

  let stateByModule = snapshotSummaryLogStateByPage.get(page);
  if (!stateByModule) {
    stateByModule = new Map();
    snapshotSummaryLogStateByPage.set(page, stateByModule);
  }

  if (stateByModule.get(logModuleName) === summaryKey) {
    return false;
  }

  stateByModule.set(logModuleName, summaryKey);
  return true;
}

function logSnapshotSummaryIfChanged(page, options, summary) {
  // 这里保留首次读取和状态变化，重复不变的分配快照不再反复写日志。
  const logModuleName = normalizeApiLogModule(options);
  const assignedCount = summary.contacts.filter((item) => item.assignedToUserId).length;
  const summaryKey = [
    summary.contactsPageSize,
    summary.contacts.length,
    summary.members.length,
    assignedCount
  ].join("|");

  if (!shouldLogSnapshotSummary(page, logModuleName, summaryKey)) {
    return;
  }

  log(
    "主线:执行",
    logModuleName,
    "读取分配快照",
    `列表范围=${summary.contactsPageSize}，联系人=${summary.contacts.length}，成员=${summary.members.length}，已分配=${assignedCount}`
  );
}

function resolveTargetRouteMeta() {
  // 这里统一从目标网址里拆 orgId 和 groupId，避免接口层到处手写路径切片。
  const targetUrl = new URL(assertFullTargetUrl(appConfig.targetUrl));
  const segments = targetUrl.pathname.split("/").filter(Boolean);
  if (segments.length < 4) {
    throw new Error(`目标网址格式不合法，无法解析组织与分组：${appConfig.targetUrl}`);
  }

  return {
    origin: targetUrl.origin,
    orgId: String(segments[1] || "").trim(),
    groupId: String(segments[2] || "").trim()
  };
}

function extractAccessTokenFromStoredUser(storedUserText) {
  // 这里统一从页面登录信息里拿 Bearer Token，保证我们和页面自己的接口请求口径一致。
  const normalizedStoredUserText = String(storedUserText || "").trim();
  if (!normalizedStoredUserText) {
    throw new Error("当前页面 localStorage.user 为空，无法读取转接监控接口鉴权 token。");
  }

  let storedUserPayload;
  try {
    storedUserPayload = JSON.parse(normalizedStoredUserText);
  } catch (error) {
    throw new Error(`当前页面 localStorage.user 不是合法 JSON，无法读取转接监控接口鉴权 token：${error.message}`);
  }

  const accessToken = String(storedUserPayload?.token || "").trim();
  if (!accessToken) {
    throw new Error("当前页面登录信息缺少 token，无法调用转接监控接口。");
  }

  return accessToken;
}

async function readTransferMonitorAccessToken(page) {
  // 这里统一从页面上下文读取登录 token，避免手写 fetch 丢失页面里的鉴权头。
  const storedUserText = await page.evaluate(() => window.localStorage.getItem("user"));
  return extractAccessTokenFromStoredUser(storedUserText);
}

function assertTransferMonitorApiSuccess(payload, requestPath, requestLabel) {
  // 这里统一校验接口业务返回码，一旦平台拒绝请求就直接抛出中文根因。
  const responseCode = Number(payload?.code);
  if (Number.isFinite(responseCode) && responseCode !== 0) {
    throw new Error(
      `${requestLabel} 返回失败，code=${responseCode}，路径=${requestPath}，响应片段=${JSON.stringify(payload).slice(0, 300)}`
    );
  }
}

async function fetchJsonInPage(page, requestPath, requestLabel, accessToken) {
  // 这里统一复用页面里的 Bearer Token 发接口请求，独立转接监控不再走“无鉴权裸 fetch”。
  const responsePayload = await page.evaluate(async (input) => {
    const response = await fetch(input.requestPath, {
      credentials: "same-origin",
      headers: {
        accept: "application/json, text/plain, */*",
        authorization: `Bearer ${input.accessToken}`
      }
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text()
    };
  }, { requestPath, accessToken });

  if (!responsePayload.ok) {
    throw new Error(`${requestLabel} 请求失败：HTTP ${responsePayload.status}，路径=${requestPath}`);
  }

  try {
    const payload = JSON.parse(responsePayload.text);
    assertTransferMonitorApiSuccess(payload, requestPath, requestLabel);
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message.includes("返回失败")) {
      throw error;
    }

    throw new Error(`${requestLabel} 返回的不是合法 JSON：${error.message}`);
  }
}

function extractContacts(payload) {
  // 这里统一兼容 contacts 接口常见返回结构，避免页面字段包一层就把监控链路打断。
  if (Array.isArray(payload?.data?.items)) {
    return payload.data.items;
  }

  if (Array.isArray(payload?.data?.data)) {
    return payload.data.data;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  throw new Error("联系人接口返回结构无法识别，未找到数组数据。");
}

function extractMembers(payload) {
  // 这里统一兼容 members 接口常见返回结构，避免成员映射读取对接口包层过度脆弱。
  if (Array.isArray(payload?.data?.members)) {
    return payload.data.members;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  throw new Error("成员接口返回结构无法识别，未找到数组数据。");
}

function extractMessages(payload) {
  // 这里统一兼容 messages 接口常见返回结构，避免消息数组包层变化就让转接判定失效。
  if (Array.isArray(payload?.data?.messages)) {
    return payload.data.messages;
  }

  if (Array.isArray(payload?.data?.items)) {
    return payload.data.items;
  }

  if (Array.isArray(payload?.data?.data)) {
    return payload.data.data;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  throw new Error("消息接口返回结构无法识别，未找到数组数据。");
}

function normalizeContact(item) {
  // 这里额外保留群聊结构字段，供群聊识别机制使用；平台未提供时保持空值不干扰名称规则。
  return {
    chatId: String(item?.id || item?.chatId || "").trim(),
    customerName: String(item?.name || "").trim(),
    previewText: String(item?.lastMessage || "").trim(),
    assignedToUserId: String(item?.assignedTo || "").trim(),
    lastAssignedTimestamp: Number(item?.lastAssignedTimestamp || 0),
    handoverMessage: String(item?.handoverMessage || "").trim(),
    handoverTagColor: String(item?.handoverTagColor || "").trim(),
    isGroupFlag: isOfficialGroupChatContact(item),
    contactTypeText: String(
      item?.type ?? item?.chatType ?? item?.conversationType ?? item?.roomType ?? ""
    ).trim()
  };
}

function normalizeMember(item) {
  const displayName = String(item?.name || "").trim();
  const parsedDisplayName = parseStaffDisplayName(displayName);
  return {
    userId: String(item?.userId || item?.id || "").trim(),
    displayName,
    staffName: parsedDisplayName.memberName,
    roleLabel: parsedDisplayName.roleLabel,
    staffGroup: parseStaffRoleGroup(parsedDisplayName.roleLabel)
  };
}

async function fetchTransferMessages(page, chatId, options = {}) {
  // 这里统一按会话 ID 读取消息列表，专门给“人工转接 / 系统分配”来源核验使用。
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) {
    throw new Error("读取转接消息失败：chatId 为空，无法核验转接来源。");
  }

  const routeMeta = resolveTargetRouteMeta();
  const accessToken = await readTransferMonitorAccessToken(page);
  const uniqueToken = typeof randomUUID === "function"
    ? randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const messagesPath =
    `${routeMeta.origin}/api/chat/messages?timestamp=${Date.now()}&id=${encodeURIComponent(normalizedChatId)}` +
    `&unique=${encodeURIComponent(uniqueToken)}&orgId=${routeMeta.orgId}&groupId=${routeMeta.groupId}`;
  const messagesPayload = await fetchJsonInPage(
    page,
    messagesPath,
    "转接监控消息接口",
    accessToken
  );
  const messages = extractMessages(messagesPayload);

  if (options.logMessageFetch !== false) {
    log(
      "主线:执行",
      normalizeApiLogModule(options),
      "读取消息事件",
      `会话=${normalizedChatId}，消息=${messages.length}`
    );
  }

  return messages;
}

function loadGroupChatFilterConfigSafely() {
  // 这里容错读取群聊识别参数：配置损坏时回退默认规则，不让转接监控因配置问题停摆。
  try {
    const { loadReplyConfig } = require("../../config/replyConfigLoader");
    return normalizeGroupChatFilterConfig(loadReplyConfig());
  } catch (error) {
    log(
      "主线:执行",
      normalizeApiLogModule({ logModuleName: "聊天监控" }),
      "群聊识别",
      `读取群聊识别配置失败，已回退默认规则：${error.message}`
    );
    return normalizeGroupChatFilterConfig();
  }
}

const groupFilterLogStateByPage = new WeakMap();
const contactRawDiagnosisLoggedByPage = new WeakSet();

function compactRawContact(item, maxLength = 300) {
  // 这里把原始联系人条目压成可读短文本，只用于诊断日志，不落盘不参与判断。
  try {
    const text = JSON.stringify(item);
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  } catch (error) {
    return String(item);
  }
}

function logContactRawDiagnosisOnce(page, rawItems) {
  // 这里只在每个浏览器会话首次读取联系人时打印一次原始字段，
  // 方便确认平台返回里区分“单聊/群聊”的真实字段，后续可把结构识别固化成硬规则。
  if (contactRawDiagnosisLoggedByPage.has(page)) {
    return;
  }
  contactRawDiagnosisLoggedByPage.add(page);

  const normalizedItems = Array.isArray(rawItems) ? rawItems : [];
  if (normalizedItems.length === 0) {
    return;
  }

  const keySet = new Set();
  for (const item of normalizedItems) {
    if (item && typeof item === "object") {
      for (const key of Object.keys(item)) {
        keySet.add(key);
      }
    }
  }
  const firstItems = normalizedItems.slice(0, 2);
  const groupNamedItems = normalizedItems
    .filter((item) => String(item?.name || "").includes("群"))
    .slice(0, 2);
  const samples = Array.from(new Set([...firstItems, ...groupNamedItems].map((item) => item))).slice(0, 4);

  log(
    "主线:执行",
    "聊天监控",
    "联系人字段诊断",
    `字段=${Array.from(keySet).slice(0, 30).join(",")}；样例=${samples.map(compactRawContact).join(" || ")}`
  );
}

function logGroupFilterSummaryIfChanged(page, groupContacts) {
  // 这里只在被过滤群聊集合变化时打印一次，避免每轮轮询刷相同日志。
  const groupNames = Array.from(
    new Set(groupContacts.map((contact) => String(contact?.customerName || "").trim()).filter(Boolean))
  ).sort();
  const summaryKey = groupNames.join("|");
  if (groupFilterLogStateByPage.get(page) === summaryKey) {
    return;
  }
  groupFilterLogStateByPage.set(page, summaryKey);

  if (groupNames.length === 0) {
    return;
  }

  log(
    "主线:执行",
    "聊天监控",
    "过滤群聊",
    `已排除群聊会话=${groupContacts.length}，群=${groupNames.length}（示例：${groupNames.slice(0, 3).join("、")}）`
  );
}

async function fetchTransferMonitorSnapshot(page, options = {}) {
  // 这里统一拉取“联系人分配状态 + 成员 ID 映射”，并先剔除群聊会话，
  // 后续转接监控、漏回复监控、超时接收链路共享这份已过滤快照，不再把群消息当客户。
  const routeMeta = resolveTargetRouteMeta();
  const accessToken = await readTransferMonitorAccessToken(page);
  const contactsPageSize = normalizeContactsPageSize(options.contactPageSize);
  const contactsPath =
    `${routeMeta.origin}/api/chat/contacts?assigneeType=0&pageSize=${contactsPageSize}&viewId=&time=${Date.now()}` +
    `&orgId=${routeMeta.orgId}&groupId=${routeMeta.groupId}`;
  const membersPath =
    `${routeMeta.origin}/api/botGroup/members?orgId=${routeMeta.orgId}&groupId=${routeMeta.groupId}`;
  // 这里坚持串行取快照，避免同一页里并发 evaluate+fetch 让成员接口偶发返回 code=3。
  const contactsPayload = await fetchJsonInPage(
    page,
    contactsPath,
    "转接监控联系人接口",
    accessToken
  );
  const membersPayload = await fetchJsonInPage(
    page,
    membersPath,
    "转接监控成员接口",
    accessToken
  );
  const rawContacts = extractContacts(contactsPayload)
    .map(normalizeContact)
    .filter((item) => item.chatId && item.customerName);
  const groupFilterConfig = loadGroupChatFilterConfigSafely();
  const { contacts, groupContacts } = filterGroupChatContacts(rawContacts, groupFilterConfig);
  logContactRawDiagnosisOnce(page, extractContacts(contactsPayload));
  const members = extractMembers(membersPayload)
    .map(normalizeMember)
    .filter((item) => item.userId);
  const memberMapByUserId = Object.fromEntries(members.map((member) => [member.userId, member]));

  logSnapshotSummaryIfChanged(page, options, {
    contactsPageSize,
    contacts,
    members
  });
  logGroupFilterSummaryIfChanged(page, groupContacts);

  return {
    contacts,
    groupContacts,
    memberMapByUserId
  };
}

module.exports = {
  TRANSFER_MONITOR_CONTACTS_PAGE_SIZE,
  extractAccessTokenFromStoredUser,
  extractContacts,
  extractMessages,
  extractMembers,
  fetchTransferMessages,
  fetchTransferMonitorSnapshot,
  logSnapshotSummaryIfChanged,
  normalizeContactsPageSize,
  readTransferMonitorAccessToken,
  resolveTargetRouteMeta,
  shouldLogSnapshotSummary
};
