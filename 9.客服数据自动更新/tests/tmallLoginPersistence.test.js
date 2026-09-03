// #632 单元测试：登录态持久化只把会话级 cookie2/_tb_token_ 转为持久副本；
// 已是持久 cookie 不重复处理；任何底层失败都不得影响登录主流程。
const assert = require("assert");
const { persistTmallSessionCookies } = require("../src/platforms/tmall/tmallLoginState");

function makeContext(cookies, options = {}) {
  return {
    added: [],
    async cookies() {
      return cookies;
    },
    async addCookies(items) {
      if (options.fail) {
        throw new Error("CDP拒绝写入");
      }
      this.added.push(...items);
    }
  };
}

async function main() {
  const sessionCookie = { name: "cookie2", value: "v1", domain: ".taobao.com", path: "/", expires: -1, secure: false, httpOnly: true, sameSite: "Lax" };
  const tokenCookie = { name: "_tb_token_", value: "t1", domain: ".taobao.com", path: "/", expires: -1 };
  const persistentOne = { name: "cookie2", value: "v2", domain: ".sycm.taobao.com", path: "/", expires: 9999999999 };
  const unrelated = { name: "t", value: "u", domain: ".taobao.com", path: "/", expires: -1 };

  const ok = makeContext([sessionCookie, tokenCookie, persistentOne, unrelated]);
  const result = await persistTmallSessionCookies(ok);
  assert.strictEqual(result.persisted, 2, "应只持久化两条会话级票据");
  assert.deepStrictEqual(ok.added.map((item) => item.name).sort(), ["_tb_token_", "cookie2"]);
  assert.ok(ok.added.every((item) => item.expires > Date.now() / 1000), "expires 必须是未来时间戳");
  assert.strictEqual(ok.added.find((item) => item.name === "cookie2").httpOnly, true);

  const noop = makeContext([persistentOne]);
  assert.strictEqual((await persistTmallSessionCookies(noop)).persisted, 0, "已是持久cookie不应重复写");
  assert.strictEqual(noop.added.length, 0);

  const failing = makeContext([sessionCookie], { fail: true });
  const fallback = await persistTmallSessionCookies(failing);
  assert.strictEqual(fallback.persisted, 0, "底层失败必须吞掉并返回0，不得抛出中断登录");
  assert.match(fallback.error, /CDP拒绝写入/);

  console.log("PASS tmallLoginPersistence：会话票据转持久、跳过已持久、失败静默降级");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
