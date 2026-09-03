// 当前接待唯一事实：只读取联系人接口的 assignedTo；assignedTo 清空（如结束会话）时，按会话内最后一条人工消息发送人兜底归属最后接待客服。
const { parseStaffDisplayName } = require("./staffIdentity");

const ASSIGNMENT_STATUS = Object.freeze({
  ASSIGNED: "assigned",
  UNASSIGNED: "unassigned",
  MEMBER_MAPPING_MISSING: "member_mapping_missing",
  LAST_HANDLER: "last_handler"
});

const ASSIGNMENT_STATUS_LABEL = Object.freeze({
  [ASSIGNMENT_STATUS.ASSIGNED]: "当前会话已分配客服",
  [ASSIGNMENT_STATUS.UNASSIGNED]: "当前会话未分配客服",
  [ASSIGNMENT_STATUS.MEMBER_MAPPING_MISSING]: "当前接待ID缺少成员映射",
  [ASSIGNMENT_STATUS.LAST_HANDLER]: "会话已结束，按最后接待客服归属"
});

function normalizeAssignmentStatus(value, assignmentFields = {}) {
  // 旧账本没有状态字段时，只按当时保存的当前接待 ID 推导，绝不使用历史操作人。
  const normalizedValue = String(value || "").trim();
  if (Object.values(ASSIGNMENT_STATUS).includes(normalizedValue)) {
    return normalizedValue;
  }

  const assignedToUserId = String(assignmentFields?.assigneeUserId || assignmentFields?.assignedToUserId || "").trim();
  if (!assignedToUserId) {
    return ASSIGNMENT_STATUS.UNASSIGNED;
  }

  const assigneeName = String(assignmentFields?.assigneeName || "").trim();
  if (!assigneeName || assigneeName === "未识别客服" || assigneeName === assignedToUserId) {
    return ASSIGNMENT_STATUS.MEMBER_MAPPING_MISSING;
  }

  return ASSIGNMENT_STATUS.ASSIGNED;
}

function resolveAssignmentStatusLabel(status) {
  return ASSIGNMENT_STATUS_LABEL[normalizeAssignmentStatus(status)] || ASSIGNMENT_STATUS_LABEL[ASSIGNMENT_STATUS.UNASSIGNED];
}

function findMemberBySenderName(senderName, memberMapByUserId = {}) {
  // 最后接待兜底只用在人工消息里出现过的发送人，按成员表姓名口径匹配，匹配不到不得虚构责任人。
  const normalizedSender = String(senderName || "").trim();
  if (!normalizedSender) {
    return null;
  }

  const { memberName } = parseStaffDisplayName(normalizedSender);
  const members = Object.values(memberMapByUserId || {});
  return members.find(
    (member) => member
      && String(member.staffName || "").trim()
      && (member.staffName === memberName || member.staffName === normalizedSender || member.displayName === normalizedSender)
  ) || null;
}

function resolveCurrentAssignment(contact, memberMapByUserId = {}, fallbackFields = {}) {
  // assignedTo 是平台对“当前接待”的直接陈述；为空时先按最后接待客服兜底，兜不到才是真的未分配。
  const assignedToUserId = String(contact?.assignedToUserId || "").trim();
  if (!assignedToUserId) {
    const lastHandlerMember = findMemberBySenderName(fallbackFields?.lastHandlerSenderName, memberMapByUserId);
    if (lastHandlerMember) {
      return {
        assignedToUserId: "",
        status: ASSIGNMENT_STATUS.LAST_HANDLER,
        statusLabel: ASSIGNMENT_STATUS_LABEL[ASSIGNMENT_STATUS.LAST_HANDLER],
        assigneeMember: lastHandlerMember
      };
    }

    return {
      assignedToUserId: "",
      status: ASSIGNMENT_STATUS.UNASSIGNED,
      statusLabel: ASSIGNMENT_STATUS_LABEL[ASSIGNMENT_STATUS.UNASSIGNED],
      assigneeMember: null
    };
  }

  const assigneeMember = memberMapByUserId?.[assignedToUserId] || null;
  if (!assigneeMember || !String(assigneeMember.staffName || "").trim()) {
    return {
      assignedToUserId,
      status: ASSIGNMENT_STATUS.MEMBER_MAPPING_MISSING,
      statusLabel: ASSIGNMENT_STATUS_LABEL[ASSIGNMENT_STATUS.MEMBER_MAPPING_MISSING],
      assigneeMember: null
    };
  }

  return {
    assignedToUserId,
    status: ASSIGNMENT_STATUS.ASSIGNED,
    statusLabel: ASSIGNMENT_STATUS_LABEL[ASSIGNMENT_STATUS.ASSIGNED],
    assigneeMember
  };
}

module.exports = {
  ASSIGNMENT_STATUS,
  findMemberBySenderName,
  normalizeAssignmentStatus,
  resolveAssignmentStatusLabel,
  resolveCurrentAssignment
};
