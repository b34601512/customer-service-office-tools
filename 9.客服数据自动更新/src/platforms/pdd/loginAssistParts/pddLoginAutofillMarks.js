// 该文件用于解决拼多多登录面单次填充标记和重复填充拦截问题。
const { tryAutofillPddLoginFrame } = require("./pddLoginLocators");

function hasPddAutofillBeenApplied(surface, autofilledSurfaceMarks) {
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

function markPddAutofillApplied(surface, autofilledSurfaceMarks) {
  if (!surface || !autofilledSurfaceMarks) {
    return;
  }

  autofilledSurfaceMarks.add(surface);
  if (typeof surface?.page === "function") {
    autofilledSurfaceMarks.add(surface.page());
  }
}

async function tryAutofillPddSurfaceOnce(surface, credentials, autofilledSurfaceMarks, options = {}) {
  // 这里保证同一张登录面只填一次，避免用户手工验证码时被后台循环覆盖。
  if (hasPddAutofillBeenApplied(surface, autofilledSurfaceMarks)) {
    return {
      switched: false,
      filled: false,
      skipped: true
    };
  }

  const tryAutofillLoginFrameFn = options.tryAutofillLoginFrameFn || tryAutofillPddLoginFrame;
  const result = await tryAutofillLoginFrameFn(surface, credentials);
  if (result.filled) {
    markPddAutofillApplied(surface, autofilledSurfaceMarks);
  }

  return {
    switched: Boolean(result.switched),
    filled: Boolean(result.filled),
    skipped: false
  };
}

module.exports = {
  hasPddAutofillBeenApplied,
  markPddAutofillApplied,
  tryAutofillPddSurfaceOnce
};
