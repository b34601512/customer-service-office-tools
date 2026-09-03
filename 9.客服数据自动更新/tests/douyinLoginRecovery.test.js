// 该文件回归 2026-09-03 dedakj抖音问题：
// 登录恢复轮询把“登录开始前就残留的旧页签”当成登录成功，导致未登录状态被误判恢复，
// 后续在残留页上找不到“切换组织/店铺”入口而失败。
const assert = require("assert");
const {
  waitForDouyinLoginRecovery
} = require("../src/platforms/douyin/downloadTaskParts/douyinLoginRecovery");

function makeFakeDouyinPage(name) {
  const page = {
    name,
    hasHeader: false,
    onPoll: null,
    locator() {
      return {
        first() {
          return {
            async count() {
              return page.hasHeader ? 1 : 0;
            },
            async isVisible() {
              return page.hasHeader;
            }
          };
        }
      };
    },
    async waitForTimeout() {
      if (page.onPoll) {
        await page.onPoll();
      }
    }
  };
  return page;
}

(async () => {
  // 场景一：残留旧页签有店铺头部，但登录页本身仍未登录 → 不允许误判恢复，必须等到超时。
  const stalePage = makeFakeDouyinPage("stale");
  stalePage.hasHeader = true;
  const loginPage = makeFakeDouyinPage("login");
  const fakeBrowser = { contexts: () => [{ pages: () => [stalePage, loginPage] }] };
  await assert.rejects(
    () => waitForDouyinLoginRecovery(fakeBrowser, loginPage, { loginRecoveryTimeoutMs: 50 }),
    /等待抖音人工登录超时/,
    "残留旧页签不得视为登录恢复"
  );

  // 场景二：人工登录后登录页自身出现店铺头部 → 恢复正常返回。
  const stalePage2 = makeFakeDouyinPage("stale2");
  stalePage2.hasHeader = true;
  const loginPage2 = makeFakeDouyinPage("login2");
  let polls2 = 0;
  loginPage2.onPoll = async () => {
    polls2 += 1;
    if (polls2 >= 2) {
      loginPage2.hasHeader = true;
    }
  };
  const fakeBrowser2 = { contexts: () => [{ pages: () => [stalePage2, loginPage2] }] };
  const recovered = await waitForDouyinLoginRecovery(fakeBrowser2, loginPage2, { loginRecoveryTimeoutMs: 5000 });
  assert.strictEqual(recovered, loginPage2);

  // 场景三：登录跳转到登录期间新开的页签 → 新页签可作数。
  const stalePage3 = makeFakeDouyinPage("stale3");
  stalePage3.hasHeader = true;
  const loginPage3 = makeFakeDouyinPage("login3");
  const pages3 = [stalePage3, loginPage3];
  const fakeBrowser3 = { contexts: () => [{ pages: () => pages3 }] };
  loginPage3.onPoll = async () => {
    const freshHome = makeFakeDouyinPage("fresh-home");
    freshHome.hasHeader = true;
    pages3.push(freshHome);
  };
  const recoveredNewTab = await waitForDouyinLoginRecovery(fakeBrowser3, loginPage3, { loginRecoveryTimeoutMs: 5000 });
  assert.strictEqual(recoveredNewTab.name, "fresh-home");

  console.log("douyinLoginRecovery.test.js: all assertions passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
