// 回归 2026-09-17 天猫2店「平均响应时间报表表头一直加载中」：
// 页面停在 serverReport-analysis 且表格显示“加载中…”，表头「平均响应时长」永远不出现，
// 旧逻辑只会干等到 180 秒超时 → 整店失败。
// 新逻辑：报表未就绪时回到千牛入口重走一遍服务体验分析，最多 2 次（有界，防死循环）。
const assert = require("assert");
const {
  带重试地打开平均响应时间报表
} = require("../src/platforms/tmall/responseTimeReportParts/tmallResponseTimeReportFlow");

// 记录调用顺序的壳
function 造壳(打开结果序列) {
  const 调用 = [];
  let 序号 = 0;
  return {
    调用,
    reset() { 序号 = 0; },
    依赖() {
      return {
        打开一次: async () => {
          调用.push(`打开#${序号 + 1}`);
          const 结果 = 打开结果序列[序号] || "成功";
          序号 += 1;
          if (结果 !== "成功") throw new Error(结果);
        },
        回到入口: async () => { 调用.push("回到入口"); },
        最大尝试次数: 2,
      };
    },
  };
}

async function 主流程() {
  // ① 第一次未就绪、回到入口后第二次成功：不抛错，且只回退一次
  {
    const 壳 = 造壳(["等待平均响应时间报表就绪超时", "成功"]);
    await 带重试地打开平均响应时间报表(壳.依赖());
    assert.deepStrictEqual(壳.调用, ["打开#1", "回到入口", "打开#2"]);
  }

  // ② 两次都未就绪：抛最后一次错误，且回退次数被限制为 1（不会无限重试）
  {
    const 壳 = 造壳(["超时A", "超时B"]);
    let 抛出 = null;
    try {
      await 带重试地打开平均响应时间报表(壳.依赖());
    } catch (错误) {
      抛出 = 错误;
    }
    assert.ok(抛出, "两次都失败时必须抛错，不能静默通过");
    assert.strictEqual(抛出.message, "超时B", "抛出的是最后一次错误");
    assert.deepStrictEqual(壳.调用, ["打开#1", "回到入口", "打开#2"], "总尝试次数=2，回退次数=1");
  }

  // ③ 第一次就成功：不触发任何回退
  {
    const 壳 = 造壳(["成功"]);
    await 带重试地打开平均响应时间报表(壳.依赖());
    assert.deepStrictEqual(壳.调用, ["打开#1"]);
  }

  // ④ 自定义尝试次数只允许有限值（传 0/负数回落默认 2，不会变成无限循环）
  {
    const 壳 = 造壳(["超时A", "超时B"]);
    let 抛出 = null;
    try {
      await 带重试地打开平均响应时间报表({ ...壳.依赖(), 最大尝试次数: 0 });
    } catch (错误) {
      抛出 = 错误;
    }
    assert.ok(抛出, "尝试次数非法时仍要抛错，不能无限重试");
    assert.deepStrictEqual(壳.调用, ["打开#1", "回到入口", "打开#2"]);
  }

  console.log("  ✓ 天猫报表加载重试：首次失败→回退重进→成功");
  console.log("  ✓ 天猫报表加载重试：两次失败→抛最后一次错误且回退有界");
  console.log("  ✓ 天猫报表加载重试：首次成功→不回退");
  console.log("  ✓ 天猫报表加载重试：非法尝试次数→回落默认值，不会死循环");
}

主流程().catch((错误) => {
  console.error("  ✗ 天猫报表加载重试回归失败：" + (错误 && 错误.message ? 错误.message : 错误));
  process.exitCode = 1;
});
