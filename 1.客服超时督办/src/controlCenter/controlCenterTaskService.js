const { ControlCenterTaskService } = require("./taskService/controlCenterTaskService");
const { isStructuredChildLogLine } = require("./taskService/structuredChildLogLine");

module.exports = {
  ControlCenterTaskService,
  isStructuredChildLogLine
};
