const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function 读取源码文件(相对路径) {
  // 该函数读取关键源码文件，用架构测试防止通用正文等待重新混入识别主链路。
  return fs.readFileSync(path.join(__dirname, '..', 相对路径), 'utf8');
}

test('催票识别链路只允许消费者发票进门函数确认页面身份', () => {
  // 该用例锁住本次重构边界：扫描前必须走唯一进门函数，禁止旧正文关键词等待混回主链路。
  const 巡检源码 = 读取源码文件('src/app/checkInvoiceUrges.js');
  const 登录表单源码 = 读取源码文件('src/browser/jdLoginForm.js');
  const 等待源码 = 读取源码文件('src/browser/dynamicWait.js');
  const 扫描源码 = 读取源码文件('src/consumerInvoice/scanConsumerInvoiceUrges.js');
  const 进门源码 = 读取源码文件('src/consumerInvoice/enterConsumerInvoicePage.js');
  const 回传源码 = 读取源码文件('src/invoiceReturn/jdInvoiceUploader.js');

  assert.doesNotMatch(巡检源码, /等待页面正文可读|waitForFunction/);
  assert.doesNotMatch(登录表单源码, /等待页面正文可读|waitForFunction/);
  assert.doesNotMatch(等待源码, /等待页面正文可读|waitForFunction/);
  assert.match(巡检源码, /进入消费者发票页面/);
  assert.match(回传源码, /进入消费者发票页面/);
  assert.doesNotMatch(扫描源码, /进入消费者发票页面|确保已登录/);
  assert.doesNotMatch(巡检源码, /确保已登录/);
  assert.doesNotMatch(回传源码, /确保已登录/);
  assert.match(进门源码, /是目标地址页面/);
  assert.match(进门源码, /提交京东登录表单/);
  assert.match(登录表单源码, /button\.password__submit/);
  assert.doesNotMatch(扫描源码, /waitForConsumerInvoicePageReady|等待消费者发票页面可用/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src/browser/ensureAuthenticatedPage.js')), false);
});

test('店铺浏览器不再长期保存完整持久化用户目录', () => {
  // 该用例锁住 #45 根治方向：店铺浏览器只能使用最小登录态和临时上下文。
  const 新上下文源码 = 读取源码文件('src/browser/storeBrowser/contextFactory.js');
  const 巡检源码 = 读取源码文件('src/app/checkInvoiceUrges.js');

  assert.doesNotMatch(新上下文源码, /launchPersistentContext/);
  assert.match(新上下文源码, /browser\.newContext/);
  assert.match(新上下文源码, /storageState/);
  assert.match(巡检源码, /browser\/storeBrowser/);
  assert.match(巡检源码, /保存店铺浏览器登录态/);
  assert.doesNotMatch(巡检源码, /浏览器目录路径/);
});

test('成功识别路径不再保存全页截图和长页面预览', () => {
  // 该用例锁住 #88：成功路径只留轻量截图，页面长预览只服务失败诊断。
  const 巡检源码 = 读取源码文件('src/app/checkInvoiceUrges.js');
  const 扫描源码 = 读取源码文件('src/consumerInvoice/scanConsumerInvoiceUrges.js');

  assert.match(巡检源码, /function 保存轻量截图/);
  assert.match(巡检源码, /fullPage:\s*false/);
  assert.doesNotMatch(巡检源码, /fullPage:\s*true/);
  assert.doesNotMatch(扫描源码, /locator\('body'\)\.innerText\(\)/);
  assert.match(扫描源码, /pagePreview:\s*''/);
});
