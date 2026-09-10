// 企业微信反馈工具：只负责配置、客服映射、@计划、预览和受保护的发送能力。
// 聊天内容的分析、评价和反馈文案必须由 AI/人工决定，本模块不读取消息做判断。
const fs = require('fs');
const {
  appendFeedbackReport,
  normalizeFeedbackReportInput
} = require('./reportStore');

const SEND_CONFIRMATION_CODE = '161323';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 2;

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function joinFeedbackLines(lines) {
  if (!Array.isArray(lines)) {
    throw new Error('反馈分行内容必须是数组。');
  }
  return lines.map((line) => String(line == null ? '' : line).trim()).join('\n').trim();
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return !['false', '0', 'no', '否'].includes(String(value).trim().toLowerCase());
}

function readJsonFile(filePath, displayName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`未找到${displayName}：${filePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${displayName}不是合法 JSON：${error.message}`);
  }
}

function normalizeMemberDirectory(input) {
  const result = [];
  for (const [index, raw] of (Array.isArray(input) ? input : []).entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }

    const name = normalizeText(raw.name || raw.staffName);
    const mobile = normalizeText(raw.mobile || raw.phone || raw.memberMobile);
    const userId = normalizeText(raw.userId || raw.userid || raw.user_id || raw.memberUserId);
    if (!name) {
      continue;
    }

    result.push({
      id: normalizeText(raw.id) || `staff_${index + 1}`,
      name,
      mobile,
      userId,
      role: normalizeText(raw.role),
      inlineMentionEnabled: normalizeBoolean(
        raw.inlineMentionEnabled ?? raw.inline_mention_enabled,
        true
      )
    });
  }
  return result;
}

function normalizeNicknameMappings(input) {
  const result = [];
  const seen = new Map();
  for (const raw of (Array.isArray(input) ? input : [])) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }

    const aliases = [
      raw.nickname,
      ...(Array.isArray(raw.nicknames) ? raw.nicknames : []),
      ...(Array.isArray(raw.aliases) ? raw.aliases : [])
    ].map(normalizeText).filter(Boolean);
    const staffName = normalizeText(raw.staffName || raw.name || raw.summaryName);
    const role = normalizeText(raw.role);
    if (!staffName || aliases.length === 0) {
      continue;
    }

    for (const nickname of Array.from(new Set(aliases))) {
      const existing = seen.get(nickname);
      if (existing && existing !== staffName) {
        throw new Error(`客服昵称「${nickname}」同时映射到「${existing}」和「${staffName}」，拒绝猜测。`);
      }
      seen.set(nickname, staffName);
      result.push({ nickname, staffName, role });
    }
  }
  return result;
}

function normalizeStaffRole(value) {
  const role = normalizeText(value);
  if (role.includes('售前')) return '售前';
  if (role.includes('售后')) return '售后';
  if (role.includes('运营')) return '运营';
  if (role.includes('管理') || role.includes('经理')) return '管理';
  return role;
}

function normalizeWecomFeedbackConfig(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawMemberDirectory = normalizeMemberDirectory(
    source.memberDirectory || source.member_directory || source.staffDirectory || source.staff_directory
  );
  const nicknameMappings = normalizeNicknameMappings(
    source.nicknameMappings || source.nickname_mappings || source.personMappings || source.person_mappings
  );
  const roleByStaffName = new Map();
  for (const mapping of nicknameMappings) {
    const role = normalizeStaffRole(mapping.role);
    if (!role) continue;
    const existingRole = roleByStaffName.get(mapping.staffName);
    if (existingRole && existingRole !== role) {
      throw new Error(`客服「${mapping.staffName}」同时存在岗位「${existingRole}」和「${role}」，拒绝猜测。`);
    }
    roleByStaffName.set(mapping.staffName, role);
  }
  const memberDirectory = rawMemberDirectory.map((member) => ({
    ...member,
    role: normalizeStaffRole(member.role) || roleByStaffName.get(member.name) || ''
  }));
  return {
    webhookUrl: normalizeText(source.webhookUrl || source.webhook_url),
    memberDirectory,
    nicknameMappings
  };
}

function loadWecomFeedbackConfig(ws) {
  const file = ws.wecomConfigFile();
  return normalizeWecomFeedbackConfig(readJsonFile(file, '企业微信反馈配置文件'));
}

function extractWaiterLabel(sourceNote) {
  const text = normalizeText(sourceNote);
  if (!text) {
    return '';
  }

  const waiterMatch = text.match(/waiter\s*=\s*([^）)\n]+)/i);
  const rawWaiter = normalizeText(waiterMatch ? waiterMatch[1] : text);
  const parts = rawWaiter.split(/--+|——+|—+|–+|-/).map(normalizeText).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : rawWaiter;
}

function normalizeRoleFilter(value, fallback = '售前') {
  const role = normalizeText(value) || fallback;
  if (['all', '全部', '*'].includes(role.toLowerCase())) {
    return '';
  }
  const aliases = {
    pre_sales: '售前',
    'pre-sales': '售前',
    after_sales: '售后',
    'after-sales': '售后'
  };
  const normalizedRole = aliases[role.toLowerCase()] || role;
  if (!['售前', '售后', '运营', '管理'].includes(normalizedRole)) {
    throw new Error(`岗位筛选只支持：售前、售后、运营、管理或 all；当前为「${role}」。`);
  }
  return normalizedRole;
}

function findMember(memberDirectory, staffName) {
  const normalizedStaffName = normalizeText(staffName);
  return (Array.isArray(memberDirectory) ? memberDirectory : [])
    .find((member) => normalizeText(member?.name) === normalizedStaffName) || null;
}

function resolveFeedbackTarget(input = {}, config) {
  const sourceNote = normalizeText(input.sourceNote || input.chat?.meta?.sourceNote);
  const explicitStaffName = normalizeText(input.staffName);
  const explicitNickname = normalizeText(input.nickname);
  const sourceNickname = explicitNickname || extractWaiterLabel(sourceNote);
  const mapping = (config.nicknameMappings || []).find(
    (item) => item.nickname === sourceNickname
  );
  const staffName = explicitStaffName || mapping?.staffName || sourceNickname;
  const member = findMember(config.memberDirectory, staffName);

  return {
    matched: Boolean(member),
    matchedBy: explicitStaffName ? 'staffName' : mapping ? 'nicknameMapping' : member ? 'memberName' : '',
    sourceNote,
    nickname: sourceNickname,
    staffName,
    role: normalizeText(mapping?.role || member?.role),
    member,
    reason: member ? '' : `未找到客服「${staffName || sourceNickname || '（空）'}」的企微成员映射。`
  };
}

function resolveWaiterTarget(waiter, config) {
  const nickname = extractWaiterLabel(waiter);
  return resolveFeedbackTarget({ nickname }, config);
}

function buildMentionPlan(target) {
  const member = target?.member;
  if (!member) {
    return {
      mode: 'none',
      staffName: normalizeText(target?.staffName),
      nickname: normalizeText(target?.nickname),
      inlineToken: '',
      mentionedMobileList: []
    };
  }

  const staffName = normalizeText(member.name);
  const nickname = normalizeText(target.nickname);
  const inlineEnabled = member.inlineMentionEnabled !== false;
  if (member.userId && inlineEnabled) {
    return {
      mode: 'inline-userid',
      staffName,
      nickname,
      inlineToken: `<@${member.userId}>`,
      mentionedMobileList: []
    };
  }

  if (member.mobile) {
    return {
      mode: 'bottom-mobile',
      staffName,
      nickname,
      inlineToken: '',
      mentionedMobileList: [member.mobile]
    };
  }

  return {
    mode: 'none',
    staffName,
    nickname,
    inlineToken: '',
    mentionedMobileList: []
  };
}

function buildTextPayload({ content, target, mentionPlan }) {
  // 文案是用户与 AI/人工确认的业务内容，只去掉首尾空白，不改写中间换行。
  const normalizedContent = String(content == null ? '' : content).trim();
  if (!normalizedContent) {
    throw new Error('反馈文案不能为空；文案必须先由用户与 AI/人工确认。');
  }
  if (!target?.matched) {
    throw new Error(target?.reason || '未找到客服映射，拒绝发送未精确@的反馈。');
  }
  if (!mentionPlan || mentionPlan.mode === 'none') {
    throw new Error(`客服「${target.staffName}」缺少企微 userid 或手机号，拒绝发送未精确@的反馈。`);
  }

  if (
    mentionPlan.mode === 'bottom-mobile' &&
    [target.staffName, target.nickname]
      .map(normalizeText)
      .filter(Boolean)
      .some((name) => normalizedContent.includes(`@${name}`))
  ) {
    throw new Error('当前使用底部手机号@，正文不要再写客服@，否则群里会出现重复艾特。');
  }

  const payloadContent = mentionPlan.inlineToken
    ? `${mentionPlan.inlineToken}\n${normalizedContent}`
    : normalizedContent;
  return {
    msgtype: 'text',
    text: {
      content: payloadContent,
      mentioned_mobile_list: mentionPlan.mentionedMobileList
    }
  };
}

function buildFeedbackPreview(input = {}) {
  const config = input.config || {};
  const target = input.target || resolveFeedbackTarget(input, config);
  const mentionPlan = input.mentionPlan || buildMentionPlan(target);
  const content = Array.isArray(input.contentLines)
    ? joinFeedbackLines(input.contentLines)
    : input.content;
  const payload = buildTextPayload({
    content,
    target,
    mentionPlan
  });

  return {
    customer: normalizeText(input.chat?.meta?.customer),
    sourceNote: target.sourceNote,
    target: {
      nickname: target.nickname,
      staffName: target.staffName,
      role: target.role,
      matchedBy: target.matchedBy
    },
    mention: {
      mode: mentionPlan.mode,
      staffName: mentionPlan.staffName,
      nickname: mentionPlan.nickname,
      userIdConfigured: mentionPlan.mode === 'inline-userid',
      mobileConfigured: mentionPlan.mode === 'bottom-mobile'
    },
    payload
  };
}

async function postWecomTextPayload({ webhookUrl, payload, attempt, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前 Node 环境没有可用的 fetch，无法发送企业微信消息。');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? `请求超时(${REQUEST_TIMEOUT_MS / 1000}秒)`
      : (error instanceof Error ? error.message : String(error));
    throw new Error(`企业微信机器人发送失败(第${attempt}次)：${reason}`);
  } finally {
    clearTimeout(timer);
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(`企业微信机器人发送失败(第${attempt}次)：响应不是合法 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok || result.errcode !== 0) {
    throw new Error(`企业微信机器人发送失败(第${attempt}次)：HTTP ${response.status}，errcode=${result.errcode}，errmsg=${result.errmsg}`);
  }
  return result;
}

async function sendWecomTextMessage({
  config,
  payload,
  confirmationCode,
  reportWorkspace,
  report,
  fetchImpl = globalThis.fetch
}) {
  if (String(confirmationCode || '') !== SEND_CONFIRMATION_CODE) {
    throw new Error('发送企业微信反馈前必须先完成内容沟通，并提供本次明确确认口令。');
  }
  if (!reportWorkspace) {
    throw new Error('发送企业微信反馈前必须提供工作区，用于形成工作量报告记录。');
  }
  const reportInput = normalizeFeedbackReportInput({
    ...report,
    sentPayloadContent: report?.sentPayloadContent || payload?.text?.content
  });
  const webhookUrl = normalizeText(config?.webhookUrl);
  if (!webhookUrl) {
    throw new Error('企业微信反馈配置缺少 webhook 地址。');
  }

  let lastError = null;
  let result = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      result = await postWecomTextPayload({ webhookUrl, payload, attempt, fetchImpl });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!result) {
    throw lastError || new Error('企业微信机器人发送失败：未知原因。');
  }

  let reportResult;
  try {
    reportResult = appendFeedbackReport(reportWorkspace, reportInput, result);
  } catch (error) {
    throw new Error(`企业微信消息已成功发送，但工作报告记录失败，请勿重发：${error.message}`);
  }
  return { ...result, reportFile: reportResult.file, reportId: reportResult.recordId };
}

module.exports = {
  SEND_CONFIRMATION_CODE,
  buildFeedbackPreview,
  buildMentionPlan,
  buildTextPayload,
  extractWaiterLabel,
  joinFeedbackLines,
  loadWecomFeedbackConfig,
  normalizeRoleFilter,
  normalizeWecomFeedbackConfig,
  resolveFeedbackTarget,
  resolveWaiterTarget,
  sendWecomTextMessage
};
