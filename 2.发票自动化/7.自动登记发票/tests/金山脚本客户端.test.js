// 7号：金山 AirScript 客户端测试（锁死协议与报错文案，别让以后改坏）
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { 跑脚本, 取同步地址 } = require("../src/金山脚本客户端");

test("取同步地址：配好就返回，没配就报清楚的错", () => {
  assert.equal(取同步地址("query", { scripts: { query: { webhookUrl: "https://example.com/sync" } } }), "https://example.com/sync");
  assert.throws(() => 取同步地址("query", { scripts: { query: { webhookUrl: "" } } }), /条目存在但 webhookUrl 是空的/);
  assert.throws(() => 取同步地址("query", { scripts: {} }), /没有脚本「query」/);
});

async function 起假金山(处理器) {
  const 服务 = http.createServer(处理器);
  await new Promise((完成) => 服务.listen(0, "127.0.0.1", 完成));
  return { 服务, 地址: `http://127.0.0.1:${服务.address().port}/sync` };
}

test("跑脚本：带 AirScript-Token、参数走 Context.argv、结果取 data.result", async () => {
  let 收到头 = null;
  let 收到体 = null;
  const { 服务, 地址 } = await 起假金山((请求, 响应) => {
    收到头 = 请求.headers;
    let 体 = "";
    请求.on("data", (块) => { 体 += 块; });
    请求.on("end", () => {
      收到体 = JSON.parse(体);
      响应.writeHead(200, { "Content-Type": "application/json" });
      响应.end(JSON.stringify({ data: { result: { scriptVersion: "x", matchCount: 1, matches: [{ row: 7 }] } } }));
    });
  });
  try {
    const 结果 = await 跑脚本([{ keywords: ["260903-171347832413939"] }], { 配置: { apiToken: "test-token", scripts: { query: { webhookUrl: 地址 } } } });
    assert.equal(收到头["airscript-token"], "test-token");
    assert.deepEqual(收到体.Context.argv, [{ keywords: ["260903-171347832413939"] }]);
    assert.equal(结果.matchCount, 1);
    assert.equal(结果.matches[0].row, 7);
  } finally {
    服务.close();
  }
});

test("跑脚本：脚本报错时把 error 与堆栈带出来", async () => {
  const { 服务, 地址 } = await 起假金山((请求, 响应) => {
    响应.writeHead(200, { "Content-Type": "application/json" });
    响应.end(JSON.stringify({ error: "SyntaxError: Unexpected string", error_details: { stack: ["第 125 行"] } }));
  });
  try {
    await assert.rejects(
      () => 跑脚本([{}], { 配置: { apiToken: "test-token", scripts: { query: { webhookUrl: 地址 } } } }),
      /金山脚本报错：SyntaxError.*第 125 行/
    );
  } finally {
    服务.close();
  }
});

test("跑脚本：没返回 result 时提示最后一行要写 return main()", async () => {
  const { 服务, 地址 } = await 起假金山((请求, 响应) => {
    响应.writeHead(200, { "Content-Type": "application/json" });
    响应.end(JSON.stringify({ data: { result: "[Undefined]" } }));
  });
  try {
    await assert.rejects(
      () => 跑脚本([{}], { 配置: { apiToken: "test-token", scripts: { query: { webhookUrl: 地址 } } } }),
      /最后一行是 return main\(\)/
    );
  } finally {
    服务.close();
  }
});
