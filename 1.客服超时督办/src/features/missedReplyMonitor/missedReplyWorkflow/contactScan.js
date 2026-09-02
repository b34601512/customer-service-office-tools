// 该文件用于选择每轮漏回复扫描联系人，并补齐控制台展示顺序。
function selectContactsForMissedReplyScan(runtimeState, contacts, maxContactsPerScan) {
  // 这里在完整联系人范围里按小批轮转，避免一轮读取太多消息卡电脑。
  const normalizedContacts = Array.isArray(contacts) ? contacts : [];
  if (normalizedContacts.length === 0) {
    runtimeState.nextContactStartIndex = 0;
    return [];
  }

  const normalizedLimit = Math.min(
    normalizedContacts.length,
    Math.max(1, Math.floor(Number(maxContactsPerScan) || 5))
  );
  if (normalizedLimit >= normalizedContacts.length) {
    runtimeState.nextContactStartIndex = 0;
    return normalizedContacts;
  }

  const startIndex = Math.max(0, runtimeState.nextContactStartIndex % normalizedContacts.length);
  const selectedContacts = [];
  for (let offset = 0; offset < normalizedLimit; offset += 1) {
    selectedContacts.push(normalizedContacts[(startIndex + offset) % normalizedContacts.length]);
  }

  runtimeState.nextContactStartIndex = (startIndex + normalizedLimit) % normalizedContacts.length;
  return selectedContacts;
}

function attachContactListIndexes(contacts) {
  // 这里把接口返回顺序写进快照，控制台才能镜像“系统看到的客户列表”。
  return (Array.isArray(contacts) ? contacts : []).map((contact, index) => ({
    ...contact,
    contactListIndex: index + 1
  }));
}

module.exports = {
  attachContactListIndexes,
  selectContactsForMissedReplyScan
};
