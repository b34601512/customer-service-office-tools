const { clickLocatorWhenReady } = require("../../shared/browserActionEngine");
const { pickBestVisibleTextCandidateIndex } = require("./jdTextRules");

async function findFirstVisibleLocator(surface, selectors) {
  // 这里统一挑第一个可见控件，避免页面里隐藏按钮或重复入口误导点击。
  for (const selector of selectors) {
    const locator = surface.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      return locator;
    }
  }

  return null;
}

function escapeTextSelectorValue(value) {
  // 这里统一转义 text-is 选择器里的关键词，避免关键词里有引号时把选择器拼坏。
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function buildExactTextSelectors(expectedText) {
  // 这里把导航点击限定成精确关键词，只认固定文本，不再退回包含匹配。
  // 页面卡顿导致暂时找不到时，正确动作是“继续等渲染”，不是“去点相似文本”。
  const safeText = escapeTextSelectorValue(expectedText);
  const clickableSelectors = [
    "button",
    "a",
    "[role='button']",
    "[role='tab']",
    "li",
    ".el-menu-item",
    ".ant-menu-item",
    ".ant-tabs-tab"
  ];
  return clickableSelectors.map((selector) => `${selector}:text-is("${safeText}")`);
}

async function findBestVisibleLocator(locatorGroup, expectedText) {
  // 这里从一组候选节点里挑最贴近目标文本的那个，优先完整文本，避免点到同类相似入口。
  const candidateTexts = [];
  const candidateLocators = [];
  const count = await locatorGroup.count();

  for (let index = 0; index < count; index += 1) {
    const locator = locatorGroup.nth(index);
    if (!(await locator.isVisible())) {
      continue;
    }

    candidateLocators.push(locator);
    candidateTexts.push(await locator.innerText());
  }

  const bestIndex = pickBestVisibleTextCandidateIndex(candidateTexts, expectedText);
  return bestIndex >= 0 ? candidateLocators[bestIndex] : null;
}

async function findVisibleTextLocator(surface, expectedText) {
  // 这里先找精确可点击导航，再找精确文本节点；找不到就继续等待，不退回包含匹配。
  // 经验结论：导航没出现通常是状态未就绪，不是可以随便点一个“看起来差不多”的入口。
  const exactClickableLocator = await findFirstVisibleLocator(surface, buildExactTextSelectors(expectedText));
  if (exactClickableLocator) {
    return exactClickableLocator;
  }

  return findBestVisibleLocator(surface.getByText(expectedText, { exact: true }), expectedText);
}

async function clickVisibleText(surface, textCandidates) {
  // 这里优先点击可见按钮或链接，适配“立即使用”“客服绩效”“搜索”“导出”这类入口。
  for (const text of textCandidates) {
    const locator = await findVisibleTextLocator(surface, text);

    if (locator && (await locator.count()) > 0 && (await locator.isVisible())) {
      await clickLocatorWhenReady(locator, `京东入口按钮${text}`, { timeoutMs: 5000 });
      return true;
    }
  }

  return false;
}

module.exports = {
  findFirstVisibleLocator,
  findVisibleTextLocator,
  clickVisibleText
};
