// 该文件用于点击左侧全部菜单并等待列表稳定。
const appConfig = require("../../config/appConfig");
const { log } = require("../../engine/logger");
const { readBodyText } = require("./bodyText");
const { assertChatPageReady } = require("./pageReady");
const { isConversationWorkbenchReady, waitForWorkbench } = require("./workbenchWait");
const { findAllCandidates } = require("./allMenuCandidates");
const { waitForAllMenuSelectionReady } = require("./allMenuWait");

async function clickLeftAllMenu(page) {
  // 这里通过“先等工作台稳定出现，再扫描『全部』”的方式定位左侧菜单，避免渲染未完成时误判失败。
  await assertChatPageReady(page);
  await waitForWorkbench(page);

  log("主线:执行", "会话页面", "等待全部按钮", "开始动态等待左侧「全部」按钮出现");

  try {
    await page
      .getByText(/^全部$/, { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: appConfig.workbenchReadyTimeout });
  } catch (error) {
    log("主线:执行", "会话页面", "等待全部按钮", "动态等待超时，改为最终扫描确认");
  }

  const candidates = await findAllCandidates(page);
  const count = candidates.length;

  log("主线:执行", "会话页面", "扫描元素", `检测到 ${count} 个文本为「全部」的候选元素`);

  if (count === 0) {
    if (await isConversationWorkbenchReady(page)) {
      log("主线:执行", "会话页面", "跳过点击全部", "已确认进入聊天工作台，但当前未找到左侧「全部」，继续后续流程");
      return;
    }

    const bodyText = await readBodyText(page);
    throw new Error(`页面中没有找到文本为「全部」的元素，无法完成点击。当前页面文本片段：${bodyText.slice(0, 300)}`);
  }

  let targetLocator = null;
  let targetBox = null;

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates[index];
    const locator = candidate.locator;
    const isVisible = await locator.isVisible();

    if (!isVisible) {
      log(
        "主线:执行",
        "会话页面",
        "跳过隐藏元素",
        `候选元素索引=${index}，Frame=${candidate.frameIndex}，当前不可见`
      );
      continue;
    }

    const box = await locator.boundingBox();
    if (!box) {
      log(
        "主线:执行",
        "会话页面",
        "跳过无坐标元素",
        `候选元素索引=${index}，Frame=${candidate.frameIndex}，当前没有坐标信息`
      );
      continue;
    }

    log(
      "主线:执行",
      "会话页面",
      "记录候选元素",
      `候选元素索引=${index}，Frame=${candidate.frameIndex}，x=${box.x.toFixed(2)}，y=${box.y.toFixed(2)}`
    );

    if (!targetBox || box.x < targetBox.x) {
      targetLocator = locator;
      targetBox = box;
    }
  }

  if (!targetLocator || !targetBox) {
    throw new Error("所有「全部」候选元素都不可见，无法完成点击。");
  }

  log(
    "主线:执行",
    "会话页面",
    "点击目标元素",
    `准备点击左侧「全部」，坐标参考 x=${targetBox.x.toFixed(2)}，y=${targetBox.y.toFixed(2)}`
  );

  await targetLocator.click();
  await waitForAllMenuSelectionReady(page);
  log("主线:完成", "会话页面", "点击完成", "左侧「全部」菜单点击成功");
}

module.exports = {
  clickLeftAllMenu
};
