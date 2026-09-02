// 该文件用于从联系人快照里识别企微群聊会话，避免把群消息当成客户消息触发督办提醒。
//
// 识别机制：只用平台官方会话类型字段（任一命中即群，不依赖名称或历史消息）：
// 1. type === 1：联系人接口明确标记的群会话类型（type=0 为客户单聊）；
// 2. wxid 以 "R:" 开头：企微群会话的 Room id 前缀，单聊是普通用户 id；
// 3. memberCount > 0：群才有成员数，客户单聊不返回该字段。
// 以上三条在 2026-08-18 现场采集的 100 个联系人里 100% 吻合、零交叉。
//
// 历史方案里「名称含群字」「多外部发送者」等兜底规则已删除，对应配置项也已下线。

function normalizeGroupChatFilterConfig(replyConfig = {}) {
  // 这里只保留总开关；名称关键词等旧判定已随官方字段方案下线。
  return {
    enabled: replyConfig.groupChatFilterEnabled !== false
  };
}

function isOfficialGroupChatContact(item) {
  // 这里用平台官方会话类型字段判定群聊，不依赖群名和历史消息。
  const type = Number(item?.type);
  if (Number.isFinite(type) && type === 1) {
    return true;
  }

  const wxid = String(item?.wxid || "").trim();
  if (wxid.startsWith("R:")) {
    return true;
  }

  const memberCount = Number(item?.memberCount);
  return Number.isFinite(memberCount) && memberCount > 0;
}

function isGroupChatContact(contact) {
  // 这里只依据归一化阶段算好的官方结构标记，名称关键词与历史消息不再参与判定。
  return Boolean(contact?.isGroupFlag);
}

function filterGroupChatContacts(contacts, config) {
  // 这里把联系人列表拆成“真正客户”和“群聊会话”两份，快照只保留前者。
  const normalizedContacts = Array.isArray(contacts) ? contacts : [];
  const normalizedConfig = config
    ? { enabled: config.enabled !== false }
    : { enabled: true };
  if (!normalizedConfig.enabled) {
    return { contacts: normalizedContacts, groupContacts: [] };
  }

  const customerContacts = [];
  const groupContacts = [];
  for (const contact of normalizedContacts) {
    if (isGroupChatContact(contact)) {
      groupContacts.push(contact);
    } else {
      customerContacts.push(contact);
    }
  }

  return {
    contacts: customerContacts,
    groupContacts
  };
}

module.exports = {
  filterGroupChatContacts,
  isGroupChatContact,
  isOfficialGroupChatContact,
  normalizeGroupChatFilterConfig
};
