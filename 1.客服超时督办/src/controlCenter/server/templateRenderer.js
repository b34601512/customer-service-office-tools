const fs = require("fs");
const path = require("path");

function readAssetFile(webRoot, relativePath) {
  // 这里统一读取网页静态资源，避免路由里到处散落文件路径拼接。
  return fs.readFileSync(path.join(webRoot, relativePath));
}

function normalizeHtmlIncludePath(includePath) {
  // 该函数只允许首页模板引用 webRoot 下的相对片段，避免 include 误读到项目外文件。
  if (!includePath || includePath.includes("\\") || includePath.includes("\0")) {
    throw new Error("非法 HTML 片段路径：" + includePath);
  }

  const normalizedPath = path.posix.normalize(includePath).replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath === ".." || normalizedPath.startsWith("../")) {
    throw new Error("非法 HTML 片段路径：" + includePath);
  }

  return normalizedPath;
}

function renderHtmlTemplate(webRoot, relativePath, activeTemplatePaths = new Set()) {
  // 该函数负责把拆分后的 HTML 片段组装成完整页面，保持源码小块维护、浏览器完整接收。
  const normalizedPath = normalizeHtmlIncludePath(relativePath);
  const templatePath = path.resolve(webRoot, normalizedPath);
  if (activeTemplatePaths.has(templatePath)) {
    throw new Error("HTML 片段存在循环引用：" + normalizedPath);
  }

  activeTemplatePaths.add(templatePath);
  try {
    const html = fs.readFileSync(templatePath, "utf8");
    return html.replace(/^[ \t]*<!--\s*@include\s+([^>]+?)\s*-->[ \t]*(?:\r?\n|$)/gm, (_, includePath) => {
      const fragmentHtml = renderHtmlTemplate(webRoot, includePath.trim(), activeTemplatePaths);
      return fragmentHtml.endsWith("\n") ? fragmentHtml : fragmentHtml + "\n";
    });
  } finally {
    activeTemplatePaths.delete(templatePath);
  }
}

module.exports = {
  readAssetFile,
  normalizeHtmlIncludePath,
  renderHtmlTemplate
};
