// 该文件用于解决京东登录面自动填充去重标记的问题。
const { tryAutofillLoginFrame } = require("../loginSurfaceParts/jdLoginAutofill");

function hasJdAutofillBeenApplied(surface, autofilledSurfaceMarks) {
  if (!surface || !autofilledSurfaceMarks) {
    return false;
  }

  if (autofilledSurfaceMarks.has(surface)) {
    return true;
  }

  if (typeof surface?.page === "function") {
    return autofilledSurfaceMarks.has(surface.page());
  }

  return false;
}

function markJdAutofillApplied(surface, autofilledSurfaceMarks) {
  if (!surface || !autofilledSurfaceMarks) {
    return;
  }

  autofilledSurfaceMarks.add(surface);
  if (typeof surface?.page === "function") {
    autofilledSurfaceMarks.add(surface.page());
  }
}

async function tryAutofillJdSurfaceOnce(surface, credentials, autofilledSurfaceMarks, options = {}) {
  // 这里保证同一张登录面只自动填一次，避免用户已经提交登录后又被后台循环重复改写。
  if (hasJdAutofillBeenApplied(surface, autofilledSurfaceMarks)) {
    return {
      filled: false,
      skipped: true
    };
  }

  const tryAutofillLoginFrameFn = options.tryAutofillLoginFrameFn || tryAutofillLoginFrame;
  const filled = await tryAutofillLoginFrameFn(surface, credentials);
  if (!filled) {
    return {
      filled: false,
      skipped: false
    };
  }

  markJdAutofillApplied(surface, autofilledSurfaceMarks);
  return {
    filled: true,
    skipped: false
  };
}

module.exports = {
  tryAutofillJdSurfaceOnce
};
