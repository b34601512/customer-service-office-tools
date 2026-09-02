const path = require("path");
const { readAssetFile } = require("./templateRenderer");
const { writeText } = require("./httpResponse");

function normalizeNestedAssetPath(routePrefix, pathname) {
  // 该函数用于把拆分后的静态资源路径收口，避免路由层散落多个文件名判断。
  const nestedPath = pathname.slice(routePrefix.length);
  const normalizedPath = path.posix.normalize(decodeURIComponent(nestedPath)).replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
    throw new Error("非法静态资源路径：" + pathname);
  }

  return normalizedPath;
}

function tryWriteNestedAsset(response, webRoot, routePrefix, pathname, assetDir, contentType) {
  // 该函数只负责返回拆分后的前端静态资源，业务接口不关心具体文件结构。
  if (!pathname.startsWith(routePrefix)) {
    return false;
  }

  const nestedPath = normalizeNestedAssetPath(routePrefix, pathname);
  const relativePath = path.join(assetDir, nestedPath);
  writeText(response, 200, readAssetFile(webRoot, relativePath), contentType);
  return true;
}

module.exports = {
  normalizeNestedAssetPath,
  tryWriteNestedAsset
};
