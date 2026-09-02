const { evaluate, readPageSummary, waitFor } = require("./page_runtime");
const { log } = require("./logger");

function loginScript(config) {
  return `
(() => {
  const textOf = (node) => (node && (node.innerText || node.value || node.textContent || "") || "").trim();
  const visible = (node) => {
    if (!node) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const setInput = (selector, value) => {
    const node = document.querySelector(selector);
    if (!node) return false;
    node.focus();
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    node.blur();
    return true;
  };
  const visibleTexts = [...document.querySelectorAll("body *")].filter(visible).map(textOf).filter(Boolean);
  const captcha = visibleTexts.find((text) => /^[A-Za-z0-9]{4}$/.test(text)) || "";
  const companyCodeInput = document.querySelector("#companyCode");
  if (!visible(companyCodeInput)) return { stage: "alreadyLoggedIn" };
  const fields = {
    companyCode: setInput("#companyCode", ${JSON.stringify(config.companyCode || "")}),
    account: setInput("#account", ${JSON.stringify(config.account || "")}),
    password: setInput("#password", ${JSON.stringify(config.password || "")}),
    captcha: setInput("#captchaInput", captcha)
  };
  const remember = document.querySelector("#chkRememberPass");
  if (remember && !remember.checked) remember.click();
  const loginButton = document.querySelector("#login_id");
  if (loginButton) {
    const view = loginButton.ownerDocument.defaultView || window;
    for (const type of ["pointerdown", "mousedown", "mouseup", "pointerup", "click"]) {
      loginButton.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true, view }));
    }
    if (typeof loginButton.click === "function") loginButton.click();
  }
  return { stage: "loginClicked", captchaLength: captcha.length, fields, clickedLogin: Boolean(loginButton) };
})()
`;
}

function loggedInAndHasTextScript(texts) {
  return `
(() => {
  const targets = ${JSON.stringify(Array.isArray(texts) ? texts : [texts])};
  const collectDocuments = (rootDocument, result = []) => {
    result.push(rootDocument);
    for (const frame of [...rootDocument.querySelectorAll("iframe,frame")]) {
      try {
        if (frame.contentDocument) collectDocuments(frame.contentDocument, result);
      } catch (_) {}
    }
    return result;
  };
  const documents = collectDocuments(document);
  const visible = (node) => {
    if (!node) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const textOf = (node) => (node.innerText || node.value || node.textContent || "").trim();
  if (documents.some((doc) => visible(doc.querySelector("#companyCode")))) return false;
  const nodes = documents.flatMap((doc) => [...doc.querySelectorAll("a,button,input,li,span,div")]).filter(visible);
  return nodes.some((node) => targets.some((text) => textOf(node) === text || textOf(node).includes(text)));
})()
`;
}

function loginPageOrHomeReadyScript() {
  return `
(() => {
  const collectDocuments = (rootDocument, result = []) => {
    result.push(rootDocument);
    for (const frame of [...rootDocument.querySelectorAll("iframe,frame")]) {
      try {
        if (frame.contentDocument) collectDocuments(frame.contentDocument, result);
      } catch (_) {}
    }
    return result;
  };
  const documents = collectDocuments(document);
  const visible = (node) => {
    if (!node) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const textOf = (node) => (node.innerText || node.value || node.textContent || "").trim();
  const hasLogin = documents.some((doc) => visible(doc.querySelector("#companyCode")) && visible(doc.querySelector("#captchaInput")));
  const hasHome = documents.some((doc) => [...doc.querySelectorAll("a,button,input,li,span,div")].some((node) => visible(node) && textOf(node).includes("电话")));
  return hasLogin || hasHome;
})()
`;
}

async function ensureLoggedIn(cdp, sessionId, config) {
  log("登录检查", "准备自动填充或复用登录态");
  await waitFor(cdp, sessionId, loginPageOrHomeReadyScript(), "登录页或首页出现", config.loginWaitMs);
  const loginPayload = await evaluate(cdp, sessionId, loginScript(config));
  if (loginPayload.stage === "loginClicked") {
    log("验证码填写", `长度=${loginPayload.captchaLength || 0} 公司=${Boolean(loginPayload.fields && loginPayload.fields.companyCode)} 账号=${Boolean(loginPayload.fields && loginPayload.fields.account)} 密码=${Boolean(loginPayload.fields && loginPayload.fields.password)} 验证码=${Boolean(loginPayload.fields && loginPayload.fields.captcha)} 登录=${Boolean(loginPayload.clickedLogin)}`);
  } else {
    log("登录检查", "已复用登录态");
  }
  try {
    await waitFor(cdp, sessionId, loggedInAndHasTextScript("电话"), "登录完成并出现电话入口", config.loginWaitMs);
  } catch (error) {
    const summary = await readPageSummary(cdp, sessionId);
    throw new Error(`登录后未进入首页或未出现电话入口：${error.message} 当前地址=${summary.url} 页面文本=${summary.text}`);
  }
}

module.exports = { ensureLoggedIn };
