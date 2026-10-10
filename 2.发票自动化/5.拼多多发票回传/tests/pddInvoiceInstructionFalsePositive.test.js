const test = require('node:test');
const assert = require('node:assert/strict');
const {
  是拼多多录入说明文本,
  格式化拼多多错误文本列表,
} = require('../src/invoiceReturn/pddInvoicePage');

test('拼多多录入说明面板文本不当成校验错误', () => {
  const tips = [
    '2. 订单号、抬头类型、发票抬头、发票文件名必填；企业税号仅企业抬头需填写',
    '4. 发票文件名：填写的发票文件名需与上传的发票文件名一致，填写的文件名无需带.pdf后缀',
    '1.上传的发票文件名需与发票信息中填写的文件名一致 2.仅支持上传PDF文件，单个文件大小不超过5M',
  ];
  for (const tip of tips) {
    assert.equal(是拼多多录入说明文本(tip), true, tip);
  }
  const filtered = 格式化拼多多错误文本列表([...tips, '请完善信息：发票号码不能为空']).filter((text) => !是拼多多录入说明文本(text));
  assert.deepEqual(filtered, ['请完善信息：发票号码不能为空']);
});

test('真实失败短语仍识别为非说明文本', () => {
  assert.equal(是拼多多录入说明文本('请完善信息'), false);
  assert.equal(是拼多多录入说明文本('发票号码需为8到20位数字'), false);
  assert.equal(是拼多多录入说明文本('提交失败'), false);
});
