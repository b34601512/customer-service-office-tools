const { log } = require("./logger");
const { sleep } = require("./timing");

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    },
    sessionId
  );
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "页面脚本执行失败");
  return result.result.value;
}

async function waitFor(cdp, sessionId, predicateExpression, description, timeoutMs = 20000) {
  log("等待状态", description);
  const deadline = Date.now() + timeoutMs;
  let lastProgressAt = 0;
  while (Date.now() < deadline) {
    const ok = await evaluate(cdp, sessionId, predicateExpression).catch(() => false);
    if (ok) return true;
    if (Date.now() - lastProgressAt > 10000) {
      lastProgressAt = Date.now();
      const summary = await readPageSummary(cdp, sessionId);
      log("等待诊断", `${description} title=${summary.title || "空"} frames=${summary.frameCount || 1} text=${String(summary.text || "").slice(0, 160)}`);
    }
    await sleep(500);
  }
  throw new Error(`等待${description}超时。`);
}

async function readPageSummary(cdp, sessionId) {
  return await evaluate(
    cdp,
    sessionId,
    `(() => {
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
      const text = documents.map((doc) => doc.body && doc.body.innerText || "").join(" || ");
      return { url: location.href, title: document.title, frameCount: documents.length, text: text.slice(0, 500) };
    })()`
  ).catch((error) => ({ url: "", title: "", text: `读取页面状态失败：${error.message}` }));
}

module.exports = {
  evaluate,
  waitFor,
  readPageSummary
};
