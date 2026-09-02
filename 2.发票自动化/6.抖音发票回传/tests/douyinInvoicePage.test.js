const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  是抖音待开票列表文本,
  读取抖音待开票页面状态,
  等待抖音待开票列表或登录页,
  关闭抖音非业务浮层,
  触发抖音按钮DOM点击,
  解析CSV文本,
  读取抖音导出订单,
  构建抖音财务开票参考,
  转换抖音导出订单,
  是抖音待开票空列表文本,
  提取抖音导出业务错误,
  是抖音无待开票订单错误,
  点击抖音导出弹窗提交按钮,
} = require('../src/invoiceReturn/douyinInvoicePage');

test('抖音待开票列表文本必须包含消费者开票和导出入口', () => {
  assert.equal(是抖音待开票列表文本('消费者申请开票记录 待开票 导出订单 导出记录 上传发票'), true);
  assert.equal(是抖音待开票列表文本('给消费者开票 导出订单 导出记录 暂无数据'), true);
  assert.equal(是抖音待开票列表文本('后台首页 导出订单'), false);
});

test('抖音待开票空列表能被识别为无待回传订单', () => {
  const text = '给消费者开票 消费者申请开票记录 待开票 0 导出订单 导出记录 订单信息 暂无数据';

  assert.equal(是抖音待开票空列表文本(text), true);
  assert.equal(是抖音待开票空列表文本('消费者申请开票记录 待开票 1 上传发票 导出订单 导出记录'), false);
});

test('抖音导出数据为0条会转成无待开票订单错误', () => {
  const error = 提取抖音导出业务错误(['导出数据为0条，请调整查询条件后重试']);

  assert.equal(是抖音无待开票订单错误(error), true);
  assert.match(error.message, /没有待回传发票订单/);
});

test('抖音页面状态能区分登录页和业务页', () => {
  assert.equal(
    读取抖音待开票页面状态('https://fxg.jinritemai.com/login/common?redirectUrl=x', ''),
    'login',
  );
  assert.equal(
    读取抖音待开票页面状态('https://fxg.jinritemai.com/ffa/morder/receipt/list', '消费者申请开票记录 导出订单 导出记录 上传发票'),
    'ready',
  );
  assert.equal(
    读取抖音待开票页面状态('https://fxg.jinritemai.com/ffa/morder/receipt/list', '消费者申请开票记录 加载中'),
    'loading',
  );
});

test('抖音滑块完成后列表已就绪时优先返回，不被残留滑块节点阻塞', async () => {
  const page = {
    url: () => 'https://fxg.jinritemai.com/ffa/morder/receipt/list',
    keyboard: { press: async () => {} },
    bringToFront: async () => {},
    locator: (selector) => {
      if (selector === 'body') {
        return { innerText: async () => '消费者申请开票记录 导出订单 导出记录 上传发票' };
      }
      return {
        evaluateAll: async () => {
          throw new Error('列表已就绪时不应再依赖滑块节点判断');
        },
      };
    },
    evaluate: async () => [],
  };

  const result = await 等待抖音待开票列表或登录页(page, 1000);

  assert.equal(result.state, 'ready');
});

test('抖音非业务浮层会被禁用指针事件', async () => {
  const originalDocument = global.document;
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
  global.document = {
    querySelector(selector) {
      return selector === '#umd_kits_home_entry' ? overlay : null;
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
    const result = await 关闭抖音非业务浮层(fakePage);

    assert.equal(pressedKey, 'Escape');
    assert.equal(overlay.style.pointerEvents, 'none');
    assert.equal(overlay.attributes['data-douyin-invoice-overlay-disabled'], '1');
    assert.equal(result[0].selector, '#umd_kits_home_entry');
  } finally {
    if (originalDocument === undefined) {
      delete global.document;
    } else {
      global.document = originalDocument;
    }
  }
});

test('抖音下载按钮使用 DOM click 触发', async () => {
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

  await 触发抖音按钮DOM点击(fakeLocator, '下载报表');

  assert.equal(clicked, true);
});

test('抖音导出合规提示弹窗会通过可见导出按钮提交', async () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  let clicked = false;
  const exportButton = {
    disabled: false,
    innerText: '导出',
    textContent: '导出',
    className: 'auxo-btn-primary',
    getAttribute(name) {
      return name === 'aria-disabled' ? 'false' : null;
    },
    getBoundingClientRect() {
      return { width: 80, height: 32 };
    },
    click() {
      clicked = true;
    },
  };
  const cancelButton = {
    disabled: false,
    innerText: '取消',
    textContent: '取消',
    className: 'auxo-btn',
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return { width: 80, height: 32 };
    },
    click() {},
  };
  const dialog = {
    innerText: '导出开票订单 你要下载的信息中包含大量敏感的用户个人信息 报表字段 订单编号 发票状态',
    textContent: '导出开票订单 你要下载的信息中包含大量敏感的用户个人信息 报表字段 订单编号 发票状态',
    scrollHeight: 1200,
    clientHeight: 600,
    scrollTop: 0,
    getBoundingClientRect() {
      return { width: 760, height: 680 };
    },
    querySelectorAll() {
      return [cancelButton, exportButton];
    },
  };
  global.window = {
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    },
  };
  global.document = {
    querySelectorAll() {
      return [dialog];
    },
  };
  const fakePage = {
    async evaluate(fn) {
      return fn();
    },
  };

  try {
    const result = await 点击抖音导出弹窗提交按钮(fakePage);

    assert.equal(clicked, true);
    assert.equal(dialog.scrollTop, 1200);
    assert.equal(result.clicked, true);
    assert.equal(result.text, '导出');
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

test('抖音导出弹窗无文字主按钮也能提交', async () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  let clicked = false;
  const exportButton = {
    disabled: false,
    innerText: '',
    textContent: '',
    className: 'auxo-btn auxo-btn-primary',
    getAttribute(name) {
      return name === 'aria-disabled' ? 'false' : null;
    },
    getBoundingClientRect() {
      return { width: 88, height: 32, top: 620, left: 900 };
    },
    click() {
      clicked = true;
    },
  };
  const dialog = {
    innerText: '导出开票订单 你要下载的信息中包含大量敏感的用户个人信息 报表字段 订单编号 发票状态',
    textContent: '导出开票订单 你要下载的信息中包含大量敏感的用户个人信息 报表字段 订单编号 发票状态',
    scrollHeight: 1200,
    clientHeight: 600,
    scrollTop: 0,
    getBoundingClientRect() {
      return { width: 760, height: 680 };
    },
    querySelectorAll() {
      return [exportButton];
    },
  };
  global.window = {
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    },
  };
  global.document = {
    querySelectorAll() {
      return [dialog];
    },
  };
  const fakePage = {
    async evaluate(fn) {
      return fn();
    },
  };

  try {
    const result = await 点击抖音导出弹窗提交按钮(fakePage);

    assert.equal(clicked, true);
    assert.equal(result.clicked, true);
    assert.equal(result.className, 'auxo-btn auxo-btn-primary');
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

test('抖音导出弹窗会选择包含更多按钮的外层容器提交', async () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  let clicked = false;
  const closeButton = {
    disabled: false,
    innerText: '',
    textContent: '',
    className: 'auxo-modal-close',
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return { width: 16, height: 16, top: 160, left: 1200 };
    },
    click() {},
  };
  const exportButton = {
    disabled: false,
    innerText: '',
    textContent: '',
    className: 'auxo-btn auxo-btn-primary',
    getAttribute(name) {
      return name === 'aria-disabled' ? 'false' : null;
    },
    getBoundingClientRect() {
      return { width: 28, height: 20, top: 620, left: 900 };
    },
    click() {
      clicked = true;
    },
  };
  const innerTitleContainer = {
    innerText: '导出开票订单',
    textContent: '导出开票订单',
    scrollHeight: 120,
    clientHeight: 120,
    scrollTop: 0,
    getBoundingClientRect() {
      return { width: 300, height: 80 };
    },
    querySelectorAll() {
      return [closeButton];
    },
  };
  const outerDialog = {
    innerText: '导出开票订单 报表字段 订单编号 发票状态',
    textContent: '导出开票订单 报表字段 订单编号 发票状态',
    scrollHeight: 900,
    clientHeight: 600,
    scrollTop: 0,
    getBoundingClientRect() {
      return { width: 760, height: 680 };
    },
    querySelectorAll() {
      return [closeButton, exportButton];
    },
  };
  global.window = {
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    },
  };
  global.document = {
    querySelectorAll() {
      return [innerTitleContainer, outerDialog];
    },
  };
  const fakePage = {
    async evaluate(fn) {
      return fn();
    },
  };

  try {
    const result = await 点击抖音导出弹窗提交按钮(fakePage);

    assert.equal(clicked, true);
    assert.equal(result.clicked, true);
    assert.equal(result.className, 'auxo-btn auxo-btn-primary');
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

test('抖音导出弹窗支持组件库非 button 提交控件', async () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  let clicked = false;
  const exportControl = {
    disabled: false,
    innerText: '导出',
    textContent: '导出',
    className: 'auxo-btn auxo-btn-primary',
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return { width: 80, height: 32, top: 620, left: 900 };
    },
    click() {
      clicked = true;
    },
  };
  const dialog = {
    innerText: '导出开票订单 报表字段 订单编号 发票状态',
    textContent: '导出开票订单 报表字段 订单编号 发票状态',
    scrollHeight: 900,
    clientHeight: 600,
    scrollTop: 0,
    getBoundingClientRect() {
      return { width: 760, height: 680 };
    },
    querySelectorAll(selector) {
      return selector.includes('.auxo-btn') ? [exportControl] : [];
    },
  };
  global.window = {
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    },
  };
  global.document = {
    querySelectorAll() {
      return [dialog];
    },
  };
  const fakePage = {
    async evaluate(fn) {
      return fn();
    },
  };

  try {
    const result = await 点击抖音导出弹窗提交按钮(fakePage);

    assert.equal(clicked, true);
    assert.equal(result.clicked, true);
    assert.equal(result.text, '导出');
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

test('抖音导出弹窗会等待底部导出按钮延迟渲染', async () => {
  let evaluateCount = 0;
  const fakePage = {
    async evaluate() {
      evaluateCount += 1;
      if (evaluateCount === 1) {
        return {
          clicked: false,
          reason: '导出开票订单弹窗里没有可点击的提交按钮。',
          controls: [{ name: 'Close', className: 'auxo-drawer-close', rect: { width: 54, height: 54 } }],
        };
      }
      return {
        clicked: true,
        text: '导出',
        name: '导出',
        className: 'auxo-btn auxo-btn-primary',
        rect: { width: 74, height: 32 },
        controls: [],
      };
    },
  };

  const result = await 点击抖音导出弹窗提交按钮(fakePage);

  assert.equal(result.clicked, true);
  assert.equal(result.text, '导出');
  assert.equal(evaluateCount, 2);
});

test('CSV 解析支持引号逗号和 UTF-8 BOM', () => {
  const rows = 解析CSV文本('\uFEFF订单号,发票抬头,发票金额\r\n260620-1,"公司,分部",362.18\r\n');

  assert.deepEqual(rows, [
    ['订单号', '发票抬头', '发票金额'],
    ['260620-1', '公司,分部', '362.18'],
  ]);
});

test('抖音导出订单按表头转换为回传订单', () => {
  const order = 转换抖音导出订单({
    订单编号: '260620-302975557183160',
    子订单编号: '260620-302975557183160',
    申请时间: '2026-07-01 10:30:00',
    '发票金额（单位：元）': '362.18',
    发票类型: '增值税电子普通发票',
    抬头类型: '个人',
    发票抬头: '个人',
    税号: '-',
    订单状态: '已收货',
    发票状态: '待开票',
    开票方式: '手动上传',
  }, { id: 'douyin-store-1', name: '抖音店铺1' });

  assert.equal(order.key, 'douyin-store-1:260620-302975557183160');
  assert.equal(order.storeName, '抖音店铺1');
  assert.equal(order.invoiceType, '增值税电子普通发票');
  assert.equal(order.buyerTaxNumber, '');
  assert.equal(order.invoiceApplyTime, '2026-07-01 10:30:00');
  assert.equal(order.invoiceStatus, '待开票');
  assert.match(order.financeIssueReference, /财务参考/);
});

test('抖音财务开票参考按 7 个工作日估算', () => {
  const reference = 构建抖音财务开票参考(
    '2026-07-01 10:30:00',
    new Date(2026, 6, 8),
  );

  assert.equal(reference, '财务参考：已过 5 个工作日，常规约 7 个工作日，预计 2026-07-10 前后');
});

test('抖音财务开票参考能提示超过常规周期', () => {
  const reference = 构建抖音财务开票参考(
    '2026-07-01 10:30:00',
    new Date(2026, 6, 13),
  );

  assert.equal(reference, '财务参考：已过 8 个工作日，超过常规 7 个工作日');
});

test('抖音导出文件会去重并跳过空订单号', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-export-'));
  const filePath = path.join(dir, 'orders.csv');
  fs.writeFileSync(filePath, [
    '订单号,发票金额,发票类型,抬头类型,发票抬头',
    '260620-302975557183160,362.18,增值税电子普通发票,个人,个人',
    '260620-302975557183160,362.18,增值税电子普通发票,个人,个人',
    ',100.00,增值税电子普通发票,个人,个人',
  ].join('\n'), 'utf8');

  const orders = 读取抖音导出订单(filePath, { id: 'douyin-store-1', name: '抖音店铺1' });

  assert.equal(orders.length, 1);
  assert.equal(orders[0].orderNumber, '260620-302975557183160');
});
