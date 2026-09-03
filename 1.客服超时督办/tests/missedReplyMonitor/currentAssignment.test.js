const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ASSIGNMENT_STATUS,
  normalizeAssignmentStatus,
  resolveCurrentAssignment
} = require("../../src/features/shared/currentAssignment");

const members = {
  staff_deng: {
    userId: "staff_deng",
    staffName: "卢安",
    roleLabel: "售后客服",
    staffGroup: "after_sales"
  }
};

test("当前接待只按联系人 assignedTo 解析", () => {
  const assignment = resolveCurrentAssignment({ assignedToUserId: "staff_deng" }, members);

  assert.equal(assignment.status, ASSIGNMENT_STATUS.ASSIGNED);
  assert.equal(assignment.assigneeMember.staffName, "卢安");
});

test("assignedTo 为空且无最后接待兜底信息时仍报未分配", () => {
  const assignment = resolveCurrentAssignment({
    assignedToUserId: "",
    assigneeFallbackStaffName: "卢安",
    agentHandlerCandidates: [{ userId: "staff_deng", staffName: "卢安" }]
  }, members);

  assert.equal(assignment.status, ASSIGNMENT_STATUS.UNASSIGNED);
  assert.equal(assignment.assigneeMember, null);
  assert.equal(assignment.assignedToUserId, "");
});

// issue #621：会话结束清空 assignedTo 后，按最后接待客服兜底归属，避免丢失责任人。
test("assignedTo 为空但会话内有可映射的最后接待人时应兜底为 last_handler", () => {
  const assignment = resolveCurrentAssignment(
    { assignedToUserId: "" },
    members,
    { lastHandlerSenderName: "卢安（售后客服）" }
  );

  assert.equal(assignment.status, ASSIGNMENT_STATUS.LAST_HANDLER);
  assert.equal(assignment.assignedToUserId, "");
  assert.equal(assignment.assigneeMember.staffName, "卢安");
});

test("最后接待发送人映射不到成员表时应回落未分配", () => {
  const assignment = resolveCurrentAssignment(
    { assignedToUserId: "" },
    members,
    { lastHandlerSenderName: "查无此人（售后客服）" }
  );

  assert.equal(assignment.status, ASSIGNMENT_STATUS.UNASSIGNED);
  assert.equal(assignment.assigneeMember, null);
});

test("平台已分配时最后接待兜底不得覆盖当前接待", () => {
  const assignment = resolveCurrentAssignment(
    { assignedToUserId: "staff_deng" },
    members,
    { lastHandlerSenderName: "查无此人" }
  );

  assert.equal(assignment.status, ASSIGNMENT_STATUS.ASSIGNED);
  assert.equal(assignment.assigneeMember.staffName, "卢安");
});

test("assignedTo 有值但成员表无记录时应该明确为映射缺失", () => {
  const assignment = resolveCurrentAssignment({ assignedToUserId: "staff_unknown" }, members);

  assert.equal(assignment.status, ASSIGNMENT_STATUS.MEMBER_MAPPING_MISSING);
  assert.equal(assignment.assigneeMember, null);
  assert.equal(assignment.assignedToUserId, "staff_unknown");
});

test("旧账本中的未识别客服应该归为未分配而不是虚构员工", () => {
  assert.equal(
    normalizeAssignmentStatus("", { assigneeUserId: "", assigneeName: "未识别客服" }),
    ASSIGNMENT_STATUS.UNASSIGNED
  );
});
