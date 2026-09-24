#!/usr/bin/env node
/**
 * 通过 AirScript 共享脚本，把「售前值班底色」（浅绿 #E2F0D9）写进金山在线排班表
 * （只写目标月表售前 5 人的指定值班格；不写班次值、不碰其他行/其他月表）。
 *
 * 前置（一次性）：
 *   在线文档「自动排班脚本」已替换为 工具/AirScript-写售前排班.txt 的最新版（版本号见下）；
 *   webhook/脚本令牌已填进 project-config/platform-config.json（该文件 gitignored，不打印、不入库）。
 *
 * 用法（Windows PowerShell / bash 均可）：
 *   node 工具/写在线值班底色.cjs --plan 测试数据/2026年10月-计划.json --sheet 2026年10月 --dry-run
 *   node 工具/写在线值班底色.cjs --plan ... --sheet ... --diagnose   # 只读诊断（看 duty 格当前颜色/班次）
 *   node 工具/写在线值班底色.cjs --plan ... --sheet ...              # 真正写入（需用户批准）
 *   node 工具/写在线值班底色.cjs --plan ... --sheet ... --webhook <url> --token <token>  # 临时覆盖配置
 *
 * 计划 JSON 的 duty 格式：{"韩欢欢|1": "早", "刘秀文|1": "晚", ...}（每天早、晚各 1 人）
 * 在线脚本写前逐格核对「当前班次 = 值班班次」，不符则一格都不写；写后回读 + Save。
 * 失败不自动重试（失败处置总方针）。
 */

const fs = require('fs');
const path = require('path');

const EXPECTED_SCRIPT_VERSION = '2026-09-24.1';
const OP_WRITE = 'write_seller_duty_colors';
const OP_DIAGNOSE = 'diagnose_colors';
const EXPECTED_SELLER_NAMES = ['韩欢欢', '麦诺谦', '叶炳辉', '徐佳楠', '刘秀文'];
const MIN_DAY_COUNT = 28;
const MAX_DAY_COUNT = 31;
const DUTY_COLOR_HEX = '#E2F0D9';
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', 'project-config', 'platform-config.json');
const REQUEST_TIMEOUT_MS = 120000;

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
    out[key.slice(2)] = value;
  }
  return out;
}

function fail(message) {
  console.error('写入失败：' + message);
  process.exit(1);
}

function sanitize(text) {
  return String(text || '')
    .replace(/https:\/\/(?:www\.)?kdocs\.cn\/l\/[^/\s"']+\/?/gi, '[已隐藏的在线文档地址]')
    .replace(/https:\/\/(?:www\.)?kdocs\.cn\/api\/v3\/ide\/file\/[^/\s"']+\/script\/[^/\s"']+\/sync_task\/?/gi, '[已隐藏的金山接口地址]')
    .replace(/((?:AirScript-Token|apiToken|token)\s*[=:]\s*["']?)[^\s,"';}]+/gi, '$1[已隐藏]')
    .slice(0, 500);
}

function cellText(value) {
  return value === null || value === undefined ? '' : String(value);
}

function checksumOf(text) {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0
  }
  return ('00000000' + hash.toString(16)).slice(-8)
}

function loadPlan(planPath) {
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  } catch (error) {
    throw new Error('读不了计划 JSON：' + sanitize(error && error.message));
  }
  const dayCount = Number(plan && plan.meta && plan.meta.days);
  if (dayCount !== Math.floor(dayCount) || dayCount < MIN_DAY_COUNT || dayCount > MAX_DAY_COUNT) {
    throw new Error('计划 meta.days 必须是 ' + MIN_DAY_COUNT + '~' + MAX_DAY_COUNT + ' 的整数：' + cellText(plan && plan.meta && plan.meta.days));
  }
  const duty = plan && plan.duty;
  if (!duty || typeof duty !== 'object' || Array.isArray(duty)) {
    throw new Error('计划 JSON 里没有 duty 对象（售前值班）。');
  }
  const duties = [];
  const seen = {};
  const perDay = {};
  const names = Object.keys(duty);
  for (let index = 0; index < names.length; index += 1) {
    const key = names[index];
    const parts = String(key).split('|');
    if (parts.length !== 2) throw new Error('duty 键格式应为「姓名|日」：' + key);
    const name = parts[0].trim();
    const day = Number(parts[1]);
    const shift = cellText(duty[key]).trim();
    if (EXPECTED_SELLER_NAMES.indexOf(name) < 0) throw new Error('duty 里有非售前姓名：' + name);
    if (day !== Math.floor(day) || day < 1 || day > dayCount) throw new Error(key + ' 的日不合法：' + parts[1]);
    if (shift !== '早' && shift !== '晚') throw new Error(key + ' 的值只能是 早/晚：' + shift);
    const dupKey = name + '|' + day;
    if (seen[dupKey]) throw new Error('同一人同一天重复：' + dupKey);
    seen[dupKey] = true;
    if (!perDay[day]) perDay[day] = { early: 0, late: 0 };
    if (shift === '早') perDay[day].early += 1;
    else perDay[day].late += 1;
    duties.push({ name: name, day: day, shift: shift });
  }
  if (duties.length !== dayCount * 2) {
    throw new Error('duty 数量应为 ' + (dayCount * 2) + '（每天早 1 + 晚 1），实际 ' + duties.length);
  }
  for (let day = 1; day <= dayCount; day += 1) {
    const p = perDay[day];
    if (!p || p.early !== 1 || p.late !== 1) {
      throw new Error('d' + day + ' 值班不是「早 1 + 晚 1」：早 ' + (p ? p.early : 0) + ' / 晚 ' + (p ? p.late : 0));
    }
  }
  // 固定顺序（与在线脚本一致）：天 → 早/晚 → 姓名
  duties.sort(function (a, b) {
    if (a.day !== b.day) return a.day - b.day;
    if (a.shift !== b.shift) return a.shift === '早' ? -1 : 1;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });
  return { dayCount: dayCount, duties: duties };
}

function loadSettings(args) {
  const configPath = path.resolve(args.config || DEFAULT_CONFIG_PATH);
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      fileConfig = parsed && parsed.kdocsScheduleSync ? parsed.kdocsScheduleSync : {};
    } catch (error) {
      throw new Error('配置文件解析失败（' + configPath + '）：' + sanitize(error && error.message));
    }
  }
  const webhookUrl = String(args.webhook || fileConfig.webhookUrl || '').trim();
  const apiToken = String(args.token || fileConfig.apiToken || '').trim();
  if (!webhookUrl || !apiToken) {
    throw new Error(
      '缺少 webhook 或脚本令牌。请先在排班表在线文档里更新「文档共享脚本」（粘贴 工具/AirScript-写售前排班.txt 全文），' +
      '再把 webhookUrl / apiToken 填进 ' + configPath + '（或用 --webhook/--token 临时传）。'
    );
  }
  if (!/^https:\/\/(?:www\.)?kdocs\.cn\/api\/v3\/ide\/file\/[^/]+\/script\/[^/]+\/sync_task\/?$/i.test(webhookUrl)) {
    throw new Error('webhook 格式不对：应以 https://www.kdocs.cn/api/v3/ide/file/<file_id>/script/<script_id>/sync_task 结尾。');
  }
  return { configPath: configPath, webhookUrl: webhookUrl, apiToken: apiToken };
}

async function callAirScript(settings, argv) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  let responseText;
  try {
    response = await fetch(settings.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'AirScript-Token': settings.apiToken
      },
      body: JSON.stringify({ Context: { argv: argv } }),
      signal: controller.signal
    });
    responseText = await response.text();
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('金山文档同步等待超过 ' + Math.round(REQUEST_TIMEOUT_MS / 1000) + ' 秒，未自动重试；请先查在线脚本运行日志。');
    }
    throw new Error('连不上金山文档：' + sanitize(error && error.message));
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error('金山文档接口返回 HTTP ' + response.status + '，未自动重试；请检查 webhook 与脚本令牌。');
  }
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (error) {
    throw new Error('金山文档接口没有返回有效 JSON。');
  }
  const remoteError = payload && payload.error;
  if (!payload || payload.status !== 'finished' || remoteError) {
    throw new Error('AirScript 执行失败' + (remoteError ? '：' + sanitize(typeof remoteError === 'string' ? remoteError : JSON.stringify(remoteError)) : '，请看在线脚本运行日志') + '。');
  }
  const result = payload.data && payload.data.result;
  if (!result || typeof result !== 'object') {
    throw new Error('AirScript 没有返回执行结果（确认在线脚本已保存并是最新版本）。');
  }
  return result;
}

function validateResult(result, expected) {
  const problems = [];
  if (String(result.scriptVersion || '') !== EXPECTED_SCRIPT_VERSION) {
    problems.push('在线脚本版本 ' + (result.scriptVersion || '旧版无版本号') + '，要求 ' + EXPECTED_SCRIPT_VERSION + '（请在文档里全选覆盖脚本并 Ctrl+S 保存）');
  }
  if (String(result.operationType || '') !== OP_WRITE) problems.push('operationType 不是 ' + OP_WRITE);
  if (String(result.sheetName || '') !== expected.sheetName) problems.push('sheetName 不是 ' + expected.sheetName);
  if (Number(result.writtenCellCount) !== expected.writtenCellCount) problems.push('writtenCellCount 应为 ' + expected.writtenCellCount + '，实际 ' + result.writtenCellCount);
  if (String(result.dutyColorHex || '').toUpperCase() !== DUTY_COLOR_HEX) problems.push('dutyColorHex 应为 ' + DUTY_COLOR_HEX + '，实际 ' + result.dutyColorHex);
  if (result.readBackMatched !== true) problems.push('在线保存前回读不一致');
  if (result.savedReadBackMatched !== true) problems.push('在线保存后回读不一致');
  if (result.saveCompleted !== true) problems.push('在线工作簿没有保存完成');
  if (String(result.payloadChecksum || '') !== expected.payloadChecksum) problems.push('payloadChecksum 不一致（在线写入的内容与本地计划不一致）');
  if (problems.length > 0) throw new Error('在线返回的验收信息不合格：' + problems.join('；'));
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const planPath = String(args.plan || '').trim();
  if (!planPath) fail('缺少 --plan（计划 JSON，含 duty）。');
  if (!fs.existsSync(planPath)) fail('计划 JSON 不存在：' + planPath);
  const sheetName = String(args.sheet || '').trim();
  if (!/^\d{4}年\d{1,2}月$/.test(sheetName)) fail('缺少或格式不对的 --sheet（形如 2026年10月）。');

  const loaded = loadPlan(planPath);
  const checksumText = sheetName + '|' + loaded.duties.map(function (item) {
    return item.name + '|' + item.day + '|' + item.shift;
  }).join(';');
  const payloadChecksum = checksumOf(checksumText);
  const argv = {
    operationType: OP_WRITE,
    requiredScriptVersion: EXPECTED_SCRIPT_VERSION,
    sheetName: sheetName,
    dayCount: loaded.dayCount,
    duties: loaded.duties
  };
  const expected = {
    sheetName: sheetName,
    writtenCellCount: loaded.duties.length,
    payloadChecksum: payloadChecksum
  };

  const diagnose = String(args.diagnose || '').toLowerCase() === 'true';
  const dryRun = String(args['dry-run'] || '').toLowerCase() === 'true';

  if (diagnose) {
    const settings = loadSettings(args);
    console.log('只读诊断：' + sheetName + '；' + loaded.duties.length + ' 个值班格；调用在线脚本…');
    const result = await callAirScript(settings, {
      operationType: OP_DIAGNOSE,
      requiredScriptVersion: EXPECTED_SCRIPT_VERSION,
      sheetName: sheetName,
      dayCount: loaded.dayCount,
      duties: loaded.duties
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run（未调用在线脚本）',
      operationType: argv.operationType,
      requiredScriptVersion: argv.requiredScriptVersion,
      sheetName: argv.sheetName,
      dayCount: argv.dayCount,
      duties: argv.duties,
      payloadChecksum: payloadChecksum,
      expectedWrittenCellCount: expected.writtenCellCount,
      dutyColorHex: DUTY_COLOR_HEX
    }, null, 2));
    return;
  }

  const settings = loadSettings(args);
  console.log('目标月表：' + sheetName + '；售前值班 ' + loaded.duties.length + ' 格（浅绿 ' + DUTY_COLOR_HEX + '）；调用在线脚本…');
  const result = await callAirScript(settings, argv);
  validateResult(result, expected);
  console.log('写入成功：' + result.writtenCellCount + ' 格；readBackMatched=' + result.readBackMatched +
    '；savedReadBackMatched=' + result.savedReadBackMatched + '；saveCompleted=' + result.saveCompleted +
    '；payloadChecksum=' + result.payloadChecksum);
  console.log('接下来用 20 号只读脚本回读对拍（值 0 变化 / 绿标 = 值班名单 / 其他表不动）。');
}

main().catch(function (error) {
  fail(sanitize(error && error.message ? error.message : error));
});
