// 守卫测试：src 里"以函数形式调用"的标识符必须在同文件有来源
// 背景：2026-09-17 发现删截图时手误把 reportPddDownloadProgress( 写成 reportProgress(，
//       node --check 只查语法、查不出未定义标识符，导致拼多多两家店在真跑时才炸。
//       本测试把"调用了一个本文件根本没有的标识符"拦在测试阶段。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const 项目根 = path.resolve(__dirname, '..');
const 源码根 = path.join(项目根, 'src');

const 关键字 = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'await', 'delete', 'void',
  'in', 'of', 'else', 'do', 'try', 'finally', 'case', 'function', 'class', 'const', 'let', 'var',
  'throw', 'yield', 'super', 'this', 'import', 'export', 'default', 'extends', 'with', 'instanceof',
  'break', 'continue', 'debugger', 'null', 'true', 'false', 'undefined', 'NaN', 'Infinity',
]);

const 全局白名单 = new Set([
  'require', 'module', 'exports', 'console', 'process', 'globalThis',
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask', 'structuredClone', 'fetch', 'atob', 'btoa',
  'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'EvalError', 'URIError', 'AggregateError', 'Promise', 'Proxy', 'Reflect', 'Intl',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics',
  'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array',
  'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'AbortController', 'AbortSignal',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'eval', 'Function', 'performance', 'crypto',
  'MouseEvent', 'KeyboardEvent', 'Event', 'CustomEvent', 'HTMLElement', 'Element', 'Node',
  'DOMParser', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage',
  'window', 'document', 'navigator', 'location', 'history', 'screen',
  'Image', 'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'alert', 'confirm', 'prompt',
]);

const 标识符 = '[A-Za-z_\\u4e00-\\u9fa5][\\w\\u4e00-\\u9fa5]*';

function 列出源码文件(目录) {
  const 结果 = [];
  for (const 项 of fs.readdirSync(目录, { withFileTypes: true })) {
    const 全路径 = path.join(目录, 项.name);
    if (项.isDirectory()) 结果.push(...列出源码文件(全路径));
    else if (项.name.endsWith('.js')) 结果.push(全路径);
  }
  return 结果;
}

/** 去掉注释与字符串字面量：避免中文说明文字里的 "xxx(" 被当成调用 */
function 去注释与字符串(文本) {
  return 文本
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    // 正则字面量：/xxx/g —— 里面的 ReceptionData(?:…) 不能当成函数调用
    .replace(/\/(?:\\.|[^/\n\\])+\/[dgimsuvy]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/** 调用位置的标识符：前面不是 . 或标识符字符（排除 obj.method(） */
function 取调用标识符(文本) {
  const 名字 = new Set();
  const 正则 = new RegExp(`(^|[^\\w$.\\u4e00-\\u9fa5])(${标识符})\\s*\\(`, 'gm');
  let 命中;
  while ((命中 = 正则.exec(文本)) !== null) {
    if (!关键字.has(命中[2])) 名字.add(命中[2]);
  }
  return 名字;
}

/** 找 `(` 对应的 `)`，返回右括号后的第一个非空白字符（用于区分「方法定义」与「普通调用」） */
function 右括号后的字符(文本, 左括号下标) {
  let 深度 = 0;
  for (let i = 左括号下标; i < 文本.length; i += 1) {
    const c = 文本[i];
    if (c === '(') 深度 += 1;
    else if (c === ')') {
      深度 -= 1;
      if (深度 === 0) {
        const 后面 = 文本.slice(i + 1).match(/^\s*(.)/);
        return 后面 ? 后面[1] : '';
      }
    }
  }
  return '';
}

/** 本文件"有来源"的名字：声明、方法简写（行首 name(...) { ），以及任何"后面不紧跟 ("的出现 */
function 取本文件已定义名字(文本) {
  const 结果 = new Set();
  const 收集 = (正则) => {
    let 命中;
    while ((命中 = 正则.exec(文本)) !== null) 结果.add(命中[1]);
  };
  收集(new RegExp(`function\\s+(${标识符})`, 'g'));
  收集(new RegExp(`class\\s+(${标识符})`, 'g'));
  收集(new RegExp(`(?:const|let|var)\\s+(${标识符})`, 'g'));
  // 方法/属性简写：行首（可带 async/static/get/set/*）name(...) {  —— 且右括号后是 {
  const 行首调用 = new RegExp(`^\\s*(?:async\\s+|static\\s+|get\\s+|set\\s+|\\*\\s*)?(${标识符})\\s*\\(`, 'gm');
  let 命中;
  while ((命中 = 行首调用.exec(文本)) !== null) {
    const 左括号下标 = 文本.indexOf('(', 命中.index + 命中[1].length);
    if (右括号后的字符(文本, 左括号下标) === '{') 结果.add(命中[1]);
  }
  // 其它任何出现位置（后面紧跟 ( 的视为调用，不算来源）
  收集(new RegExp(`(${标识符})(?!\\s*\\()`, 'g'));
  return 结果;
}

function 检查文件(文件路径) {
  const 文本 = 去注释与字符串(fs.readFileSync(文件路径, 'utf8'));
  const 已定义 = 取本文件已定义名字(文本);
  return [...取调用标识符(文本)].filter((名) => !关键字.has(名) && !全局白名单.has(名) && !已定义.has(名));
}

test('src 里被调用的标识符必须在同文件有来源（防手误改名）', () => {
  const 问题 = [];
  for (const 文件 of 列出源码文件(源码根)) {
    const 无来源 = 检查文件(文件);
    if (无来源.length) 问题.push(`${path.relative(项目根, 文件)}: ${无来源.join('、')}`);
  }
  assert.deepEqual(
    问题,
    [],
    `以下文件调用了本文件没有定义/导入/传参的标识符（多半是改名或删代码时手误）：\n${问题.join('\n')}`,
  );
});

test('守卫本身有效：能抓出 2026-09-17 拼多多那处手误', () => {
  const 坏样本 = [
    'const { reportPddDownloadProgress } = require("./pddDownloadRuntime");',
    'async function runConnectedPddDownload(browser, onProgress, options, context) {',
    '  const { resolvedConfig, downloadDir, exportRange } = context;',
    '  if (exportRange) {',
    '      reportProgress(onProgress, "触发下载表单", "占位");',
    '  }',
    '}',
  ].join('\n');
  const 临时文件 = path.join(os.tmpdir(), `守卫自检-${process.pid}.js`);
  fs.writeFileSync(临时文件, 坏样本);
  try {
    assert.deepEqual(检查文件(临时文件), ['reportProgress'], '守卫应只报出 reportProgress 这一个无来源标识符');
  } finally {
    fs.rmSync(临时文件, { force: true });
  }
});

// 项目测试统一用自写的 test 注册（无运行器依赖）
function test(名称, 函数) {
  try {
    函数();
    console.log(`  ✓ ${名称}`);
  } catch (错误) {
    console.error(`  ✗ ${名称}`);
    console.error(错误 && 错误.message ? 错误.message : 错误);
    process.exitCode = 1;
  }
}
