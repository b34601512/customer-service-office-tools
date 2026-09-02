const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isTmallLoginPage,
  detectTmallManualVerificationReason
} = require("../src/platforms/tmall/tmallLoginState");

function createFrameWithText(text) {
  return {
    locator() {
      return {
        async innerText() { return text; }
      };
    }
  };
}

test("识别天猫新版独立登录页", () => {
  assert.equal(isTmallLoginPage("https://loginmyseller.taobao.com/?redirect_url=x"), true);
  assert.equal(isTmallLoginPage("https://qn.taobao.com/home.html/voc-tmall/serverReport"), false);
});

test("登录验证出现在内嵌登录框时仍原地等待", async () => {
  const page = {
    url() { return "https://loginmyseller.taobao.com/"; },
    frames() {
      return [createFrameWithText("欢迎登录"), createFrameWithText("请按住滑块，拖动到最右边")];
    }
  };
  assert.equal(await detectTmallManualVerificationReason(page), "滑块验证");
});
