const { log } = require("../../../engine/logger");
const { dismissBlockingPopups } = require("../../../shared/blockingPopupEngine");

async function dispatchPddDownloadButtonEvents(page) {
  // 该函数只按拼多多页面已验证的事件顺序触发唯一下载表单入口。
  const dispatchResult = await page.evaluate(() => {
    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const downloadButtons = Array.from(document.querySelectorAll("a.pdd-btn-download"))
      .filter((element) => isVisible(element) && normalizeText(element.textContent) === "下载表单");
    if (downloadButtons.length !== 1) {
      return { count: downloadButtons.length, disabled: false, dispatched: false };
    }

    const downloadButton = downloadButtons[0];
    const disabled = /(^|\s)disabled(\s|$)/i.test(String(downloadButton.className || "")) ||
      downloadButton.getAttribute("aria-disabled") === "true";
    if (disabled) {
      return { count: 1, disabled: true, dispatched: false };
    }

    downloadButton.scrollIntoView({ block: "center", inline: "center" });
    for (const eventName of ["mousedown", "mouseup", "click"]) {
      downloadButton.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
    }
    return { count: 1, disabled: false, dispatched: true };
  });

  if (dispatchResult.count !== 1) {
    throw new Error(`拼多多下载失败：当前页面有${dispatchResult.count}个可见「下载表单」入口，无法安全选择。`);
  }
  if (dispatchResult.disabled) {
    throw new Error("拼多多下载失败：「下载表单」当前不可用，页面尚未允许导出。");
  }
  if (!dispatchResult.dispatched) {
    throw new Error("拼多多下载失败：未能触发唯一「下载表单」入口。");
  }
}

async function clickPddDownloadButton(page) {
  // 该函数只先清除唯一明确遮挡弹窗，再触发拼多多已验证的下载入口。
  await dismissBlockingPopups(page, { platformName: "拼多多" });
  await dispatchPddDownloadButtonEvents(page);
  log("主线:执行", "拼多多下载", "触发下载表单", "已按拼多多已验证事件顺序触发唯一下载入口");
}

module.exports = {
  clickPddDownloadButton
};
