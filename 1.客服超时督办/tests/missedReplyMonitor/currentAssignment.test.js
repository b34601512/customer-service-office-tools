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

test("assignedTo 为空时历史操作人和发信人不得补成当前接待", () => {
  const assignment = resolveCurrentAssignment({
    assignedToUserId: "",
    assigneeFallbackStaffName: "卢安",
    agentHandlerCandidates: [{ userId: "staff_deng", staffName: "卢安" }]
  }, members);

  assert.equal(assignment.status, ASSIGNMENT_STATUS.UNASSIGNED);
  assert.equal(assignment.assigneeMember, null);
  assert.equal(assignment.assignedToUserId, "");
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
