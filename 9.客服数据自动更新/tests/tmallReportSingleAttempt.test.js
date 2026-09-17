// 2026-09-17 用户拍板：「重复请求平台数据」的自动重试整套删掉。
// 背景：天猫2店平响报表表头卡在“加载中…”时，之前的“回退重进”重试白等 180×2 秒（还可能加重平台限流）。
// 新方针：只试一次 → 当场报错 + 把现场写进日志 → 由人/模型定位原因后决定要不要手工补跑。
// 本测试用反向断言锁死这件事，谁再把自动重试加回来就会红。
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const 流程文件 = path.resolve(__dirname, "../src/platforms/tmall/responseTimeReportParts/tmallResponseTimeReportFlow.js");
const 源码 = fs.readFileSync(流程文件, "utf8");

async function 主流程() {
  // ① 源码里不允许再有“回退重试”的任何痕迹（不留开关、不留参数、不留死代码）
  for (const 禁词 of ["报表加载重试", "带重试", "报表最大尝试次数", "报表尝试次数", "回到千牛入口", "page.reload(", "page.goto("]) {
    assert.ok(!源码.includes(禁词), `天猫平响流程里不应再出现「${禁词}」（自动重试已被删掉）`);
  }

  // ② “只试一次”的硬证据：等待表头就绪的调用在文件里只出现 1 次
  {
    const 次数 = (源码.match(/await waitForTmallAverageResponseTimeReady\(/g) || []).length;
    assert.strictEqual(次数, 1, "等待平均响应时间报表就绪只允许调用一次（失败即抛错，不自动重试）");
  }

  // ③ 失败要留现场：未就绪时必须有一条把当前地址 + 原始报错写进日志的分支
  assert.ok(源码.includes("未自动重试"), "报表未就绪时必须留下“未自动重试”的现场日志");
  assert.ok(源码.includes("当前地址="), "报表未就绪的日志里必须带当前页面地址");

  // ④ 导出面：旧的“带重试地打开平均响应时间报表”必须消失（防止有人换个名字又引回来）
  {
    const 模块 = require("../src/platforms/tmall/responseTimeReportParts/tmallResponseTimeReportFlow");
    assert.ok(!("带重试地打开平均响应时间报表" in 模块), "带重试的入口必须从导出里删干净");
    assert.deepStrictEqual(
      Object.keys(模块).sort(),
      ["buildResponseTimeClickOptions", "clickTmallResponseTimeExport", "prepareTmallResponseTimeExportPage", "waitForTmallCustomerSatisfactionDetailReady"],
      "导出面必须只剩这四个（不多不少）"
    );
  }

  // ⑤ 行为：登录就绪这一步失败时，错误必须原样抛出（不能被吞掉、不能换成“已重试后成功”）
  {
    const 登录模块路径 = require.resolve("../src/platforms/tmall/responseTimeReportParts/tmallResponseTimeLogin");
    const 登录模块 = require(登录模块路径);
    const 原始 = 登录模块.waitForTmallResponseTimeLoginReady;
    登录模块.waitForTmallResponseTimeLoginReady = async () => {
      throw new Error("原始报错A");
    };
    delete require.cache[流程文件];
    let 流程 = null;
    try {
      流程 = require(流程文件);
      let 抛出 = null;
      try {
        await 流程.prepareTmallResponseTimeExportPage({ url: async () => "https://example.invalid/x" }, {});
      } catch (错误) {
        抛出 = 错误;
      }
      assert.ok(抛出, "登录未就绪时必须抛错");
      assert.strictEqual(抛出.message, "原始报错A", "必须原样抛出原始错误（不吞错、不改写、不偷偷重试）");
    } finally {
      登录模块.waitForTmallResponseTimeLoginReady = 原始;
      delete require.cache[流程文件];
      void 流程;
    }
  }

  // ⑥ 全项目范围：src 里不允许存在“自动重跑整店”的调用（补跑只能由人/模型手工发起）
  {
    const 命中 = [];
    const 走目录 = (目录) => {
      for (const 名 of fs.readdirSync(目录, { withFileTypes: true })) {
        const 全路径 = path.join(目录, 名.name);
        if (名.isDirectory()) 走目录(全路径);
        else if (名.isFile() && 名.name.endsWith(".js") && 源码分支允许(全路径)) {
          const 文本 = fs.readFileSync(全路径, "utf8");
          if (/retryFailedStores/.test(文本)) 命中.push(全路径);
        }
      }
    };
    function 源码分支允许(全路径) {
      return 全路径.includes(`${path.sep}src${path.sep}`);
    }
    走目录(path.resolve(__dirname, "../src"));
    assert.deepStrictEqual(命中, [], "src 里不得引用 retryFailedStores（补跑必须由人/模型手工决定）");
  }

  // ⑦ 汇总层原有方针不能被改掉：普通报错不重试、不重置整轮
  {
    const 汇总源码 = fs.readFileSync(path.resolve(__dirname, "../src/summary/storeSummaryParts/hybridSourceRunner.js"), "utf8");
    assert.ok(汇总源码.includes("普通报错不重试"), "汇总层“普通报错不重试”的方针必须保留");
  }

  console.log("  ✓ 平响流程：源码里已无任何自动重试痕迹（不留开关/参数/死代码）");
  console.log("  ✓ 平响流程：等待表头就绪只调用 1 次（只试一次）");
  console.log("  ✓ 平响流程：未就绪时留下“未自动重试 + 当前地址 + 原始报错”现场日志");
  console.log("  ✓ 平响流程：导出面只剩 4 个函数，带重试入口已消失");
  console.log("  ✓ 平响流程：失败时原样抛错（不吞错、不偷偷重试）");
  console.log("  ✓ 全项目：src 里没有自动重跑整店的调用");
  console.log("  ✓ 汇总层：“普通报错不重试、不重置整轮”方针仍在");
}

主流程().catch((错误) => {
  console.error("  ✗ 天猫平响“只试一次”回归失败：" + (错误 && 错误.message ? 错误.message : 错误));
  process.exitCode = 1;
});
