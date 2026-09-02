const { buildPersistedWecomRobotConfig, buildWecomRobotConfigModel } = require("./wecomRobotConfigModel/modelBuilder");
const { normalizeMemberMobileMap } = require("./wecomRobotConfigModel/legacyMemberMaps");
const { normalizeNotificationGroups } = require("./wecomRobotConfigModel/notificationGroups");
const { normalizeStaffDirectory } = require("./wecomRobotConfigModel/staffDirectory");

module.exports = {
  buildPersistedWecomRobotConfig,
  buildWecomRobotConfigModel,
  normalizeMemberMobileMap,
  normalizeNotificationGroups,
  normalizeStaffDirectory
};
