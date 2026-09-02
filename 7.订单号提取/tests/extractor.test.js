const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { extractIdentifiers } = require('../src/extractor.js');
const {
  extractTmallOrderNumbersFromXlsxArrayBuffer,
  matchTmallOrderNumbersByRefundNumbersFromXlsxArrayBuffer
} = require('../src/xlsxExtractor.js');

function logTestAction(subAction) {
  // 解决测试日志格式和项目观察口径一致的问题。
  const nowText = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${nowText}][tests/extractor.test.js:6][主线:验证][ExtractorTest][${subAction}]`);
}

function testPinduoduoOrderExtraction() {
  // 解决拼多多订单号格式必须继承旧项目规则的问题。
  const sourceText = [
    '订单 123456-123456789012345 已处理',
    '重复 123456-123456789012345',
    '无效 12345-123456789012345',
    '订单 654321-987654321098765'
  ].join('\n');
  const result = extractIdentifiers(sourceText, 'pinduoduo');
  assert.deepEqual(result.matches, [
    '123456-123456789012345',
    '123456-123456789012345',
    '654321-987654321098765'
  ]);
  assert.deepEqual(result.uniqueIdentifiers, [
    '123456-123456789012345',
    '654321-987654321098765'
  ]);
  assert.equal(result.duplicateCount, 1);
}

function testTmallRefundExtraction() {
  // 解决天猫退款编号只从明确标签后提取的问题。
  const sourceText = [
    '退款编号:393597901118912274',
    '处置时间 2026-06-11 12:16:36',
    '退款编号：392392297462160129',
    '退款编号:393597901118912274'
  ].join('\n');
  const result = extractIdentifiers(sourceText, 'tmall');
  assert.deepEqual(result.matches, [
    '393597901118912274',
    '392392297462160129',
    '393597901118912274'
  ]);
  assert.deepEqual(result.uniqueIdentifiers, [
    '393597901118912274',
    '392392297462160129'
  ]);
  assert.equal(result.duplicateCount, 1);
}

function testUnknownPlatformError() {
  // 解决新增平台没配置规则时不能静默输出空结果的问题。
  assert.throws(() => extractIdentifiers('退款编号:393597901118912274', 'unknown'), /未知店铺类型/);
}

async function testTmallWorkbookOrderExtraction() {
  // 解决天猫xlsx全量订单号读取能力可用于排查的问题。
  const fileBuffer = await fs.readFile('D:/桌面/办公软件/7.订单号提取/天猫1店2026年6月14日.xlsx');
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );
  const result = await extractTmallOrderNumbersFromXlsxArrayBuffer(arrayBuffer, fileBuffer.name);
  assert.equal(result.matches.length, 2022);
  assert.equal(result.uniqueIdentifiers.length, 796);
  assert.equal(result.duplicateCount, 1226);
  assert.equal(result.uniqueIdentifiers[0], '3286176169597104283');
  assert.equal(result.uniqueIdentifiers.at(-1), '3306570531738115496');
}

async function testTmallWorkbookOrderMatchingByRefundNumbers() {
  // 解决天猫xlsx只输出左侧退款编号对应订单号的问题。
  const sourceText = [
    '纠纷申诉 退款编号:257632752998108342',
    '退款编号：257676961525176339',
    '同一订单另一个退款编号:257754471715176339',
    '不存在 退款编号:999999999999999999',
    '重复 退款编号:257676961525176339'
  ].join('\n');
  const refundExtractionResult = extractIdentifiers(sourceText, 'tmall');
  const fileBuffer = await fs.readFile('D:/桌面/办公软件/7.订单号提取/天猫1店2026年6月14日.xlsx');
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );
  const result = await matchTmallOrderNumbersByRefundNumbersFromXlsxArrayBuffer(
    arrayBuffer,
    refundExtractionResult.uniqueIdentifiers,
    'test.xlsx'
  );
  assert.deepEqual(result.matchedRefundNumbers, [
    '257632752998108342',
    '257676961525176339',
    '257754471715176339'
  ]);
  assert.deepEqual(result.unmatchedRefundNumbers, ['999999999999999999']);
  assert.deepEqual(result.matches, [
    '3286176169597104283',
    '3286705908227173963',
    '3286705908227173963'
  ]);
  assert.deepEqual(result.matchedRows, [
    { refundNumber: '257632752998108342', orderNumber: '3286176169597104283' },
    { refundNumber: '257676961525176339', orderNumber: '3286705908227173963' },
    { refundNumber: '257754471715176339', orderNumber: '3286705908227173963' }
  ]);
  assert.deepEqual(result.displayLines, [
    '257632752998108342\t3286176169597104283',
    '257676961525176339\t3286705908227173963',
    '257754471715176339\t3286705908227173963'
  ]);
  assert.deepEqual(result.uniqueIdentifiers, [
    '3286176169597104283',
    '3286705908227173963'
  ]);
  assert.equal(result.duplicateCount, 1);
}

async function runTests() {
  // 解决集中运行所有提取规则回归测试的问题。
  testPinduoduoOrderExtraction();
  testTmallRefundExtraction();
  testUnknownPlatformError();
  await testTmallWorkbookOrderExtraction();
  await testTmallWorkbookOrderMatchingByRefundNumbers();
  logTestAction('全部通过');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
