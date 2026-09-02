const test = require("node:test");
const assert = require("node:assert/strict");

const { assertChatPageReady, clickLeftAllMenu } = require("../../src/features/chatPage");
const { DEFAULT_BACKGROUND_POLLING_MS } = require("../../src/engine/pageWait");
const { subscribeLogs } = require("../../src/engine/logHub");

function createFakePage({
  bodyText,
  url,
  frameUrls,
  allButtonCount = 0,
  afterChatClickBodyText = "",
  afterChatClickUrl = ""
}) {
  // 这里构造最小页面桩，覆盖聊天页动态等待与点击「全部」需要的浏览器接口。
  let currentUrl = url || "https://zan-mh.xiaoshunai.com/main/mock/chat";
  let currentBodyText = bodyText || "";
  let currentFrameUrls = frameUrls || [currentUrl];
  const recorder = {
    waitForTimeoutCount: 0,
    waitForFunctionCalls: [],
    allClickCount: 0,
    chatWorkbenchClickCount: 0,
    aggregateChatClickCount: 0
  };

  const allLocator = {
    waitFor() {
      return Promise.resolve();
    },
    isVisible() {
      return Promise.resolve(true);
    },
    boundingBox() {
      return Promise.resolve({ x: 12, y: 120, width: 56, height: 28 });
    },
    click() {
      recorder.allClickCount += 1;
      return Promise.resolve();
    }
  };

  const page = {
    recorder,
    waitForTimeout() {
      recorder.waitForTimeoutCount += 1;
      return Promise.resolve();
    },
    waitForFunction(handler, arg, options) {
      const source = String(handler);
      recorder.waitForFunctionCalls.push({
        source,
        arg,
        options
      });
      const normalizedText = String(currentBodyText || "").replace(/\s+/g, "");

      if (source.includes("text.length > 0")) {
        return Promise.resolve();
      }

      if (source.includes("全部对话") && source.includes("账号视图")) {
        if (normalizedText.includes("全部对话") && normalizedText.includes("账号视图")) {
          return Promise.resolve();
        }

        return Promise.reject(new Error("聊天工作台未就绪"));
      }

      return Promise.resolve();
    },
    evaluate() {
      return Promise.resolve();
    },
    url() {
      return currentUrl;
    },
    frames() {
      return currentFrameUrls.map((frameUrl) => ({
        url() {
          return frameUrl;
        },
        getByText() {
          return {
            count() {
              return Promise.resolve(allButtonCount);
            },
            nth() {
              return allLocator;
            }
          };
        }
      }));
    },
    getByText(pattern) {
      if (String(pattern).includes("聚合聊天")) {
        return {
          first() {
            return {
              waitFor() {
                return Promise.resolve();
              },
              click() {
                recorder.aggregateChatClickCount += 1;
                currentBodyText = afterChatClickBodyText || currentBodyText;
                currentUrl = afterChatClickUrl || currentUrl;
                currentFrameUrls = [currentUrl];
                return Promise.resolve();
              }
            };
          }
        };
      }

      if (String(pattern).includes("聊天工作台")) {
        return {
          first() {
            return {
              waitFor() {
                return Promise.resolve();
              },
              click() {
                recorder.chatWorkbenchClickCount += 1;
                currentBodyText = afterChatClickBodyText || currentBodyText;
                currentUrl = afterChatClickUrl || currentUrl;
                currentFrameUrls = [currentUrl];
                return Promise.resolve();
              }
            };
          }
        };
      }

      return {
        first() {
          return {
            waitFor() {
              return Promise.resolve();
            }
          };
        }
      };
    },
    locator(selector) {
      if (selector !== "body") {
        throw new Error(`未支持的测试选择器：${selector}`);
      }

      return {
        waitFor() {
          return Promise.resolve();
        },
        innerText() {
          return Promise.resolve(currentBodyText);
        }
      };
    }
  };

  return page;
}

test("聊天页准备检查应直接识别手机号验证码登录页", async () => {
  const page = createFakePage({
    bodyText: `
      登录登录
      密码登录
      验证码登录
      扫码登录
      中国 +86
      获取短信验证码
      确认授权
      忘记密码免费注册
    `
  });

  await assert.rejects(
    () => assertChatPageReady(page),
    /当前登录态已失效，请点击控制台里的「首次登录」重新登录。命中特征：/
  );
});

test("点击全部前应在登录页直接中断，而不是继续等待工作台超时", async () => {
  const page = createFakePage({
    bodyText: `
      登录登录
      验证码登录
      中国 +86
      获取短信验证码
      忘记密码免费注册
    `
  });

  await assert.rejects(
    () => clickLeftAllMenu(page),
    /获取短信验证码/
  );
});

test("聊天页准备检查应直接识别小蟹账号密码登录页", async () => {
  const page = createFakePage({
    url: "https://zan-bg.xiaoshunai.com/auth/login",
    bodyText: `
      欢迎使用
      登录
      忘记密码
      登 录
      我已阅读并接受用户协议
      没有账号？注册
      用户协议
    `
  });

  await assert.rejects(
    () => assertChatPageReady(page),
    /命中特征：欢迎使用、忘记密码、用户协议/
  );
});

test("聊天页准备检查应直接识别有赞 redirectUrl 授权失败页", async () => {
  const page = createFakePage({
    url: "https://oauth.youzan.com/login/quick?clientId=mock",
    bodyText: `
      有赞
      快速安全登录
      授权应用信息[redirectUrl]错误,授权失败
      确认授权
    `
  });

  await assert.rejects(
    () => assertChatPageReady(page),
    /命中特征：授权应用信息、redirectUrl、授权失败/
  );
});

test("正常聊天工作台正文不应被误判成登录页", async () => {
  const page = createFakePage({
    bodyText: `
      全部对话
      账号视图
      客户甲
    `
  });

  await assert.doesNotReject(() => assertChatPageReady(page));
  assert.equal(page.recorder.waitForTimeoutCount, 0);
  assert.ok(
    page.recorder.waitForFunctionCalls.every(
      (call) => call.options.polling === DEFAULT_BACKGROUND_POLLING_MS
    )
  );
});

test("聊天页准备日志应该只在页面快照变化时记录", async () => {
  const page = createFakePage({
    bodyText: `
      全部对话
      账号视图
      客户甲
    `,
    frameUrls: [
      "https://zan-mh.xiaoshunai.com/main/mock/chat",
      "https://zan-bg.xiaoshunai.com/side/materialRepo"
    ]
  });
  const capturedLines = [];
  const unsubscribe = subscribeLogs((line) => {
    capturedLines.push(line);
  });

  try {
    await assertChatPageReady(page);
    await assertChatPageReady(page);
  } finally {
    unsubscribe();
  }

  assert.equal(capturedLines.filter((line) => line.includes("[检查页面状态]")).length, 1);
  assert.equal(capturedLines.filter((line) => line.includes("[检查Frame]")).length, 1);
  assert.equal(capturedLines.filter((line) => line.includes("[记录Frame地址]")).length, 2);
});

test("企业控制台应该自动点击聊天工作台再通过检查", async () => {
  const page = createFakePage({
    url: "https://zan-bg.xiaoshunai.com/console/member",
    bodyText: `
      企业控制台
      聊天工作台
      小组控制台
      管理中心
      组织架构
    `,
    afterChatClickUrl: "https://zan-mh.xiaoshunai.com/main/new-org/new-group/chat",
    afterChatClickBodyText: `
      全部对话
      账号视图
      客户甲
    `
  });

  await assert.doesNotReject(() => assertChatPageReady(page));
  assert.equal(page.recorder.chatWorkbenchClickCount, 1);
  assert.equal(page.url(), "https://zan-mh.xiaoshunai.com/main/new-org/new-group/chat");
});

test("聊天工作台导航页应该自动点击聚合聊天再通过检查", async () => {
  const page = createFakePage({
    url: "https://zan-mh.xiaoshunai.com/main/org-id/group-id/chat",
    bodyText: `
      聊天工作台
      德达集团
      聚合聊天
      聊天历史
      绩效统计
      小组工作台
      AI工作台
      企业控制台
      黎经理
    `,
    afterChatClickUrl: "https://zan-mh.xiaoshunai.com/main/org-id/group-id/chat",
    afterChatClickBodyText: `
      全部对话
      账号视图
      客户甲
    `
  });

  await assert.doesNotReject(() => assertChatPageReady(page));
  assert.equal(page.recorder.aggregateChatClickCount, 1);
});

test("点击全部成功时不应该再执行固定毫秒等待", async () => {
  const page = createFakePage({
    bodyText: `
      全部对话
      账号视图
      客户甲
      客户乙
    `,
    allButtonCount: 1
  });

  await assert.doesNotReject(() => clickLeftAllMenu(page));
  assert.equal(page.recorder.waitForTimeoutCount, 0);
  assert.equal(page.recorder.allClickCount, 1);
  assert.ok(
    page.recorder.waitForFunctionCalls.every(
      (call) => call.options.polling === DEFAULT_BACKGROUND_POLLING_MS
    )
  );
});
