const { evaluate, waitFor } = require("./page_runtime");
const { log } = require("./logger");

function openPhoneMenuScript() {
  return `
(() => {
  const documents = [document];
  for (const frame of [...document.querySelectorAll("iframe,frame")]) {
    try {
      if (frame.contentDocument) documents.push(frame.contentDocument);
    } catch (_) {}
  }
  const visible = (node) => {
    if (!node) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const textOf = (node) => String(node.innerText || node.value || node.textContent || "").trim().replace(/\\s+/g, "");
  const links = documents.flatMap((doc) => [...doc.querySelectorAll("a[href],a[onclick]")]).filter(visible);
  const phoneLink = links.find((node) => textOf(node) === "电话" && String(node.getAttribute("href") || "").includes("menuId=1181"));
  if (!phoneLink) return { clicked: false, reason: "未找到顶部电话菜单链接" };
  phoneLink.scrollIntoView({ block: "center", inline: "center" });
  const view = phoneLink.ownerDocument.defaultView || window;
  for (const type of ["pointerover", "mouseover", "pointerdown", "mousedown", "mouseup", "pointerup", "click"]) {
    phoneLink.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true, view }));
  }
  if (typeof phoneLink.click === "function") phoneLink.click();
  return { clicked: true, href: String(phoneLink.getAttribute("href") || ""), text: textOf(phoneLink) };
})()
`;
}

function phoneMenuReadyScript() {
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
  const textOf = (node) => String(node.innerText || node.value || node.textContent || "").trim().replace(/\\s+/g, "");
  return collectDocuments(document).some((doc) =>
    typeof doc.defaultView.setThreeColor === "function" &&
    [...doc.querySelectorAll("span,a,li,div")].some((node) => textOf(node) === "呼入") &&
    [...doc.querySelectorAll("span,a,li,div")].some((node) => textOf(node) === "呼损")
  );
})()
`;
}

async function ensurePhoneMenu(cdp, sessionId) {
  const alreadyInPhoneMenu = await evaluate(cdp, sessionId, phoneMenuReadyScript()).catch(() => false);
  if (!alreadyInPhoneMenu) {
    log("点击", "顶部电话入口");
    const phoneMenu = await evaluate(cdp, sessionId, openPhoneMenuScript());
    if (!phoneMenu.clicked) throw new Error(`点击顶部电话入口失败：${phoneMenu.reason || "未找到入口"}`);
  } else {
    log("点击", "已在电话明细菜单，跳过顶部电话入口");
  }
  await waitFor(cdp, sessionId, phoneMenuReadyScript(), "电话明细菜单", 30000);
}

module.exports = {
  ensurePhoneMenu,
  phoneMenuReadyScript
};
