// 2026-09-18 实战沉淀：`page.url()` 是同步返回字符串，**没有 .catch**。
//
// 现场：我在 2026-09-17 删天猫平响“自动重试”时写下 `(await page.url?.().catch(() => ""))`，
// 天猫1店 平响报表未就绪时走到这个分支 → 抛 `TypeError: page.url(...).catch is not a function`，
// 把真原因（“报表未就绪”）盖成了 TypeError（同一天同一类事故的第二起：错误现场被盖掉）。
//
// 本测试用反向断言锁死：src 里任何地方都不许把 page.url() 当 Promise 用。
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const 源码根 = path.resolve(__dirname, "../src");

// 同时覆盖 page.url().catch( 与 page.url?.().catch( 两种误用
const 误用正则 = /\.url\s*\?\.?\s*\([^)]*\)\s*\.catch\s*\(/;

function 收集源码文件(目录) {
  const 结果 = [];
  for (const 条目 of fs.readdirSync(目录, { withFileTypes: true })) {
    const 全路径 = path.join(目录, 条目.name);
    if (条目.isDirectory()) {
      结果.push(...收集源码文件(全路径));
    } else if (条目.name.endsWith(".js")) {
      结果.push(全路径);
    }
  }
  return 结果;
}

function 主流程() {
  const 违规 = [];
  for (const 文件 of 收集源码文件(源码根)) {
    const 源码 = fs.readFileSync(文件, "utf8");
    const 行列表 = 源码.split(/\r?\n/);
    行列表.forEach((行, 序号) => {
      // 只认真正的误用：page.url(...) 后面直接跟 .catch( ；注释行不算
      if (/^\s*\/\//.test(行)) return;
      if (误用正则.test(行)) {
        违规.push(`${path.relative(源码根, 文件)}:${序号 + 1}: ${行.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(
    违规,
    [],
    `page.url() 是同步返回字符串，不能调用 .catch —— 误用会把真实失败原因盖成 TypeError：\n${违规.join("\n")}`
  );

  // 自检：把已知的错误写法喂进来必须能被抓到（否则这个守卫是假的）
  const 样例 = 'const 地址 = (await page.url?.().catch(() => "")) || "";';
  assert.ok(
    误用正则.test(样例),
    "守卫正则必须能抓到 page.url().catch 这种写法（自检失败说明规则写错了）"
  );

  // 天猫平响的“未就绪现场日志”必须仍然存在，并且带当前地址
  const 流程 = fs.readFileSync(
    path.resolve(__dirname, "../src/platforms/tmall/responseTimeReportParts/tmallResponseTimeReportFlow.js"),
    "utf8"
  );
  assert.ok(流程.includes("未自动重试"), "报表未就绪时要保留“未自动重试”的现场日志");
  assert.ok(流程.includes("page.url()"), "现场日志要读当前页面地址（但必须是同步安全读法）");
}

try {
  主流程();
  console.log("  pageUrlCatchMisuseGuard：全部通过");
} catch (错误) {
  console.error(错误);
  process.exitCode = 1;
}
