#!/usr/bin/env node
// 读取金山在线表格（kdocs/WPS）指定子表的已用区域 —— 只读调用 AirScript，不写单元格。
//
// 前置：把同目录 AirScript-只读读取子表.txt 粘贴到目标表格的 AirScript 编辑器并保存，
//       在 AirScript 面板生成「API 地址」和「令牌」，然后：
//
//   set KDOCS_AIRSCRIPT_TOKEN=<令牌>
//   node 读取金山子表.cjs --webhook "<API 地址>" --sheet "2026-9" --out "本地输出.json"
//
// 参数：--webhook（必填）/ --sheet（子表名，缺省=最后一张）/ --max-rows / --max-columns /
//       --operation list_sheets|read_sheet / --out（写 JSON）/ --token-env（默认 KDOCS_AIRSCRIPT_TOKEN）
// 安全：令牌只从环境变量或 --token-file 读，不打印、不落盘、不写进 JSON。
'use strict';
const fs = require('fs');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const webhook = arg('webhook');
if (!webhook) {
  console.error('用法：node 读取金山子表.cjs --webhook "<AirScript API 地址>" [--sheet "2026-9"] [--out out.json]');
  process.exit(2);
}
const tokenEnv = arg('token-env') || 'KDOCS_AIRSCRIPT_TOKEN';
const tokenFile = arg('token-file');
const token = tokenFile ? fs.readFileSync(tokenFile, 'utf8').trim() : String(process.env[tokenEnv] || '').trim();
if (!token) {
  console.error(`缺少令牌：请设置环境变量 ${tokenEnv}，或用 --token-file 指向只含令牌的文件（不要提交到仓库）。`);
  process.exit(2);
}
const operationType = arg('operation') || 'read_sheet';
const sheetName = arg('sheet');
const maxRows = Number(arg('max-rows') || 400);
const maxColumns = Number(arg('max-columns') || 40);

const argv = { operationType, maxRows, maxColumns };
if (sheetName) argv.sheetName = sheetName;

(async () => {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'AirScript-Token': token },
      body: JSON.stringify({ Context: { argv } }),
      signal: AbortSignal.timeout(120000)
    });
  } catch (error) {
    console.error(`连接金山失败：${error && error.message}`);
    process.exit(1);
  }
  const text = await response.text();
  if (!response.ok) {
    console.error(`金山接口 HTTP ${response.status}：${text.slice(0, 300)}（检查 API 地址/令牌，或脚本里有没有 return）`);
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    console.error(`返回不是 JSON：${text.slice(0, 300)}`);
    process.exit(1);
  }
  const data = payload && payload.data ? payload.data : payload;
  const result = data && data.result ? data.result : data;
  const out = {
    fetchedAt: new Date().toISOString(),
    webhookHost: new URL(webhook).host,
    elapsedMs: Date.now() - startedAt,
    result
  };
  const outFile = arg('out');
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');

  if (operationType === 'list_sheets') {
    console.log('子表：', JSON.stringify(result && result.sheetNames));
  } else {
    const rows = (result && result.rows) || [];
    console.log(JSON.stringify({
      sheetName: result && result.sheetName,
      totalRowCount: result && result.totalRowCount,
      totalColumnCount: result && result.totalColumnCount,
      returnedRowCount: rows.length,
      returnedColumnCount: result && result.returnedColumnCount,
      outFile: outFile || null
    }, null, 2));
    for (const row of rows.slice(0, 12)) console.log('  ' + row.join(' | ').slice(0, 200));
    if (rows.length > 12) console.log(`  …（共 ${rows.length} 行，全量见 --out 文件）`);
  }
})();
