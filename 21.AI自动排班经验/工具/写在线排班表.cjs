#!/usr/bin/env node
/**
 * 通过 AirScript 共享脚本，把「售前排班」写进金山在线排班表（只写目标月表的售前 5 人每日格）。
 *
 * 前置（一次性，详见 工具/README.md 与 ../排班经验.md）：
 *   1. 在排班表在线文档里新建「文档共享脚本」，粘贴 工具/AirScript-写售前排班.txt 全文，Ctrl+S 保存；
 *   2. 为该脚本生成脚本令牌、复制同步 webhook；
 *   3. 在本项目 project-config/platform-config.json 里填：
 *      {
 *        "kdocsScheduleSync": {
 *          "documentUrl": "https://www.kdocs.cn/l/cga7jWGHxzkp",
 *          "webhookUrl": "https://www.kdocs.cn/api/v3/ide/file/<file_id>/script/<script_id>/sync_task",
 *          "apiToken": "<AirScript-Token>"
 *        }
 *      }
 *      （该文件已在仓库 .gitignore 中，不入库；令牌等同密码，不打印、不提交。）
 *
 * 用法（Windows PowerShell / bash 均可）：
 *   node 工具/写在线排班表.cjs --plan 测试数据/2026年10月-计划.json --sheet 2026年10月
 *   node 工具/写在线排班表.cjs --plan ... --sheet ... --dry-run      # 只打印载荷，不调用
 *   node 工具/写在线排班表.cjs --plan ... --sheet ... --webhook <url> --token <token>  # 临时覆盖配置
 *
 * 只写：目标月表里售前 5 人（韩欢欢/麦诺谦/叶炳辉/徐佳楠/刘秀文）的每日班次格；
 * 不改底色、不改其他行、不改其他月份子表；在线脚本写后回读校验并保存。
 * 失败不自动重试（失败处置总方针）。
 */

const fs = require('fs');
const path = require('path');

const EXPECTED_SCRIPT_VERSION = '2026-09-20.1';
const EXPECTED_OPERATION_TYPE = 'write_seller_schedule';
const EXPECTED_SELLER_NAMES = ['韩欢欢', '麦诺谦', '叶炳辉', '徐佳楠', '刘秀文'];
const MIN_DAY_COUNT = 28;
const MAX_DAY_COUNT = 31;
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

function normalizeShift(value) {
  const text = cellText(value).trim();
  if (text === '休') return '';
  if (text === '早' || text === '晚' || text === '') return text;
  throw new Error('班次只能是 早/晚/休/空，收到：' + text);
}

function checksumOf(text) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return ('00000000' + hash.toString(16)).slice(-8);
}

function loadPlan(planPath) {
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  } catch (error) {
    throw new Error('读不了计划 JSON：' + sanitize(error && error.message));
  }
  const seller = plan && plan.seller;
  if (!seller || typeof seller !== 'object' || Array.isArray(seller)) {
    throw new Error('计划 JSON 里没有 seller 对象（售前 5 人）。');
  }
  const planNames = Object.keys(seller).sort();
  const expectedNames = EXPECTED_SELLER_NAMES.slice().sort();
  if (planNames.length !== expectedNames.length || planNames.some((name, index) => name !== expectedNames[index])) {
    throw new Error('计划 seller 必须正好是售前 5 人（' + EXPECTED_SELLER_NAMES.join('/') + '），实际：' + planNames.join('/'));
  }
  const dayCount = Number(plan.meta && plan.meta.days);
  if (dayCount !== Math.floor(dayCount) || dayCount < MIN_DAY_COUNT || dayCount > MAX_DAY_COUNT) {
    throw new Error('计划 meta.days 必须是 ' + MIN_DAY_COUNT + '~' + MAX_DAY_COUNT + ' 的整数：' + cellText(plan.meta && plan.meta.days));
  }
  const employees = [];
  for (let index = 0; index < EXPECTED_SELLER_NAMES.length; index += 1) {
    const name = EXPECTED_SELLER_NAMES[index];
    const shifts = seller[name];
    if (!Array.isArray(shifts) || shifts.length !== dayCount) {
      throw new Error(name + ' 的班次数量应为 ' + dayCount + '，实际 ' + (Array.isArray(shifts) ? shifts.length : '不是数组'));
    }
    const normalizedShifts = [];
    for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
      normalizedShifts.push(normalizeShift(shifts[dayIndex]));
    }
    employees.push({ name: name, shifts: normalizedShifts });
  }
  return { plan: plan, dayCount: dayCount, employees: employees };
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
      '缺少 webhook 或脚本令牌。请先在排班表在线文档里建好「文档共享脚本」（粘贴 工具/AirScript-写售前排班.txt），' +
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
  if (String(result.operationType || '') !== EXPECTED_OPERATION_TYPE) problems.push('operationType 不是 ' + EXPECTED_OPERATION_TYPE);
  if (String(result.sheetName || '') !== expected.sheetName) problems.push('sheetName 不是 ' + expected.sheetName);
  if (Number(result.writtenCellCount) !== expected.writtenCellCount) problems.push('writtenCellCount 应为 ' + expected.writtenCellCount + '，实际 ' + result.writtenCellCount);
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
  if (!planPath) fail('缺少 --plan（计划 JSON，格式见 工具/README.md）。');
  if (!fs.existsSync(planPath)) fail('计划 JSON 不存在：' + planPath);
  const sheetName = String(args.sheet || '').trim();
  if (!/^\d{4}年\d{1,2}月$/.test(sheetName)) fail('缺少或格式不对的 --sheet（形如 2026年10月）。');

  const loaded = loadPlan(planPath);
  if (loaded.plan.meta && loaded.plan.meta.month && !sheetName.endsWith(String(loaded.plan.meta.month))) {
    fail('计划 meta.month（' + loaded.plan.meta.month + '）与 --sheet（' + sheetName + '）不是同一个月。');
  }

  const checksumText = sheetName + '|' + loaded.employees.map(function (employee) {
    return employee.name + ':' + employee.shifts.join(',');
  }).join(';');
  const payloadChecksum = checksumOf(checksumText);
  const argv = {
    operationType: EXPECTED_OPERATION_TYPE,
    requiredScriptVersion: EXPECTED_SCRIPT_VERSION,
    sheetName: sheetName,
    dayCount: loaded.dayCount,
    employees: loaded.employees
  };
  const expected = {
    sheetName: sheetName,
    writtenCellCount: loaded.employees.length * loaded.dayCount,
    payloadChecksum: payloadChecksum
  };

  if (String(args['dry-run'] || '').toLowerCase() === 'true') {
    console.log(JSON.stringify({
      mode: 'dry-run（未调用在线脚本）',
      operationType: argv.operationType,
      requiredScriptVersion: argv.requiredScriptVersion,
      sheetName: argv.sheetName,
      dayCount: argv.dayCount,
      employees: argv.employees,
      payloadChecksum: payloadChecksum,
      expectedWrittenCellCount: expected.writtenCellCount
    }, null, 2));
    return;
  }

  const settings = loadSettings(args);
  console.log('目标月表：' + sheetName + '；售前 ' + loaded.employees.length + ' 人 × ' + loaded.dayCount + ' 天 = ' + expected.writtenCellCount + ' 格；调用在线脚本…');
  const result = await callAirScript(settings, argv);
  validateResult(result, expected);
  console.log(JSON.stringify({
    status: 'success',
    sheetName: result.sheetName,
    writtenEmployees: result.writtenEmployees,
    writtenCellCount: result.writtenCellCount,
    readBackMatched: result.readBackMatched,
    savedReadBackMatched: result.savedReadBackMatched,
    saveCompleted: result.saveCompleted,
    payloadChecksum: result.payloadChecksum
  }, null, 2));
}

main().catch(function (error) {
  fail(sanitize(error && error.message ? error.message : error));
});
