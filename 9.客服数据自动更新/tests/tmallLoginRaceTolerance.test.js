// #P4-20260915 单元测试：天猫登录面竞态不再让整店失败。
// 背景：天猫2店登录态失效时会走登录页；登录页在跳转瞬间会销毁执行上下文，
//      旧代码把 locator.evaluateAll 的“Execution context was destroyed”当成整店失败抛出。
// 修复：竞态错误按“暂未找到/无需切换”交回上层继续轮询登录状态，真实错误仍然抛出。
const assert = require("assert");
const { isTmallLoginSurfaceRaceError, findFirstVisibleLocator } = require("../src/platforms/tmall/tmallLoginSurface");
const { tryAutofillTmallLoginPage } = require("../src/platforms/tmall/tmallLoginAutofill");

const RACE_MESSAGE = "locator.evaluateAll: Execution context was destroyed, most likely because of a navigation";
const DETACHED_MESSAGE = "locator.fill: Element is not attached to the DOM";
const REAL_MESSAGE = "天猫登录页结构异常：缺少唯一提交按钮";

function makeLocator(selector, options) {
  const counts = options.selectorCounts || {};
  return {
    first() {
      return this;
    },
    async count() {
      if (options.locatorThrows && options.throwOnSelector === selector) {
        throw options.locatorThrows;
      }
      return Object.prototype.hasOwnProperty.call(counts, selector) ? counts[selector] : 0;
    },
    async isVisible() {
      return options.visible !== false;
    },
    async evaluateAll() {
      if (options.evaluateAllThrows) throw options.evaluateAllThrows;
      return options.hasVisiblePassword === true;
    },
    async fill(value) {
      if (options.fillThrows) throw options.fillThrows;
      options.filled.push({ selector, value });
    }
  };
}

function makeFrame(options = {}) {
  options.filled = options.filled || [];
  return {
    locator(selector) {
      if (options.locatorThrows) throw options.locatorThrows;
      if (options.textThrows) throw options.textThrows;
      return makeLocator(selector, options);
    },
    getByText() {
      return {
        first() {
          return {
            async count() {
              if (options.textThrows) throw options.textThrows;
              if (options.locatorThrows) throw options.locatorThrows;
              return options.textCount || 0;
            },
            async isVisible() {
              return true;
            }
          };
        }
      };
    }
  };
}

function makePage(frames) {
  return { frames: () => frames };
}

async function main() {
  // 1. 竞态错误识别：跳转/脱离/关闭算竞态，业务真实错误不算。
  assert.strictEqual(isTmallLoginSurfaceRaceError(new Error(RACE_MESSAGE)), true, "上下文销毁必须识别为竞态");
  assert.strictEqual(isTmallLoginSurfaceRaceError(new Error(DETACHED_MESSAGE)), true, "元素脱离必须识别为竞态");
  assert.strictEqual(isTmallLoginSurfaceRaceError(new Error(REAL_MESSAGE)), false, "业务错误不能被当成竞态吞掉");

  // 2. findFirstVisibleLocator：页面跳走按“暂未找到”返回 null；真实错误继续抛出。
  const raceFrame = {
    locator() {
      throw new Error(RACE_MESSAGE);
    }
  };
  assert.strictEqual(await findFirstVisibleLocator(raceFrame, ["input[type='text']"]), null, "竞态时应返回 null");

  const brokenFrame = {
    locator() {
      throw new Error(REAL_MESSAGE);
    }
  };
  await assert.rejects(
    () => findFirstVisibleLocator(brokenFrame, ["input[type='text']"]),
    /天猫登录页结构异常/,
    "真实错误必须继续抛出"
  );

  const healthyFrame = makeFrame({ selectorCounts: { "input[type='text']": 1 } });
  const found = await findFirstVisibleLocator(healthyFrame, ["input[type='text']"]);
  assert.ok(found, "正常页面必须能定位到可见输入框");

  // 3. 登录页整体在同一帧里被导航销毁：应返回 false 而不是抛出（这是 2026-09-15 天猫2店整店失败的原因）。
  const destroyedFrame = makeFrame({ locatorThrows: new Error(RACE_MESSAGE) });
  const falseResult = await tryAutofillTmallLoginPage(
    makePage([destroyedFrame]),
    { displayName: "天猫2店", username: "u", password: "p" },
    new WeakSet()
  );
  assert.strictEqual(falseResult, false, "登录页被导航销毁时必须返回 false 交回上层轮询");

  const detachedFrame = makeFrame({ fillThrows: new Error(DETACHED_MESSAGE) });
  const detachedResult = await tryAutofillTmallLoginPage(
    makePage([detachedFrame]),
    { displayName: "天猫2店", username: "u", password: "p" },
    new WeakSet()
  );
  assert.strictEqual(detachedResult, false, "填表过程中元素脱离时必须返回 false 交回上层轮询");

  // 4. 正常密码登录页：仍然照常填写账号密码。
  const filled = [];
  const loginPageFrame = makeFrame({
    hasVisiblePassword: true,
    selectorCounts: { "input[type='text']": 1, "input[type='password']": 1 },
    filled
  });
  const okResult = await tryAutofillTmallLoginPage(
    makePage([loginPageFrame]),
    { displayName: "天猫2店", username: "kefu-account", password: "kefu-pass" },
    new WeakSet()
  );
  assert.strictEqual(okResult, true, "正常登录页必须完成自动填充");
  assert.deepStrictEqual(
    filled.map((item) => item.value),
    ["kefu-account", "kefu-pass"],
    "必须按顺序填入账号与密码"
  );

  // 5. 真实错误不能被吞：缺账号配置时返回 false，页面结构异常时抛出。
  const noCredentials = await tryAutofillTmallLoginPage(
    makePage([loginPageFrame]),
    { displayName: "天猫2店", username: "", password: "" },
    new WeakSet()
  );
  assert.strictEqual(noCredentials, false, "缺账号密码时应返回 false");

  const brokenLoginFrame = makeFrame({ evaluateAllThrows: new Error(REAL_MESSAGE) });
  await assert.rejects(
    () =>
      tryAutofillTmallLoginPage(
        makePage([brokenLoginFrame]),
        { displayName: "天猫2店", username: "u", password: "p" },
        new WeakSet()
      ),
    /天猫登录页结构异常/,
    "真实错误必须继续抛出，不能被竞态容错吞掉"
  );

  console.log("PASS tmallLoginRaceTolerance：竞态收敛为 false、真实错误照抛、正常登录照填");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
