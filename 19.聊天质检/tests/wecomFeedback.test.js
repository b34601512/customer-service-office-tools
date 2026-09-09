const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFeedbackPreview,
  extractWaiterLabel,
  joinFeedbackLines,
  normalizeWecomFeedbackConfig,
  resolveFeedbackTarget,
  sendWecomTextMessage
} = require('../src/services/wecomFeedback');

function testConfig() {
  return normalizeWecomFeedbackConfig({
    webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
    memberDirectory: [
      { name: '韩欢欢', mobile: '10001', userId: '', inlineMentionEnabled: true },
      { name: '有userid客服', mobile: '10002', userId: 'userid-1', inlineMentionEnabled: true }
    ],
    nicknameMappings: [
      { nickname: '璇璇', staffName: '韩欢欢', role: '售前' },
      { nickname: '行内昵称', staffName: '有userid客服', role: '售前' }
    ]
  });
}

test('从京东 sourceNote 提取客服昵称', () => {
  assert.equal(extractWaiterLabel('京东会话 sid=x（waiter=德达官方旗舰店--璇璇）'), '璇璇');
  assert.equal(extractWaiterLabel('waiter=璇璇'), '璇璇');
});

test('客服昵称映射到 canonical staff，并用手机号底部@', () => {
  const config = testConfig();
  const target = resolveFeedbackTarget({ sourceNote: 'waiter=德达官方旗舰店--璇璇' }, config);
  const preview = buildFeedbackPreview({
    content: '这是一条已经人工确认过的反馈文案\n第二行保持原样',
    target,
    config
  });
  assert.equal(preview.target.staffName, '韩欢欢');
  assert.equal(preview.target.role, '售前');
  assert.equal(preview.mention.mode, 'bottom-mobile');
  assert.deepEqual(preview.payload.text.mentioned_mobile_list, ['10001']);
  assert.equal(preview.payload.text.content, '这是一条已经人工确认过的反馈文案\n第二行保持原样');
});

test('有 userid 时复刻1号的正文行内@', () => {
  const config = testConfig();
  const target = resolveFeedbackTarget({ nickname: '行内昵称' }, config);
  const preview = buildFeedbackPreview({ content: '反馈正文', target, config });
  assert.equal(preview.mention.mode, 'inline-userid');
  assert.equal(preview.payload.text.content, '<@userid-1>\n反馈正文');
  assert.deepEqual(preview.payload.text.mentioned_mobile_list, []);
});

test('分行文案使用真实换行，不生成字面量\\n', () => {
  const config = testConfig();
  const target = resolveFeedbackTarget({ nickname: '璇璇' }, config);
  const preview = buildFeedbackPreview({
    contentLines: ['第一行', '客户ID：脱敏值', '第三行'],
    target,
    config
  });
  assert.equal(preview.payload.text.content, '第一行\n客户ID：脱敏值\n第三行');
  assert.equal(preview.payload.text.content.includes('\\n'), false);
  assert.equal(joinFeedbackLines([' A ', 'B ']), 'A\nB');
});

test('发送没有确认口令时不会触发网络请求', async () => {
  let called = false;
  await assert.rejects(
    sendWecomTextMessage({
      config: { webhookUrl: 'https://example.test/webhook' },
      payload: { msgtype: 'text', text: { content: 'x', mentioned_mobile_list: [] } },
      confirmationCode: '',
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
      }
    }),
    /明确确认口令/
  );
  assert.equal(called, false);
});
