// 当前接待唯一事实：只读取联系人接口的 assignedTo，不从历史消息推断。
const ASSIGNMENT_STATUS = Object.freeze({
  ASSIGNED: "assigned",
  UNASSIGNED: "unassigned",
  MEMBER_MAPPING_MISSING: "member_mapping_missing"
});

const ASSIGNMENT_STATUS_LABEL = Object.freeze({
  [ASSIGNMENT_STATUS.ASSIGNED]: "当前会话已分配客服",
  [ASSIGNMENT_STATUS.UNASSIGNED]: "当前会话未分配客服",
  [ASSIGNMENT_STATUS.MEMBER_MAPPING_MISSING]: "当前接待ID缺少成员映射"
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

function resolveCurrentAssignment(contact, memberMapByUserId = {}) {
  // assignedTo 是平台对“当前接待”的直接陈述；为空就是未分配，有值却查不到成员才是映射缺失。
  const assignedToUserId = String(contact?.assignedToUserId || "").trim();
  if (!assignedToUserId) {
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
  normalizeAssignmentStatus,
  resolveAssignmentStatusLabel,
  resolveCurrentAssignment
};
