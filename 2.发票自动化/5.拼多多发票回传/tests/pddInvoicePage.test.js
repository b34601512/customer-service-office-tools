const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  是拼多多待开票列表文本,
  读取拼多多待开票页面状态,
  关闭拼多多非业务浮层,
  触发拼多多按钮DOM点击,
  解析CSV文本,
  读取拼多多导出订单,
  构建拼多多财务开票参考,
  转换拼多多导出订单,
} = require('../src/invoiceReturn/pddInvoicePage');

test('拼多多待开票列表文本必须包含订单开票和批量导出入口', () => {
  assert.equal(是拼多多待开票列表文本('订单开票 待开票 批量导出 录入发票'), true);
  assert.equal(是拼多多待开票列表文本('订单开票 批量导出 暂无数据'), true);
  assert.equal(是拼多多待开票列表文本('后台首页 批量导出'), false);
});

test('拼多多页面状态能区分登录页和业务页', () => {
  assert.equal(
    读取拼多多待开票页面状态('https://mms.pinduoduo.com/login/?redirectUrl=x', ''),
    'login',
  );
  assert.equal(
    读取拼多多待开票页面状态('https://mms.pinduoduo.com/invoice/center?quickFilterValue=', '订单开票 批量导出 录入发票'),
    'ready',
  );
  assert.equal(
    读取拼多多待开票页面状态('https://mms.pinduoduo.com/invoice/center?quickFilterValue=', '订单开票 加载中'),
    'loading',
  );
});

test('拼多多非业务浮层会被禁用指针事件', async () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  let pressedKey = '';
  const overlay = {
    innerText: '消息 站内信 官方客服',
    style: {},
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getBoundingClientRect() {
      return { width: 320, height: 500 };
    },
  };
  global.window = {
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    },
  };
  global.document = {
    querySelector(selector) {
      return selector === '#umd_kits_home_entry' ? overlay : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const fakePage = {
    keyboard: {
      async press(key) {
        pressedKey = key;
      },
    },
    async evaluate(fn) {
      return fn();
    },
  };

  try {
    const result = await 关闭拼多多非业务浮层(fakePage);

    assert.equal(pressedKey, 'Escape');
    assert.equal(overlay.style.pointerEvents, 'none');
    assert.equal(overlay.attributes['data-pdd-invoice-overlay-disabled'], '1');
    assert.equal(result[0].selector, '#umd_kits_home_entry');
  } finally {
    if (originalDocument === undefined) {
      delete global.document;
    } else {
      global.document = originalDocument;
    }
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test('拼多多营销弹窗会被关闭且不误关业务弹窗', async () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  let pressedKey = '';
  let marketingClosed = false;
  let businessClosed = false;
  const closeMarketingButton = {
    innerText: '×',
    textContent: '×',
    className: 'close',
    style: {},
    getAttribute(name) {
      return name === 'aria-label' ? '关闭' : '';
    },
    getBoundingClientRect() {
      return { width: 16, height: 16 };
    },
    click() {
      marketingClosed = true;
    },
  };
  const closeBusinessButton = {
    innerText: '×',
    textContent: '×',
    className: 'close',
    style: {},
    getAttribute(name) {
      return name === 'aria-label' ? '关闭' : '';
    },
    getBoundingClientRect() {
      return { width: 16, height: 16 };
    },
    click() {
      businessClosed = true;
    },
  };
  const marketingModal = {
    innerText: '恭喜您获得优惠特权资格 自动开票限时特惠 服务费直降千元 立即开启',
    textContent: '恭喜您获得优惠特权资格 自动开票限时特惠 服务费直降千元 立即开启',
    style: {},
    getBoundingClientRect() {
      return { width: 640, height: 400 };
    },
    querySelectorAll() {
      return [closeMarketingButton];
    },
  };
  const businessModal = {
    innerText: '录入发票 发票号码 确认',
    textContent: '录入发票 发票号码 确认',
    style: {},
    getBoundingClientRect() {
      return { width: 520, height: 360 };
    },
    querySelectorAll() {
      return [closeBusinessButton];
    },
  };
  global.window = {
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    },
  };
  global.document = {
    body: {
      querySelectorAll() {
        return [closeMarketingButton, closeBusinessButton];
      },
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [marketingModal, businessModal];
    },
  };
  const fakePage = {
    keyboard: {
      async press(key) {
        pressedKey = key;
      },
    },
    async evaluate(fn) {
      return fn();
    },
  };

  try {
    const result = await 关闭拼多多非业务浮层(fakePage);

    assert.equal(pressedKey, 'Escape');
    assert.equal(marketingClosed, true);
    assert.equal(businessClosed, false);
    assert.equal(result[0].selector, 'marketing-modal-close');
  } finally {
    if (originalDocument === undefined) {
      delete global.document;
    } else {
      global.document = originalDocument;
    }
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test('拼多多下载按钮使用 DOM click 触发', async () => {
  let clicked = false;
  const fakeLocator = {
    async evaluate(fn) {
      return fn({
        click() {
          clicked = true;
        },
      });
    },
  };

  await 触发拼多多按钮DOM点击(fakeLocator, '下载报表');

  assert.equal(clicked, true);
});

test('CSV 解析支持引号逗号和 UTF-8 BOM', () => {
  const rows = 解析CSV文本('\uFEFF订单号,发票抬头,发票金额\r\n260620-1,"公司,分部",362.18\r\n');

  assert.deepEqual(rows, [
    ['订单号', '发票抬头', '发票金额'],
    ['260620-1', '公司,分部', '362.18'],
  ]);
});

test('拼多多导出订单按表头转换为回传订单', () => {
  const order = 转换拼多多导出订单({
    订单号: '260620-302975557183160',
    申请时间: '2026-07-01 10:30:00',
    承诺开票时间: '2026-07-10 23:59:59',
    发票金额: '362.18',
    发票类型: '增值税电子普通发票',
    抬头类型: '个人',
    发票抬头: '个人',
    企业税号: '-',
    订单状态: '已收货',
    售后状态: '正常',
  }, { id: 'pdd-store-1', name: '拼多多店铺1' });

  assert.equal(order.key, 'pdd-store-1:260620-302975557183160');
  assert.equal(order.storeName, '拼多多店铺1');
  assert.equal(order.invoiceType, '增值税电子普通发票');
  assert.equal(order.buyerTaxNumber, '');
  assert.equal(order.invoiceApplyTime, '2026-07-01 10:30:00');
  assert.equal(order.promisedInvoiceTime, '2026-07-10 23:59:59');
  assert.match(order.financeIssueReference, /财务参考/);
});

test('拼多多财务开票参考按 7 个工作日估算', () => {
  const reference = 构建拼多多财务开票参考(
    '2026-07-01 10:30:00',
    new Date(2026, 6, 8),
  );

  assert.equal(reference, '财务参考：已过 5 个工作日，常规约 7 个工作日，预计 2026-07-10 前后');
});

test('拼多多财务开票参考能提示超过常规周期', () => {
  const reference = 构建拼多多财务开票参考(
    '2026-07-01 10:30:00',
    new Date(2026, 6, 13),
  );

  assert.equal(reference, '财务参考：已过 8 个工作日，超过常规 7 个工作日');
});

test('拼多多导出文件会去重并跳过空订单号', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdd-export-'));
  const filePath = path.join(dir, 'orders.csv');
  fs.writeFileSync(filePath, [
    '订单号,发票金额,发票类型,抬头类型,发票抬头',
    '260620-302975557183160,362.18,增值税电子普通发票,个人,个人',
    '260620-302975557183160,362.18,增值税电子普通发票,个人,个人',
    ',100.00,增值税电子普通发票,个人,个人',
  ].join('\n'), 'utf8');

  const orders = 读取拼多多导出订单(filePath, { id: 'pdd-store-1', name: '拼多多店铺1' });

  assert.equal(orders.length, 1);
  assert.equal(orders[0].orderNumber, '260620-302975557183160');
});

test('拼多多广告弹窗和全屏遮罩会被自动关闭', async () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  let pressedKey = '';
  let adClosed = false;
  const closeAdButton = {
    innerText: '×',
    textContent: '×',
    className: 'beast-core-modal-icon-close',
    style: {},
    getAttribute(name) {
      return name === 'aria-label' ? '关闭' : '';
    },
    getBoundingClientRect() {
      return { width: 16, height: 16 };
    },
    click() {
      adClosed = true;
    },
  };
  const adModal = {
    innerText: '限时新人专享福利 领取礼包 立即开通',
    textContent: '限时新人专享福利 领取礼包 立即开通',
    style: {},
    getBoundingClientRect() {
      return { width: 640, height: 400 };
    },
    querySelectorAll() {
      return [closeAdButton];
    },
  };
  const fullScreenMask = {
    className: 'beast-core-mask',
    style: {},
    _disabled: false,
    querySelectorAll() {
      return [];
    },
    setAttribute(name, value) {
      if (name === 'data-pdd-invoice-overlay-disabled') this._disabled = true;
    },
    getAttribute(name) {
      return name === 'data-pdd-invoice-overlay-disabled' ? (this._disabled ? '1' : null) : null;
    },
    hasAttribute(name) {
      return this.getAttribute(name) != null;
    },
    getBoundingClientRect() {
      return { width: 1920, height: 1080 };
    },
  };
  global.window = {
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    },
    innerWidth: 1920,
    innerHeight: 1080,
  };
  global.document = {
    body: {
      querySelectorAll() {
        return [];
      },
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (/mask/i.test(selector)) return [fullScreenMask];
      return [adModal];
    },
  };
  const fakePage = {
    keyboard: {
      async press(key) {
        pressedKey = key;
      },
    },
    async evaluate(fn) {
      return fn();
    },
  };

  try {
    const result = await 关闭拼多多非业务浮层(fakePage);

    assert.equal(pressedKey, 'Escape');
    assert.equal(adClosed, true);
    assert.equal(fullScreenMask._disabled, true);
    assert.ok(result.some((item) => item.selector === 'marketing-modal-close'));
    assert.ok(result.some((item) => item.selector === 'mask-disable'));
  } finally {
    if (originalDocument === undefined) {
      delete global.document;
    } else {
      global.document = originalDocument;
    }
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});
