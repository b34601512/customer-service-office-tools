const { wait } = require("../../../shared/browserActionEngine");

async function readJdDynamicLoginSurfaceState(page) {
  // 这个函数只读取当前页面是否已出现京东登录地址或关键登录控件。
  return page.evaluate(() => {
    if (/passport\.shop\.jd\.com|passport\.jd\.com|new\/login\.aspx|login\/index\.action\/jdm/i.test(location.href)) {
      return true;
    }
    const candidates = Array.from(document.querySelectorAll("input, button, a"));
    return candidates.some((element) => {
      const style = window.getComputedStyle(element);
      const visible = style && style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
      if (!visible) {
        return false;
      }
      const text = [
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.getAttribute("name"),
        element.textContent
      ].filter(Boolean).join(" ");
      return /账号|邮箱|密码|登录|验证码|user|login/i.test(text);
    });
  });
}

async function waitForDynamicLoginSurface(page, timeoutMs) {
  // 这个函数只等待动态登录状态出现，读取故障原样抛出。
  const safeTimeoutMs = Math.max(1, Number(timeoutMs) || 1);
  const deadline = Date.now() + safeTimeoutMs;
  while (Date.now() <= deadline) {
    if (await readJdDynamicLoginSurfaceState(page)) {
      return true;
    }
    await wait(Math.min(50, Math.max(0, deadline - Date.now())));
  }
  return false;
}

async function waitForLoginTransition(page, timeoutMs) {
  // 这个函数只短暂等待点击后进入可识别的登录状态。
  return waitForDynamicLoginSurface(page, Math.max(50, Number(timeoutMs) || 800));
}

async function detectJdManualVerification(page) {
  // 这个函数只识别需要用户亲自完成的滑块、验证码和安全验证。
  const surfaces = [page, ...(typeof page.frames === "function" ? page.frames() : [])];
  for (const surface of surfaces) {
    const verificationState = await surface.evaluate(() => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        return style && style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
      };
      const visibleElements = Array.from(document.querySelectorAll(
        "[class*='slide'], [class*='slider'], [class*='captcha'], [class*='verify'], iframe, input, button"
      )).filter(isVisible);
      const controlText = visibleElements.map((element) => [
        element.className,
        element.id,
        element.getAttribute("placeholder"),
        element.getAttribute("title"),
        element.textContent
      ].filter(Boolean).join(" ")).join(" ");
      const bodyText = String(document.body?.innerText || "").replace(/\s+/g, " ");
      const combinedText = `${controlText} ${bodyText}`;
      const matched = combinedText.match(/拖动.{0,12}(?:滑块|箭头|拼图)|按住.{0,12}滑块|填充拼图|拼图验证|滑块验证|安全验证|完成验证|图形验证码|短信验证码/);
      return matched ? matched[0] : "";
    }).catch(() => "");
    if (verificationState) {
      return verificationState;
    }
  }
  return "";
}

module.exports = {
  waitForDynamicLoginSurface,
  waitForLoginTransition,
  detectJdManualVerification
};
