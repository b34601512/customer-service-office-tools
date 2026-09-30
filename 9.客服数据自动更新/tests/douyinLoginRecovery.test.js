// 该文件回归 2026-09-03 dedakj抖音问题：
// 登录恢复轮询把“登录开始前就残留的旧页签”当成登录成功，导致未登录状态被误判恢复，
// 后续在残留页上找不到“切换组织/店铺”入口而失败。
const assert = require("assert");
const {
  waitForDouyinLoginRecovery,
  waitForDouyinMerchantHomeRestored,
  confirmDouyinLoginRequired
} = require("../src/platforms/douyin/downloadTaskParts/douyinLoginRecovery");

// 测试内的小别名：宽限判断/连续确认用极短间隔，避免测试变慢。
const 宽限判断 = (page) => waitForDouyinMerchantHomeRestored(page, { graceMs: 50, pollIntervalMs: 1 });
const 连续确认 = (page) => confirmDouyinLoginRequired(page, { attempts: 2, intervalMs: 1 });

function makeFakeDouyinPage(name) {
  const page = {
    name,
    hasHeader: false,
    onPoll: null,
    blank: false,
    reloads: 0,
    onReload: null,
    async evaluate() {
      return page.blank
        ? { textLength: 0, maxRootHeight: 0, visibleControls: 0 }
        : { textLength: 120, maxRootHeight: 600, visibleControls: 5 };
    },
    async reload() {
      page.reloads += 1;
      if (page.onReload) await page.onReload();
    },
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

  // 场景四（2026-09-27/09-28 白屏误判）：空白登录页 F5 重载一次后恢复 → 必须返回该页且只重载一次。
  const loginPage4 = makeFakeDouyinPage("blank-login");
  loginPage4.blank = true;
  loginPage4.onReload = async () => {
    loginPage4.blank = false;
    loginPage4.hasHeader = true;
  };
  const fakeBrowser4 = { contexts: () => [{ pages: () => [loginPage4] }] };
  const recoveredBlank = await waitForDouyinLoginRecovery(fakeBrowser4, loginPage4, { loginRecoveryTimeoutMs: 5000 });
  assert.strictEqual(recoveredBlank, loginPage4, "空白页重载后必须视为登录恢复");
  assert.strictEqual(loginPage4.reloads, 1, "空白页只允许重载一次");

  // 场景五（反向断言）：一直空白也不许反复重载，只能重载一次并等待超时。
  const loginPage5 = makeFakeDouyinPage("still-blank");
  loginPage5.blank = true;
  const fakeBrowser5 = { contexts: () => [{ pages: () => [loginPage5] }] };
  await assert.rejects(
    () => waitForDouyinLoginRecovery(fakeBrowser5, loginPage5, { loginRecoveryTimeoutMs: 80 }),
    /等待抖音人工登录超时/,
    "持续空白不得被误判恢复"
  );
  assert.strictEqual(loginPage5.reloads, 1, "持续空白只允许重载一次，不许反复刷新");

  // 场景六（反向断言）：真实登录表单（有可见控件）绝不能被重载打断人工输入。
  const loginPage6 = makeFakeDouyinPage("real-login-form");
  const fakeBrowser6 = { contexts: () => [{ pages: () => [loginPage6] }] };
  await assert.rejects(
    () => waitForDouyinLoginRecovery(fakeBrowser6, loginPage6, { loginRecoveryTimeoutMs: 80 }),
    /等待抖音人工登录超时/
  );
  assert.strictEqual(loginPage6.reloads, 0, "非空白登录页不得重载");

  assert.strictEqual(loginPage6.reloads, 0, "非空白登录页不得重载");

  // ===== 2026-09-30 假过期治理（用户 09:01 要求）：
  // 登录提示是页面级瞬时状态，必须先宽限 + 连续确认，不得白弹人工登录窗口。
  const 造状态页 = (状态序列) => {
    let 游标 = 0;
    const 当前 = () => 状态序列[Math.min(游标, 状态序列.length - 1)];
    return {
      轮询次数: () => 游标,
      当前状态: 当前,
      url: () => "https://fxg.jinritemai.com/ffa/mshop/homepage/index",
      async goto() {},
      locator(选择器) {
        if (选择器 === "body") {
          return { innerText: async () => (当前() === "正常" ? "返回首页 发票管理" : "登录已过期，请重新登录") };
        }
        return {
          first: () => ({
            count: async () => (当前() === "正常" ? 1 : 0),
            isVisible: async () => 当前() === "正常"
          })
        };
      },
      async waitForTimeout() { 游标 += 1; }
    };
  };

  // 场景七：瞬时提示后自行恢复 → 宽限期必须判为已恢复，连续确认必须判为未失效。
  const 瞬时页 = 造状态页(["提示", "提示", "正常"]);
  assert.strictEqual(
    await 宽限判断(瞬时页),
    true,
    "页面自行恢复时必须判为已恢复，不得进入人工登录流程"
  );
  const 确认页 = 造状态页(["提示", "正常"]);
  assert.strictEqual(
    await 连续确认(确认页),
    false,
    "瞬时假过期不得被确认为登录失效"
  );

  // 场景八（反向断言）：持续停在登录页 → 宽限期不得误判恢复，连续确认必须判为真失效。
  const 持续页 = 造状态页(["提示"]);
  assert.strictEqual(await 宽限判断(持续页), false, "持续失效不得被宽限期误判为恢复");
  const 持续页2 = 造状态页(["提示"]);
  assert.strictEqual(await 连续确认(持续页2), true, "真实登录失效必须被连续确认命中");

  console.log("douyinLoginRecovery.test.js: all assertions passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
