// 只读探针：直调控制台真源算「客户菜单」里的新鲜度百分比（不开 TUI）
const svc = require("../src/controlCenter/controlCenterDashboardService");
const { buildCustomerMirrorItems } = require("../src/controlCenter/customerMirrorListBuilder");
const { readMissedReplyMonitorState } = require("../src/features/missedReplyMonitor/missedReplyStateStore");

function sample() {
  const state = readMissedReplyMonitorState();
  const items = buildCustomerMirrorItems(state);
  const fresh = svc.buildDataFreshness(items, Date.now());
  const ratio =
    fresh.ageSeconds === null
      ? null
      : Math.max(0, Math.min(1, 1 - fresh.ageSeconds / svc.DATA_FRESHNESS_STALE_THRESHOLD_SECONDS));
  return {
    客户数: items.length,
    ageSeconds: fresh.ageSeconds,
    新鲜度百分比: ratio === null ? null : Math.round(ratio * 100),
    stale: fresh.stale,
    最后扫描: fresh.lastScannedAtMs
      ? new Date(fresh.lastScannedAtMs).toLocaleString("zh-CN", { hour12: false })
      : "-",
  };
}

const 次数 = Number(process.argv[2] || 1);
const 间隔秒 = Number(process.argv[3] || 5);
(async () => {
  for (let i = 0; i < 次数; i += 1) {
    const r = sample();
    console.log(
      `  [${i + 1}] ${new Date().toLocaleTimeString("zh-CN", { hour12: false })} 客户=${r.客户数} 年龄=${r.ageSeconds}秒 新鲜度=${r.新鲜度百分比}% stale=${r.stale} 最后扫描=${r.最后扫描}`
    );
    if (i < 次数 - 1) await new Promise((resolve) => setTimeout(resolve, 间隔秒 * 1000));
  }
})();
