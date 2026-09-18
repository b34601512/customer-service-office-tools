// 2026-09-18 实战沉淀：**失败原因被收尾动作盖掉** 这一类坑必须锁死。
//
// 现场：京东 1店/3店 导出后 60 秒没落盘（真实报错＝「点击京东导出后 60 秒内没有在指定目录检测到新文件」），
// 但 `runJdStandardExcelDownloadWithDependencies` 的 finally 里又去“恢复人工下载目录”，
// 那次调用抛了 `browserContext.newCDPSession: Target page, context or browser has been closed`，
// JS 语义上 finally 里抛的错会**替换**正在传播的原始错误 → 日志只剩 CDP 错，真原因丢了。
//
// 结论：收尾（恢复下载目录 / 断开调试连接）出错只能大声记日志，绝不能改变本次下载的结论。
const assert = require("assert");
const path = require("path");
const fs = require("fs");

const 任务文件 = path.resolve(__dirname, "../src/platforms/jd/standardExcelDownloadParts/jdStandardExcelDownloadTask.js");

function 造依赖(记录) {
  const 原始错误 = new Error("点击京东导出后 60 秒内没有在指定目录检测到新文件。");
  return {
    connectToChrome: async () => ({ name: "假浏览器" }),
    waitForJdLoginReady: async () => ({ url: () => "https://example.test/jd", bringToFront: async () => {} }),
    resolveStoreDownloadDir: () => "C:/临时下载目录",
    resolveExportDateRange: () => ({ startDate: "2026-09-01", endDate: "2026-09-16" }),
    reportProgress: () => {},
    executeJdStandardReportQuery: async () => {},
    ensureJdSystemRequiredMetricsVisible: async () => {},
    exportJdStandardExcel: async () => {
      记录.push("导出被调用");
      throw 原始错误;
    },
    // 收尾动作：模拟“浏览器/页面已经关了”，CDP 建会话失败
    enableDownloadBehavior: async () => {
      记录.push("恢复下载目录被调用");
      throw new Error("browserContext.newCDPSession: Target page, context or browser has been closed");
    },
    disconnectFromChrome: async () => {
      记录.push("断开连接被调用");
      throw new Error("断开调试连接失败（模拟）");
    }
  };
}

async function 主流程() {
  const 记录 = [];
  const { runJdStandardExcelDownloadWithDependencies } = require(
    "../src/platforms/jd/standardExcelDownloadParts/jdStandardExcelDownloadTask"
  );
  assert.strictEqual(
    typeof runJdStandardExcelDownloadWithDependencies,
    "function",
    "必须导出带依赖注入的入口，否则无法锁死“收尾不许盖住失败原因”"
  );

  let 抛出的错误 = null;
  try {
    await runJdStandardExcelDownloadWithDependencies(
      { activeStore: { displayName: "京东9店（测试）", exportDateRange: {}, customerServiceScope: {} } },
      {
        openReportContext: async () => ({ page: { url: () => "https://example.test/jd" }, surface: "测试面" }),
        applyDateRange: async () => {}
      },
      null,
      // 说明：依赖注入走 override 通道，测试全程不碰真实浏览器。
      造依赖(记录)
    );
  } catch (错误) {
    抛出的错误 = 错误;
  }

  // ① 收尾动作确实跑了（说明测的是真实收尾路径，不是跳过）
  assert.ok(记录.includes("恢复下载目录被调用"), "收尾时应该去恢复人工下载目录");
  assert.ok(记录.includes("断开连接被调用"), "收尾时应该断开调试连接");

  // ② 关键反向断言：暴露出来的必须是**原始下载失败原因**，不是收尾时的 CDP 错误
  assert.ok(抛出的错误, "下载失败就必须抛错，不允许静默成功");
  assert.strictEqual(
    抛出的错误.message,
    "点击京东导出后 60 秒内没有在指定目录检测到新文件。",
    `失败原因必须是下载本身的原因；现在暴露的是「${抛出的错误.message}」——说明收尾动作又把真原因盖掉了`
  );

  // ③ 源码层面也不允许回到“finally 里裸 await 收尾”的老写法
  const 源码 = fs.readFileSync(任务文件, "utf8");
  assert.ok(
    源码.includes("不影响本次下载结论，仅记录"),
    "收尾失败必须显式记日志并说明不影响结论（反向锁死：不许再让收尾错误冒泡）"
  );
  assert.ok(
    !/finally\s*\{\s*await\s+restoreJdManualDownloadDir\(/.test(源码),
    "finally 里不允许再裸 await 收尾动作（会替换原始错误）"
  );
}

主流程()
  .then(() => console.log("  jdCleanupMustNotMaskFailure：全部通过"))
  .catch((错误) => {
    console.error(错误);
    process.exitCode = 1;
  });
