const test = require("node:test");
const assert = require("node:assert/strict");
const { 解析Csv文本, 解码Csv缓冲区 } = require("../src/解析Csv");

test("基础解析：表头 + 行", () => {
  const 行 = 解析Csv文本("a,b\n1,2\n3,4\n");
  assert.deepEqual(行, [{ a: "1", b: "2" }, { a: "3", b: "4" }]);
});

test("引号字段：逗号、换行、双引号都能处理", () => {
  const 文本 = 'a,b\n"x,1","他说""你好"""\n"多\n行",ok\n';
  const 行 = 解析Csv文本(文本);
  assert.equal(行[0].a, "x,1");
  assert.equal(行[0].b, '他说"你好"');
  assert.equal(行[1].a, "多\n行");
});

test("BOM 与 CRLF 与空行", () => {
  const 行 = 解析Csv文本("\uFEFFa,b\r\n1,2\r\n\r\n3,4\r\n");
  assert.equal(行.length, 2);
  assert.equal(行[0].a, "1");
  assert.equal(行[1].b, "4");
});

test("缺列补空：不抛错", () => {
  const 行 = 解析Csv文本("a,b,c\n1,2\n");
  assert.equal(行[0].c, "");
});

test("GBK 缓冲区解码（ERP 导出编码）", () => {
  const gbk = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0x2C, 0x31, 0x0A]); // 你好,1\n
  const 文本 = 解码Csv缓冲区(gbk);
  assert.match(文本, /你好,1/);
});

test("UTF-8 缓冲区也能解码", () => {
  const 文本 = 解码Csv缓冲区(Buffer.from("店铺,金额\n拼多多2店,374.12\n", "utf8"));
  assert.match(文本, /拼多多2店/);
});
