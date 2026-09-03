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

// 组装 @ 名单与文案行：@ = 当日在班组长 + 有标记色售后 + 主管；底色情况写入 todayLine 供验证。
// 排班读取失败降级：只 @ 主管，并在文案里说明。
function buildMentionPlan(config, dutyResult) {
  const duty = (config && config.duty) || {};
  const memberMobileMap = (config.wecom && config.wecom.memberMobileMap) || {};
  const managerNames = duty.managerNames || [];

  let atNames = [];
  let todayLine = "";
  let onDutyLine = "";
  if (dutyResult.ok) {
    todayLine = `今日${duty.group || "售后"}值班：${dutyResult.todayStaff
      .map((item) => `${item.name}（${item.shift}${item.colorName ? `·${item.colorName}底` : "·无底色"}）`)
      .join("、")}`;
    atNames = dutyResult.atStaff.map((item) => item.name);
    onDutyLine = `本次@：${dutyResult.atStaff.length > 0
      ? dutyResult.atStaff.map((item) => `${item.name}（${item.reason}）`).join("、")
      : "无值班售后（只@主管）"}`;
  } else {
    todayLine = `（排班读取失败，未能识别在班客服：${dutyResult.error}）`;
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
  return { atNames, mobiles, todayLine, onDutyLine };
}

module.exports = { resolveDuty, buildMentionPlan };
