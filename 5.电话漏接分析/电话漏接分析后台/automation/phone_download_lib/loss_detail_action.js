const { evaluate, waitFor } = require("./page_runtime");
const { log } = require("./logger");

function lossDetailFilterScript(phone) {
  return `
(() => {
  const phone = ${JSON.stringify(phone)};
  const collectDocuments = (rootDocument, result = []) => {
    result.push(rootDocument);
    for (const frame of [...rootDocument.querySelectorAll("iframe,frame")]) {
      try {
        if (frame.contentDocument) collectDocuments(frame.contentDocument, result);
      } catch (_) {}
    }
    return result;
  };
  const visible = (node) => {
    if (!node) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const textOf = (node) => String(node.innerText || node.value || node.textContent || "").trim().replace(/\\s+/g, "");
  const setValue = (node, value) => {
    node.focus();
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    node.blur();
  };
  const clickNode = (node) => {
    if (!node) return false;
    const clickable = node.closest("button,a,[role='button'],[onclick]") || node;
    const view = clickable.ownerDocument.defaultView || window;
    for (const type of ["pointerdown", "mousedown", "mouseup", "pointerup", "click"]) {
      clickable.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true, view }));
    }
    if (typeof clickable.click === "function") clickable.click();
    return true;
  };
  const clickableText = (node) => textOf(node).replace(/\\s+/g, "");
  const findQueryButton = () => {
    const controls = [...targetDocument.querySelectorAll("button,input[type='button'],a,[onclick]")]
      .filter(visible)
      .map((node) => {
        const text = clickableText(node);
        let score = 0;
        if (text === "查询") score += 1000;
        if (text.includes("查询")) score += 100;
        if (node.tagName === "INPUT" || node.tagName === "BUTTON") score += 50;
        if (String(node.getAttribute("onclick") || "").includes("query")) score += 20;
        return { node, text, score };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    return controls[0] || null;
  };
  const reportScore = (doc) => {
    const body = String(doc.body && doc.body.innerText || "");
    const url = String(doc.location && doc.location.href || "");
    if (/inboundFailPage|CALL_FAIL/i.test(url)) return 100;
    if (body.includes("丢失位置") && body.includes("排队停留")) return 50;
    return 0;
  };
  const targetDocument = collectDocuments(document)
    .map((doc) => ({ doc, score: reportScore(doc) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.doc;
  if (!targetDocument) return { ok: false, message: "未找到呼损报表页" };

  const inputs = [...targetDocument.querySelectorAll("input[type='text'],input:not([type])")].filter(visible);
  const dateInputs = inputs.filter((input) => /\\d{4}-\\d{2}-\\d{2}|时间|date|time/i.test(input.value + " " + input.id + " " + input.name + " " + input.className));
  const labelNearInput = (input) => {
    const rect = input.getBoundingClientRect();
    return [...targetDocument.querySelectorAll("label,span,td,th,div")]
      .filter(visible)
      .filter((node) => {
        const labelRect = node.getBoundingClientRect();
        const sameRow = Math.abs(labelRect.top - rect.top) < 28;
        const beforeInput = labelRect.right <= rect.left + 12 && rect.left - labelRect.right < 180;
        return sameRow && beforeInput;
      })
      .map(textOf)
      .join(" ");
  };
  const scorePhoneInput = (input, index) => {
    const descriptor = [
      input.id,
      input.name,
      input.className,
      input.placeholder,
      input.getAttribute("title"),
      input.getAttribute("aria-label"),
      labelNearInput(input),
    ].join(" ");
    let score = 100 - index;
    if (/来电号码|主叫号码|号码|phone|tel|mobile|caller|calling/i.test(descriptor)) score += 300;
    if (/时间|date|time/i.test(descriptor)) score -= 500;
    return score;
  };
  const phoneInputs = inputs.filter((input) => !dateInputs.includes(input));
  const phoneInput = phoneInputs
    .map((input, index) => ({ input, score: scorePhoneInput(input, index) }))
    .sort((left, right) => right.score - left.score)[0]?.input;
  if (!phoneInput) return { ok: false, message: "未找到来电号码输入框" };
  setValue(phoneInput, phone);

  const query = findQueryButton();
  const queried = clickNode(query && query.node);
  return {
    ok: true,
    phone,
    queried,
    queryText: query ? query.text : "",
    queryScore: query ? query.score : 0,
    href: String(targetDocument.location && targetDocument.location.href || ""),
  };
})()
`;
}

function lossDetailReadyScript(phone) {
  return `
(() => {
  const phone = ${JSON.stringify(phone)};
  const collectDocuments = (rootDocument, result = []) => {
    result.push(rootDocument);
    for (const frame of [...rootDocument.querySelectorAll("iframe,frame")]) {
      try {
        if (frame.contentDocument) collectDocuments(frame.contentDocument, result);
      } catch (_) {}
    }
    return result;
  };
  const visible = (node) => {
    if (!node) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  return collectDocuments(document).some((doc) => {
    const body = String(doc.body && doc.body.innerText || "");
    const url = String(doc.location && doc.location.href || "");
    const phoneInputReady = [...doc.querySelectorAll("input[type='text'],input:not([type])")]
      .filter(visible)
      .some((input) => String(input.value || "").replace(/\\D/g, "") === phone);
    const lossPageReady = /inboundFailPage|CALL_FAIL/i.test(url) || (body.includes("丢失位置") && body.includes("排队停留"));
    const resultRows = [...doc.querySelectorAll("tr")].filter(visible).slice(1);
    const phoneRows = resultRows.filter((row) => String(row.innerText || "").replace(/\\D/g, "").includes(phone));
    const normalizedBody = body.replace(/\\s+/g, "");
    const totalMatch = normalizedBody.match(/总共(\\d+)条/);
    const totalCount = totalMatch ? Number(totalMatch[1]) : null;
    return phoneInputReady && lossPageReady && (phoneRows.length > 0 || totalCount === 0);
  });
})()
`;
}

async function applyLossDetailFilter(cdp, sessionId, phone) {
  log("设置明细条件", `号码=${phone}`);
  const payload = await evaluate(cdp, sessionId, lossDetailFilterScript(phone));
  if (!payload.ok) throw new Error(`打开呼损明细失败：${payload.message || "筛选条件写入失败"}`);
  if (!payload.queried) throw new Error("打开呼损明细失败：未找到或未点中查询按钮");
  await waitFor(cdp, sessionId, lossDetailReadyScript(phone), "呼损明细号码筛选", 30000);
  log("明细已打开", `号码=${phone} 查询=${Boolean(payload.queried)} 按钮=${payload.queryText || ""} 分数=${payload.queryScore || 0}`);
  return payload;
}

module.exports = {
  applyLossDetailFilter,
};
