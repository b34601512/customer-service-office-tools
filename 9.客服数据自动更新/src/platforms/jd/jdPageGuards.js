const { attemptDismissJdPopup, stabilizeJdBrowser, readSurfaceBodyText } = require("./jdPopupAndSurfaceState");
const { findFirstVisibleLocator, findVisibleTextLocator, clickVisibleText } = require("./jdVisibleTextLocators");
const {
  clickFirstVisibleTextInBrowser,
  findSurfaceWithVisibleText,
  findJdReportSurface
} = require("./jdBrowserSurfaceWaiters");

module.exports = {
  attemptDismissJdPopup,
  stabilizeJdBrowser,
  findFirstVisibleLocator,
  findVisibleTextLocator,
  clickVisibleText,
  clickFirstVisibleTextInBrowser,
  findSurfaceWithVisibleText,
  findJdReportSurface,
  readSurfaceBodyText
};
