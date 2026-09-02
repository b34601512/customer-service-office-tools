const {
  readIndexHtml,
  readCssBundle,
  settingsHtmlPath,
  settingsScript,
  styleEntryPath
} = require("./controlCenterWebAppAssets");
const { createAppPageHarness } = require("./controlCenterWebAppHarness");
const {
  createIndexConfigModalHarness,
  createSettingsPageHarness
} = require("./controlCenterWebSettingsHarness");
const { createLogPageHarness } = require("./controlCenterWebLogHarness");

module.exports = {
  readIndexHtml,
  readCssBundle,
  settingsHtmlPath,
  settingsScript,
  styleEntryPath,
  createAppPageHarness,
  createIndexConfigModalHarness,
  createSettingsPageHarness,
  createLogPageHarness
};
