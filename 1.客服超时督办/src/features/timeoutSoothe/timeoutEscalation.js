const { log } = require("../../engine/logger");

function resolveEscalationMentionPlan(assignee, config) {
  // 这里统一把超时提醒改成底部手机号艾特，正文不再依赖 userid 行内 @。
  const staffName = String(assignee?.staffName || "").trim();
  const staffGroup = String(assignee?.staffGroup || "").trim();
  const mentionedMobileList = [];
  const staffMobile = String(config.memberMobileMap?.[staffName] || "").trim();
  const operationMobile = String(config.memberMobileMap?.["运营"] || "").trim();
  const managerMobile = String(config.memberMobileMap["黎路遥"] || "").trim();
  if (!managerMobile) {
    throw new Error("企微机器人配置缺失：黎路遥手机号未填写，无法执行升级提醒。");
  }
  mentionedMobileList.push(managerMobile);

  if (staffName && staffMobile) {
    mentionedMobileList.unshift(staffMobile);
    log("主线:执行", "超时提醒", "底部@", `客服=${staffName}，正文已去掉接待客服，改为底部手机号艾特`);
  } else if (!staffName && staffGroup === "operation" && operationMobile) {
    // 这里把“运营接待”映射回配置里的固定成员名「运营」，避免明明已配置手机号却被旧规则硬拦掉。
    mentionedMobileList.unshift(operationMobile);
    log("主线:执行", "超时提醒", "底部@", "当前会话由运营接待，已命中成员「运营」手机号，补发底部手机号艾特");
  } else if (staffName) {
    log("主线:执行", "超时提醒", "缺少@映射", `客服=${staffName}，当前未配置企微手机号，本轮只能提醒主管`);
  }

  if (!staffName && staffGroup === "operation") {
    if (!operationMobile) {
      log("主线:执行", "超时提醒", "缺少@映射", "当前会话由运营接待，但成员「运营」未配置手机号，本轮只能提醒主管");
    }
    log("主线:执行", "超时提醒", "运营接待升级", `当前会话由运营接待，本轮${operationMobile ? "已追加@运营并同步提醒主管" : "只@黎路遥"}`);
  }

  return {
    inlineMentionTokenMap: {},
    mentionedMobileList: Array.from(new Set(mentionedMobileList)),
    mobileConfigured: Boolean((staffName && staffMobile) || (!staffName && staffGroup === "operation" && operationMobile)),
    managerIncluded: true
  };
}

function resolveEscalationTargets(assignee, config) {
  // 这里优先使用后台维护的通知群列表；如果还是旧配置，再兼容售前/售后双群路由。
  const configuredTargets = resolveConfiguredEscalationTargets(config);
  if (Array.isArray(config.notificationGroups) && config.notificationGroups.length > 0) {
    return deduplicateEscalationTargets(configuredTargets);
  }

  return deduplicateEscalationTargets(resolveLegacyEscalationTargets(assignee, config));
}

function resolveConfiguredEscalationTargets(config) {
  // 这里把控制台里启用中的通知群全部收口成发送目标，填几个启用群就通知几个。
  return (Array.isArray(config.notificationGroups) ? config.notificationGroups : [])
    .filter((group) => group && group.enabled)
    .map((group) => ({
      webhookName: String(group.name || "未命名通知群").trim() || "未命名通知群",
      webhookUrl: String(group.webhookUrl || "").trim()
    }));
}

function resolveLegacyEscalationTargets(assignee, config) {
  // 这里兼容旧版售前/售后双字段，避免新配置上线前的老文件直接失效。
  const routingGroup = assignee.routingGroup || assignee.staffGroup;
  const targets = [];
  if (routingGroup === "after_sales") {
    targets.push({ webhookName: "售后群", webhookUrl: config.afterSalesWebhookUrl });
  } else if (routingGroup === "pre_sales") {
    targets.push({ webhookName: "售前群", webhookUrl: config.preSalesWebhookUrl });
  } else if (routingGroup === "management") {
    targets.push({ webhookName: "售前群", webhookUrl: config.preSalesWebhookUrl });
    targets.push({ webhookName: "售后群", webhookUrl: config.afterSalesWebhookUrl });
  } else {
    throw new Error(`当前接待客服分组无法升级：${routingGroup || assignee.staffGroup || "未识别"}`);
  }

  return targets;
}

function deduplicateEscalationTargets(targets) {
  // 这里按 webhook 地址去重，统一群场景只发一次，但保留后续拆回双群的配置能力。
  const mergedTargetMap = new Map();

  for (const target of targets) {
    const webhookUrl = String(target?.webhookUrl || "").trim();
    const webhookName = String(target?.webhookName || "").trim() || "未命名群";
    const mapKey = webhookUrl || `__missing__${webhookName}`;
    const existingTarget = mergedTargetMap.get(mapKey);
    if (!existingTarget) {
      mergedTargetMap.set(mapKey, {
        webhookName,
        webhookUrl,
        webhookNames: [webhookName]
      });
      continue;
    }

    if (!existingTarget.webhookNames.includes(webhookName)) {
      existingTarget.webhookNames.push(webhookName);
      existingTarget.webhookName = `${existingTarget.webhookNames.join(" / ")}（同群）`;
    }
  }

  return Array.from(mergedTargetMap.values()).map((target) => ({
    webhookName: target.webhookName,
    webhookUrl: target.webhookUrl
  }));
}

module.exports = {
  resolveEscalationMentionPlan,
  resolveEscalationTargets
};
