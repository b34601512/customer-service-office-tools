const test = require('node:test');
const assert = require('node:assert/strict');
const { 准备天猫账号密码登录 } = require('../src/browser/tmallLoginDom');

class FakeLocator {
  constructor({ visible = false, className = '' } = {}) {
    this.visible = visible;
    this.className = className;
    this.value = '';
    this.clicked = false;
  }

  first() {
    return this;
  }

  async count() {
    return this.visible ? 1 : 0;
  }

  async isVisible() {
    return this.visible;
  }

  async getAttribute(name) {
    return name === 'class' ? this.className : '';
  }

  async click() {
    this.clicked = true;
  }

  async fill(value) {
    this.value = value;
  }
}

class FakeContainer {
  constructor(locators = {}) {
    this.locators = locators;
  }

  locator(selector) {
    return this.locators[selector] || new FakeLocator();
  }
}

class FakePage extends FakeContainer {
  constructor(locators = {}, frames = []) {
    super(locators);
    this.frameList = frames;
    this.fronted = false;
  }

  frames() {
    return this.frameList;
  }

  mainFrame() {
    return this;
  }

  async bringToFront() {
    this.fronted = true;
  }
}

test('天猫登录表单位于 iframe 时可以填入账号密码', async () => {
  const usernameInput = new FakeLocator({ visible: true });
  const passwordInput = new FakeLocator({ visible: true });
  const loginButton = new FakeLocator({ visible: true });
  const frame = new FakeContainer({
    '#fm-login-id': usernameInput,
    '#fm-login-password': passwordInput,
    'button[type="submit"]': loginButton,
  });
  const page = new FakePage({}, [pagePlaceholder(), frame]);

  const result = await 准备天猫账号密码登录(page, {
    id: 'tmall-a',
    name: '天猫A店',
    username: 'demo-user',
    password: 'demo-pass',
  });

  assert.equal(result.filled, true);
  assert.equal(usernameInput.value, 'demo-user');
  assert.equal(passwordInput.value, 'demo-pass');
  assert.equal(loginButton.clicked, true);
  assert.equal(result.clickedLogin, true);
  assert.equal(page.fronted, true);
});

test('天猫登录按钮不可见时只填账号密码并提示人工确认', async () => {
  const usernameInput = new FakeLocator({ visible: true });
  const passwordInput = new FakeLocator({ visible: true });
  const frame = new FakeContainer({
    '#fm-login-id': usernameInput,
    '#fm-login-password': passwordInput,
  });
  const page = new FakePage({}, [pagePlaceholder(), frame]);

  const result = await 准备天猫账号密码登录(page, {
    id: 'tmall-b',
    name: '天猫B店',
    username: 'demo-user',
    password: 'demo-pass',
  });

  assert.equal(result.filled, true);
  assert.equal(result.clickedLogin, false);
  assert.match(result.message, /人工确认页面/);
});

function pagePlaceholder() {
  return new FakeContainer();
}
