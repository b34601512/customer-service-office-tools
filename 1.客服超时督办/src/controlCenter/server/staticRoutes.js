const path = require("path");
const { readAssetFile, renderHtmlTemplate } = require("./templateRenderer");
const { tryWriteNestedAsset } = require("./nestedAssetResponse");
const { writeText } = require("./httpResponse");

function handleStaticRoute(request, response, pathname, webRoot) {
  // 这里只处理前端静态资源，避免 API 路由夹杂页面文件读取逻辑。
  if (request.method !== "GET") {
    return false;
  }

  if (pathname === "/" || pathname === "/index.html") {
    writeText(response, 200, renderHtmlTemplate(webRoot, "index.html"), "text/html; charset=utf-8");
    return true;
  }

  if (tryWriteNestedAsset(response, webRoot, "/app/", pathname, "app", "application/javascript; charset=utf-8")) {
    return true;
  }

  if (tryWriteNestedAsset(response, webRoot, "/settings/", pathname, "settings", "application/javascript; charset=utf-8")) {
    return true;
  }

  if (tryWriteNestedAsset(response, webRoot, "/styles/", pathname, "styles", "text/css; charset=utf-8")) {
    return true;
  }

  const fileRoutes = new Map([
    ["/countdown/customerMirrorDetailDialog.js", [path.join("countdown", "customerMirrorDetailDialog.js"), "application/javascript; charset=utf-8"]],
    ["/countdown/customerMirrorList.js", [path.join("countdown", "customerMirrorList.js"), "application/javascript; charset=utf-8"]],
    ["/shared/requestJson.js", [path.join("shared", "requestJson.js"), "application/javascript; charset=utf-8"]],
    ["/settings", ["settings.html", "text/html; charset=utf-8"]],
    ["/viewer", ["viewer.html", "text/html; charset=utf-8"]],
    ["/viewer.js", ["viewer.js", "application/javascript; charset=utf-8"]],
    ["/logs", ["logs.html", "text/html; charset=utf-8"]],
    ["/logs.js", ["logs.js", "application/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
    ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
    ["/assets/supervisor-icon.svg", [path.join("assets", "supervisor-icon.svg"), "image/svg+xml; charset=utf-8"]],
    ["/favicon.ico", [path.join("assets", "supervisor-icon.svg"), "image/svg+xml; charset=utf-8"]]
  ]);

  const assetRoute = fileRoutes.get(pathname);
  if (!assetRoute) {
    return false;
  }

  writeText(response, 200, readAssetFile(webRoot, assetRoute[0]), assetRoute[1]);
  return true;
}

module.exports = {
  handleStaticRoute
};
