const { spawn } = require("child_process");
const http = require("http");
const { chromium } = require("playwright-core");
const { tryAutofillLoginFrame } = require("../src/platforms/jd/loginSurfaceParts/jdLoginAutofill");

const executablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = "D:\\备份文件夹\\店铺指标数据自动更新\\浏览器兼容测试\\jd3-chrome-clean-20260909";
const targetUrl = "https://shop.jd.com/jdm/shopstar/vane/VaneContainer";
const debugPort = 9336;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDebugVersion() {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${debugPort}/json/version`, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    });
    request.on("error", reject);
    request.setTimeout(1000, () => {
      request.destroy();
      reject(new Error("debug port timeout"));
    });
  });
}

async function waitForDebugVersion() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      return await readDebugVersion();
    } catch (_error) {
      await wait(500);
    }
  }
  throw new Error("Chrome调试端口未就绪");
}

function getPages(browser) {
  return browser.contexts().flatMap((context) => context.pages());
}

function sanitizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const queryKeys = [...new Set([...url.searchParams.keys()])];
    return `${url.origin}${url.pathname}${queryKeys.length ? `?keys=${queryKeys.join(",")}` : ""}`;
  } catch (_error) {
    return String(rawUrl || "").split("?")[0];
  }
}

function isInterestingUrl(rawUrl) {
  return /(?:jd\\.com|jdsz\\.jd\\.com)/i.test(rawUrl) &&
    /(?:vane|star|score|service|api|degradation|prejudgment)/i.test(rawUrl);
}

async function collectResponseSummary(response) {
  const summary = {
    status: response.status(),
    url: sanitizeUrl(response.url())
  };
  try {
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("json")) return summary;
    const payload = await response.json();
    if (payload && typeof payload === "object") {
      summary.code = payload.code ?? payload.errCode ?? payload.success ?? null;
      summary.message = String(payload.msg ?? payload.message ?? payload.errMsg ?? "").slice(0, 160);
      if (payload.data && typeof payload.data === "object") {
        summary.dataKeys = Object.keys(payload.data).slice(0, 30);
      }
    }
  } catch (_error) {
    // Some接口返回非标准JSON；只保留状态和脱敏地址。
  }
  return summary;
}

async function main() {
  const config = require("../project-config/platform-config.json");
  const store = config.jd.stores.find((item) => item.key === "jd3");
  if (!store) throw new Error("未找到京东3店配置");

  const child = spawn(executablePath, [
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--disable-popup-blocking",
    "--disable-session-crashed-bubble",
    "--start-maximized",
    "--new-window",
    targetUrl
  ], { detached: true, stdio: "ignore" });
  child.unref();

  await waitForDebugVersion();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 15000 });
  const events = [];
  const marks = new WeakSet();
  for (const page of getPages(browser)) {
    page.on("request", (request) => {
      if (isInterestingUrl(request.url())) {
        events.push({ kind: "request", method: request.method(), url: sanitizeUrl(request.url()) });
      }
    });
    page.on("response", async (response) => {
      if (!isInterestingUrl(response.url())) return;
      events.push({ kind: "response", ...(await collectResponseSummary(response)) });
    });
  }

  let fillAttempts = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const page of getPages(browser)) {
      for (const surface of [page, ...page.frames()]) {
        if (marks.has(surface)) continue;
        try {
          if (await tryAutofillLoginFrame(surface, { username: store.username, password: store.password })) {
            marks.add(surface);
            fillAttempts += 1;
          }
        } catch (_error) {
          // 登录页跳转期间可能暂时失效，下一轮继续观察。
        }
      }
    }
    await wait(500);
  }

  await wait(50000);
  const pages = [];
  for (const page of getPages(browser)) {
    const body = await page.locator("body").innerText().catch(() => "");
    pages.push({
      title: await page.title().catch(() => ""),
      url: page.url(),
      body: body.replace(/\\s+/g, " ").slice(0, 4000),
      hasStarData: /当前星级|体验得分|店铺星级|星级概览/.test(body),
      hasInvalid: /Invalid Date|暂无/.test(body)
    });
  }
  console.log(JSON.stringify({ pid: child.pid, fillAttempts, pages, events: events.slice(-120) }, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
