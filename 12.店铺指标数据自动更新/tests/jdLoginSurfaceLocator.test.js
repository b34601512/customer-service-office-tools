const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findJdPasswordLoginSubmitButton
} = require("../src/platforms/jd/loginSurfaceParts/jdLoginSurfaceLocator");
const { tryAutofillLoginFrame } = require("../src/platforms/jd/loginSurfaceParts/jdLoginAutofill");
const { runInAutomationScope } = require("../src/engine/browserAutomationScope");

class FakeLocator {
  constructor(selector, elements, index = 0) {
    this.selector = selector;
    this.elements = elements;
    this.index = index;
  }

  async count() {
    return this.elements.length;
  }

  nth(index) {
    return new FakeLocator(this.selector, this.elements, index);
  }

  async isVisible() {
    return Boolean(this.elements[this.index]?.visible);
  }

  async fill(value) {
    if (this.elements[this.index]) {
      this.elements[this.index].value = value;
    }
  }

  async isDisabled() {
    return Boolean(this.elements[this.index]?.disabled);
  }

  async scrollIntoViewIfNeeded() {}

  async click() {
    if (this.elements[this.index]) {
      this.elements[this.index].clickCount = (this.elements[this.index].clickCount || 0) + 1;
    }
  }
}

class FakeSurface {
  constructor(elementsBySelector) {
    this.elementsBySelector = elementsBySelector;
  }

  locator(selector) {
    return new FakeLocator(selector, this.elementsBySelector[selector] || []);
  }

  getByText(text, options) {
    assert.deepEqual(options, { exact: true });
    return new FakeLocator(`getByText:${text}`, this.elementsBySelector[`getByText:${text}`] || []);
  }
}

test("京麦当前密码页可用稳定 ID，即使没有动态 _submit 属性", async () => {
  const submitLocator = await findJdPasswordLoginSubmitButton(new FakeSurface({
    "#loginsubmit": [{ visible: true }]
  }));

  assert.ok(submitLocator);
  assert.equal(submitLocator.selector, "#loginsubmit");
});

test("登录按钮没有 ID 时使用唯一可见的立即登录语义按钮", async () => {
  const submitLocator = await findJdPasswordLoginSubmitButton(new FakeSurface({
    "button:text-is('立即登录')": [{ visible: true }]
  }));

  assert.ok(submitLocator);
  assert.equal(submitLocator.selector, "button:text-is('立即登录')");
});

test("新版京麦把立即登录渲染成普通文本节点时仍能定位", async () => {
  const submitLocator = await findJdPasswordLoginSubmitButton(new FakeSurface({
    "getByText:立即登录": [{ visible: true }]
  }));

  assert.ok(submitLocator);
  assert.equal(submitLocator.selector, "getByText:立即登录");
});

test("多个可见语义按钮时不猜测点击目标", async () => {
  const submitLocator = await findJdPasswordLoginSubmitButton(new FakeSurface({
    "button:text-is('立即登录')": [{ visible: true }, { visible: true }]
  }));

  assert.equal(submitLocator, null);
});

test("已有密码输入框时不重复点击密码登录切换入口", async () => {
  const usernameInput = [{ visible: true }];
  const passwordInput = [{ visible: true }];
  const submitButton = [{ visible: true }];
  const surface = new FakeSurface({
    "input[type='text']": usernameInput,
    "input[type='password']": passwordInput,
    "#loginsubmit": submitButton
  });
  surface.getByText = () => {
    throw new Error("已有密码输入框时不应切换登录方式");
  };

  const result = await runInAutomationScope({ platformKey: "jd", headless: false }, () =>
    tryAutofillLoginFrame(surface, { username: "账号", password: "密码" })
  );

  assert.equal(result, true);
  assert.equal(usernameInput[0].value, "账号");
  assert.equal(passwordInput[0].value, "密码");
  assert.equal(submitButton[0].clickCount, 1);
});
