const path = require("path");
const appConfig = require("../../config/appConfig");

module.exports = {
  get defaultScheduleUrl() { return appConfig.scheduleUrl; },
  snapshotDir: path.join(appConfig.runtimeDir, "schedule-query-snapshot"),
  browserViewport: {
    width: 1600,
    height: 1200
  },
  pageReadyTimeout: 60000
};
