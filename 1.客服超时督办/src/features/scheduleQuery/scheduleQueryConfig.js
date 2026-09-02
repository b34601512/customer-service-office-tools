const path = require("path");
const appConfig = require("../../config/appConfig");

module.exports = {
  defaultScheduleUrl: "https://www.kdocs.cn/l/cga7jWGHxzkp",
  snapshotDir: path.join(appConfig.runtimeDir, "schedule-query-snapshot"),
  browserViewport: {
    width: 1600,
    height: 1200
  },
  pageReadyTimeout: 60000
};
