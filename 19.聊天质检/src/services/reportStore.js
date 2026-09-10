// 工作报告存储：只记录已由用户确认且成功发送的反馈，不参与聊天内容分析。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function localDateTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  ].join(' ');
}

function dateKey(value) {
  const text = normalizeText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (text) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      const pad = (part) => String(part).padStart(2, '0');
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
    }
  }
  return localDateTime().slice(0, 10);
}

function normalizeFeedbackReportInput(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const record = {
    workDate: dateKey(source.workDate || source.date),
    store: normalizeText(source.store),
    customerId: normalizeText(source.customerId || source.customer),
    sourceChatFile: normalizeText(source.sourceChatFile || source.chatFile),
    nickname: normalizeText(source.nickname),
    staffName: normalizeText(source.staffName),
    role: normalizeText(source.role),
    mentionMode: normalizeText(source.mentionMode),
    status: normalizeText(source.status) || '已发送',
    note: normalizeText(source.note),
    approvedContent: String(source.approvedContent ?? source.content ?? '').trim(),
    sentPayloadContent: String(source.sentPayloadContent ?? source.approvedContent ?? source.content ?? '').trim()
  };

  const missing = [];
  if (!record.store) missing.push('店铺');
  if (!record.customerId) missing.push('客户ID');
  if (!record.staffName) missing.push('客服姓名');
  if (!record.approvedContent) missing.push('用户确认的反馈正文');
  if (missing.length > 0) {
    throw new Error(`工作报告缺少：${missing.join('、')}。发送前必须补齐，避免工作量无法核对。`);
  }
  return record;
}

function reportFileFor(ws, workDate) {
  if (!ws?.dirs?.reports) {
    throw new Error('工作区没有配置 runtime/reports 目录。');
  }
  const normalizedDate = dateKey(workDate);
  return {
    workDate: normalizedDate,
    file: path.join(ws.dirs.reports, `${normalizedDate}.md`)
  };
}

function recordId(record) {
  const source = [
    record.workDate,
    record.store,
    record.customerId,
    record.nickname,
    record.staffName,
    record.status,
    record.note,
    record.approvedContent,
    record.sentPayloadContent
  ].join('\u001f');
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 16);
}

function fenceFor(text) {
  return String(text || '').includes('```') ? '````' : '```';
}

function renderReportEntry(record, result = {}) {
  const fence = fenceFor(record.approvedContent);
  const lines = [
    `<!-- record-id: ${record.id} -->`,
    `## ${record.sentAt.slice(0, 16)}｜${record.store}｜客户ID：${record.customerId}`,
    '',
    `- 状态：${record.status}`,
    `- 客服：${record.staffName}${record.nickname ? `（后台昵称：${record.nickname}）` : ''}`,
    `- 岗位：${record.role || '未填写'}`,
    `- @方式：${record.mentionMode || '未填写'}`,
    `- 来源记录：${record.sourceChatFile || '未填写'}`,
    `- 发送时间：${record.sentAt}`,
    `- 记录时间：${record.recordedAt}`,
    `- 企微结果：errcode=${result.errcode == null ? '0' : result.errcode}`,
    '',
    '### 用户确认并实际发送的反馈正文',
    `${fence}text`,
    record.approvedContent,
    fence,
    ''
  ];
  if (record.note) {
    lines.splice(9, 0, `- 备注：${record.note}`);
  }
  if (record.sentPayloadContent && record.sentPayloadContent !== record.approvedContent) {
    lines.push(
      '### 实际发送载荷（仅用于核对行内@）',
      `${fence}text`,
      record.sentPayloadContent,
      fence,
      ''
    );
  }
  return lines.join('\n');
}

function appendFeedbackReport(ws, input, sendResult = {}) {
  const normalized = normalizeFeedbackReportInput(input);
  const report = reportFileFor(ws, normalized.workDate);
  const record = {
    ...normalized,
    id: recordId(normalized),
    sentAt: normalizeText(input?.sentAt) || localDateTime(),
    recordedAt: localDateTime()
  };

  fs.mkdirSync(ws.dirs.reports, { recursive: true });
  let existing = '';
  if (fs.existsSync(report.file)) {
    existing = fs.readFileSync(report.file, 'utf8');
    if (existing.includes(`<!-- record-id: ${record.id} -->`)) {
      return { file: report.file, workDate: report.workDate, recordId: record.id, duplicate: true };
    }
  }

  const header = existing
    ? ''
    : `# ${report.workDate} 客服聊天质检工作报告\n\n> 本文件只记录已由用户确认并成功发送到企业微信群的反馈，用于核对实际工作量；正文不由程序改写。\n\n`;
  const separator = existing && !existing.endsWith('\n\n') ? '\n' : '';
  fs.appendFileSync(report.file, `${header}${separator}${renderReportEntry(record, sendResult)}`, 'utf8');
  return { file: report.file, workDate: report.workDate, recordId: record.id, duplicate: false };
}

function readFeedbackReport(ws, workDate) {
  const report = reportFileFor(ws, workDate);
  if (!fs.existsSync(report.file)) return '';
  return fs.readFileSync(report.file, 'utf8');
}

module.exports = {
  appendFeedbackReport,
  dateKey,
  localDateTime,
  normalizeFeedbackReportInput,
  readFeedbackReport,
  reportFileFor
};
