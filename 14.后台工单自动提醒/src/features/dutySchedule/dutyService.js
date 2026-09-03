// 本文件是值班业务真源：拉金山排班（带缓存）→ 解析当日售后班次/底色 → 按天选出应@的人。
// @规则（用户2026-09-03定）：组长李守耀当日在班就@组长；其他售后看背景标记色，有标记=值班；主管永远@。
// 界面与提醒链路都调 resolveDuty()/buildMentionPlan()，这里只出一份结论。
const { log } = require("../../engine/logger");
const { fetchScheduleMonth } = require("./scheduleFetcher");
const { buildTodayDuty, selectAtStaff, describeColor } = require("./dutyParser");

const cache = new Map(); // dateKey → staff[]（当日班次+底色快照）

function dateKeyOf(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// resolveDuty(config, now) → { ok, todayStaff, atStaff:[{name,reason,colorName}], error }
async function resolveDuty(config, now = new Date()) {
  const duty = (config && config.duty) || {};
  if (!duty.scheduleUrl) {
    return { ok: false, todayStaff: [], atStaff: [], error: "未配置 duty.scheduleUrl" };
  }
  const key = dateKeyOf(now);
  try {
    if (!cache.has(key)) {
      const raw = await fetchScheduleMonth(duty.scheduleUrl, now);
      const parsed = buildTodayDuty(raw.matrix, now, raw.colorGrid, duty.group || "售后");
      cache.set(key, parsed.staff);
      log("值班", "排班", "已拉取", `${key} ${parsed.staff.length} 人`);
    }
    const staff = cache.get(key).map((item) => ({
      ...item,
      colorName: describeColor(item.colorRgb, duty.colorNames || {})
    }));
    const atStaff = selectAtStaff(staff, {
      leadNames: duty.leadNames || [],
      nonMarkerColors: duty.nonMarkerColors || ["#FFFFFF"]
    });
    return { ok: true, todayStaff: staff, atStaff };
  } catch (error) {
    log("值班", "排班", "读取失败", error.message);
    return { ok: false, todayStaff: [], atStaff: [], error: error.message };
  }
}

// 组装 @ 名单与文案行：群里只有一行「本次@：姓名（原因）」（最少必要）；完整值班/底色表在 CLI duty 命令看。
// 排班读取失败降级：只 @ 主管，同一行里注明原因。
function buildMentionPlan(config, dutyResult) {
  const duty = (config && config.duty) || {};
  const memberMobileMap = (config.wecom && config.wecom.memberMobileMap) || {};
  const managerNames = duty.managerNames || [];

  let atNames = [];
  let onDutyLine = "";
  if (dutyResult.ok) {
    atNames = dutyResult.atStaff.map((item) => item.name);
    onDutyLine = `本次@：${atNames.length > 0
      ? dutyResult.atStaff.map((item) => `${item.name}（${item.reason}）`).join("、")
      : "无值班售后（只@主管）"}`;
  } else {
    onDutyLine = `本次@：（排班读取失败：${dutyResult.error}，只@主管）`;
  }
  for (const manager of managerNames) {
    if (!atNames.includes(manager)) atNames.push(manager);
  }
  const mobiles = Array.from(
    new Set(atNames.map((name) => String(memberMobileMap[name] || "").trim()).filter(Boolean))
  );
  const missing = atNames.filter((name) => !String(memberMobileMap[name] || "").trim());
  if (missing.length > 0) {
    log("值班", "@", "缺手机号", missing.join("、"));
  }
  return { atNames, mobiles, onDutyLine };
}

module.exports = { resolveDuty, buildMentionPlan };
