const test = require("node:test");
const assert = require("node:assert/strict");
const { detectJdManualVerification } = require("../src/platforms/jd/loginSurfaceParts/jdLoginSurfaceState");
const {
  isJdBusinessPage,
  shouldPreserveJdPageForManualVerification,
  stabilizeJdBrowser
} = require("../src/platforms/jd/jdPopupAndSurfaceState");

test("检测到京东滑块时返回人工验证原因", async () => {
  const fakePage = {
    frames() { return []; },
    async evaluate() { return "滑块验证"; }
  };
  assert.equal(await detectJdManualVerification(fakePage), "滑块验证");
});

test("京东登录页和安全验证页不会进入普通弹窗关闭流程", async () => {
  const passportPage = {
    url() { return "https://passport.jd.com/new/login.aspx"; },
    frames() { return []; },
    async evaluate() { return "安全验证"; }
  };
  assert.equal(isJdBusinessPage(passportPage), false);
  assert.equal(await shouldPreserveJdPageForManualVerification(passportPage), true);
  await stabilizeJdBrowser({
    contexts() { return [{ pages() { return [passportPage]; } }]; }
  });
});

test("京东业务页出现安全验证时保持原页面等待", async () => {
  const verificationPage = {
    url() { return "https://shop.jd.com/jdm/shopstar/vane/VaneContainer"; },
    frames() { return []; },
    async evaluate() { return "拖动箭头填充拼图"; }
  };
  assert.equal(isJdBusinessPage(verificationPage), true);
  assert.equal(await shouldPreserveJdPageForManualVerification(verificationPage), true);
  await stabilizeJdBrowser({
    contexts() { return [{ pages() { return [verificationPage]; } }]; }
  });
});
