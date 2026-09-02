const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { CdpClient } = require("./cdp_client");
const { evaluate } = require("./page_runtime");
const { httpJson } = require("./http_json");
const { log } = require("./logger");
const { sleep } = require("./timing");

function resolveBrowserPath(config) {
  const candidates = [
    config.browserPath,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("未找到 Edge 或 Chrome，无法启动自动下载浏览器。");
  return found;
}

async function waitForDebugPort(port) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      return await httpJson(`http://127.0.0.1:${port}/json/version`);
    } catch (_) {
      await sleep(300);
    }
  }
  throw new Error("浏览器调试端口未就绪。");
}

async function readDebugVersionIfReady(port) {
  return await httpJson(`http://127.0.0.1:${port}/json/version`).catch(() => null);
}

async function scoreTarget(cdp, pageTarget) {
  const attachedForProbe = await cdp.send("Target.attachToTarget", { targetId: pageTarget.id, flatten: true }).catch(() => null);
  if (!attachedForProbe) return { ...pageTarget, score: -100 };
  const probeSessionId = attachedForProbe.sessionId;
  await cdp.send("Runtime.enable", {}, probeSessionId).catch(() => {});
  const score = await evaluate(
    cdp,
    probeSessionId,
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
      const text = collectDocuments(document).map((doc) => doc.body && doc.body.innerText || "").join(" || ");
      let score = 0;
      if (text.includes("电话明细")) score += 5;
      if (text.includes("呼损")) score += 4;
      if (text.includes("呼入")) score += 3;
      if (text.includes("呼出")) score += 3;
      if (text.includes("查 询") || text.includes("查询")) score += 2;
      if (text.includes("导 出") || text.includes("导出")) score += 2;
      if (text.includes("记住密码")) score -= 20;
      return score;
    })()`
  ).catch(() => -100);
  await cdp.send("Target.detachFromTarget", { sessionId: probeSessionId }).catch(() => {});
  return { ...pageTarget, score };
}

async function launchBrowser(config, options = {}) {
  fs.mkdirSync(config.downloadDir, { recursive: true });
  fs.mkdirSync(config.profileDir, { recursive: true });
  let version = await readDebugVersionIfReady(config.debugPort);
  if (!version) {
    const browserPath = resolveBrowserPath(config);
    const args = [
      `--remote-debugging-port=${config.debugPort}`,
      `--user-data-dir=${config.profileDir}`,
      "--new-window",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble"
    ];
    if (options.startMaximized) args.push("--start-maximized");
    spawn(browserPath, args, { detached: true, stdio: "ignore" }).unref();
    log("启动浏览器", `${browserPath}`);
    version = await waitForDebugPort(config.debugPort);
  } else {
    log("复用浏览器", `调试端口=${config.debugPort}`);
  }

  const cdp = new CdpClient(version.webSocketDebuggerUrl);
  await cdp.connect();
  const targets = await httpJson(`http://127.0.0.1:${config.debugPort}/json/list`).catch(() => []);
  const pageTargets = targets.filter((item) => item.type === "page" && String(item.title || "").includes("CDR话单查询系统"));
  const scoredTargets = await Promise.all(pageTargets.map((pageTarget) => scoreTarget(cdp, pageTarget)));
  scoredTargets.sort((left, right) => right.score - left.score);

  const reusableTarget = scoredTargets.find((item) => item.score > 0);
  const fallbackTarget = reusableTarget || scoredTargets.find((item) => String(item.url || "").startsWith(config.baseUrl));
  const createdTarget = fallbackTarget ? null : (await cdp.send("Target.createTarget", { url: config.baseUrl }));
  const target = fallbackTarget ? { targetId: fallbackTarget.id } : createdTarget;
  const createdTargetId = createdTarget ? createdTarget.targetId : "";
  if (reusableTarget) log("复用页面", `score=${reusableTarget.score} ${reusableTarget.url}`);
  else if (fallbackTarget) log("复用登录页", `${fallbackTarget.url}`);

  await closeRedundantPages(cdp, targets, scoredTargets, target.targetId, config);
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: config.downloadDir }, sessionId);
  return { cdp, sessionId, activeTargetId: target.targetId, createdTargetId };
}

async function closeRedundantPages(cdp, targets, scoredTargets, activeTargetId, config) {
  let closedStaleLoginPages = 0;
  for (const staleTarget of scoredTargets) {
    if (staleTarget.id === activeTargetId || staleTarget.score > 0) continue;
    if (!String(staleTarget.url || "").startsWith(config.baseUrl)) continue;
    await cdp.send("Target.closeTarget", { targetId: staleTarget.id }).catch(() => {});
    closedStaleLoginPages += 1;
  }
  if (closedStaleLoginPages) log("清理窗口", `已关闭多余登录页=${closedStaleLoginPages}`);

  let closedBlankPages = 0;
  for (const blankTarget of targets) {
    if (blankTarget.id === activeTargetId || blankTarget.type !== "page") continue;
    const blankUrl = String(blankTarget.url || "");
    if (blankUrl !== "edge://newtab/" && blankUrl !== "about:blank") continue;
    await cdp.send("Target.closeTarget", { targetId: blankTarget.id }).catch(() => {});
    closedBlankPages += 1;
  }
  if (closedBlankPages) log("清理窗口", `已关闭空白页=${closedBlankPages}`);
}

async function closeCreatedTarget(browserSession) {
  if (browserSession.activeTargetId) {
    await browserSession.cdp.send("Target.closeTarget", { targetId: browserSession.activeTargetId }).catch(() => {});
    log("清理窗口", "已关闭本次自动下载使用的 CDR 页面");
  }
  if (browserSession.cdp.socket) browserSession.cdp.socket.close();
}

async function maximizeActiveWindow(browserSession) {
  const { cdp, activeTargetId } = browserSession;
  if (!activeTargetId) return;
  const windowPayload = await cdp.send("Browser.getWindowForTarget", { targetId: activeTargetId }).catch(() => null);
  if (!windowPayload || !windowPayload.windowId) return;
  await cdp.send("Browser.setWindowBounds", {
    windowId: windowPayload.windowId,
    bounds: { windowState: "maximized" }
  }).catch(() => {});
  log("窗口调整", "已最大化 CDR 明细窗口");
}

module.exports = {
  launchBrowser,
  closeCreatedTarget,
  maximizeActiveWindow
};
