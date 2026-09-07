const test = require('node:test');
const assert = require('node:assert/strict');
const { 打开抖音待回传发票页面 } = require('../src/invoiceReturn/douyinInvoicePage');

function fixture() {
  let pages = [];
  const list = (items) => ({ count: async () => items.length, nth: (i) => items[i] });
  function makePage(id, name) {
    let closed = false;
    const header = {
      count: async () => 1, isVisible: async () => true, waitFor: async () => {},
      locator: (selector) => selector.includes('label=')
        ? list([{ getAttribute: async () => id }])
        : list([{ isVisible: async () => true, innerText: async () => name }]),
    };
    return {
      id, navigations: 0,
      isClosed: () => closed,
      close: async () => { closed = true; },
      context: () => ({ pages: () => pages.filter((p) => !p.isClosed()) }),
      goto: async function () { this.navigations += 1; },
      url: () => 'https://fxg.jinritemai.com/ffa/morder/receipt/list',
      bringToFront: async () => {}, waitForTimeout: async () => {},
      keyboard: { press: async () => {} }, evaluate: async () => [],
      locator: (selector) => selector === 'body'
        ? { innerText: async () => '消费者申请开票记录 导出订单 导出记录 上传发票' }
        : { first: () => header },
      getByText: (text) => list(text === '切换组织/店铺' ? [{
        isVisible: async () => true,
        click: async () => { pages.push(target); },
      }] : text === 'B店' ? [{
        isVisible: async () => true, isDisabled: async () => false, click: async () => {},
      }] : []),
    };
  }
  const origin = makePage('1', 'A店');
  const target = makePage('2', 'B店');
  pages = [origin];
  return { origin, target };
}

test('切店打开新页时返回新页、关闭旧页并核验最终店铺', async () => {
  const { origin, target } = fixture();
  const page = await 打开抖音待回传发票页面(origin, { platformStoreId: '2', platformStoreName: 'B店' });
  assert.equal(page, target);
  assert.equal(origin.isClosed(), true);
  assert.equal(target.navigations, 0);
});

test('当前页已是目标店铺时复用原页面', async () => {
  const { origin } = fixture();
  const page = await 打开抖音待回传发票页面(origin, { platformStoreId: '1', platformStoreName: 'A店' });
  assert.equal(page, origin);
  assert.equal(origin.isClosed(), false);
  assert.equal(origin.navigations, 0);
});
