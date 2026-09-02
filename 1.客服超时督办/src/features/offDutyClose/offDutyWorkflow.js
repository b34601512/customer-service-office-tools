// 该文件是下班监控的公共入口，具体能力拆到 offDutyWorkflow 目录。
const { buildActionSummary } = require("./offDutyWorkflow/actionSummary");
const { isMemberAlreadyClosed } = require("./offDutyWorkflow/memberClosedState");
const { monitorOffDutyWorkflow } = require("./offDutyWorkflow/workflowRunner");

module.exports = {
  buildActionSummary,
  isMemberAlreadyClosed,
  monitorOffDutyWorkflow
};
