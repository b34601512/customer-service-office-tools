const fs = require("fs");
const path = require("path");
const appConfig = require("../../config/appConfig");
const { writeText } = require("./httpResponse");

function handleDocumentRoute(request, response, pathname) {
  // HTML 报表已下线；这里只保留纯文本说明文档。
  if (request.method !== "GET") {
    return false;
  }

  if (pathname === "/docs/readme") {
    writeText(response, 200, fs.readFileSync(path.join(appConfig.projectRoot, "README.md"), "utf8"));
    return true;
  }

  return false;
}

module.exports = {
  handleDocumentRoute
};
