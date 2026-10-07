var scriptVersion = '2026-10-07.1'

// 《2026年【湖南怀化售后】对接表》『退货退款表』K 列（订单号）空白清洗脚本 v2026-10-07.1
//
// 【干什么】黎路遥 2026-10-07：「自动调整一下退货退款表里的 K 列订单号，去掉那些空白的内容，
//   否则匹配不到。就是有时候客服填写订单号的时候后面多了一个空格什么的」——
//   把 K2 到数据末行的订单号里的空白字符全部去掉：
//   · 前后空格 / 全角空格 U+3000 / 制表符 / 换行 / 零宽字符（\u200b-\u200d、\ufeff）；
//   · 数字**中间**的空格也去掉（订单号不该含空格）。
//   · 空单元格、只剩空白、`/`、`-`、`—` 这类非单号内容**跳过**（不写、不清空）。
//   · 公式格跳过；扫描后被别人改过的格跳过（不覆盖别人的新改动）。
//
// 【安全设计（顺序不能改）】
//   1) 没有 allowWrite:true → 一个字节都不写，只回「将改动清单」（dryRun / probe）；
//   2) 只写有变化的格：逐格写入，K 列以外的列 / 其它子表 / 其它行一个字节不碰；
//   3) 写入前该格重读复核 + 设文本格式（NumberFormatLocal='@'），防 19 位订单号丢精度；
//   4) 写完立刻回读全部已写格逐格核对，不符就报出来（mismatched / firstMismatch）。
//
// 【调用】POST <本脚本同步 webhook>   Header: AirScript-Token: <token>
//   探针（只读）：{"Context":{"argv":{"probe":true}}}
//   预演（只读）：{"Context":{"argv":{"dryRun":true}}}   或 不带 allowWrite 直接调
//   清洗写入：{"Context":{"argv":{"allowWrite":true}}}
// 返回：{ scriptVersion, mode, scanned, lastRow, changed, samples, readBack, mismatched, firstMismatch }
//
// 【粘贴方式】《2026年【湖南怀化售后】对接表》→ 效率 → 高级开发 → AirScript → 新建脚本「湖南对接表K列清洗」
//   → 先清空编辑器里的全部默认内容 → 粘全文 → 保存 → 生成「同步 webhook」
//   → 把地址填进本机 30号 project-config/kdocs-airscript.local.json 的 clean_dh_k。
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、相等用长度对齐加 indexOf、比大小用减法。别改回去。

var 默认子表 = '退货退款表'
var 目标列 = 'K'
var 数据起始行 = 2
var CHUNK_ROWS = 5000
var 最大行数 = 60000
var 最大改动数 = 10000
var 样例上限 = 10

function contains(haystack, needle) {
  return Boolean(String(haystack).indexOf(needle) + 1)
}

// 洗空白：去掉所有空白/不可见字符（含全角空格、制表符、换行、零宽、BOM）。
function 洗空白(值) {
  return String(值).replace(/[\s\u3000\u200b\u200c\u200d\ufeff]/g, '')
}

// 文本相等（不用成双等号）：长度先对齐，再看互相包含。
function 同文(a, b) {
  var 甲 = String(a)
  var 乙 = String(b)
  if (甲.length - 乙.length) return false
  if (!甲) return true
  return Boolean(乙.indexOf(甲) + 1)
}

function 是日期(值) {
  return (值 instanceof Date) ? true : false
}

// 单字符：`/`、`-`、`—`（非单号内容，跳过）。
function 是斜杠或横(文本) {
  if (文本.length - 1) return false
  return Boolean('/-—'.indexOf(文本) + 1)
}

// 原文里看不见的空白，转成能肉眼认出的标记（给 samples 用）。
function 可读(文本) {
  return String(文本)
    .replace(/\t/g, '[TAB]')
    .replace(/\n/g, '[换行]')
    .replace(/\r/g, '[回车]')
    .replace(/\u3000/g, '[全角空格]')
    .replace(/ /g, '[半角空格]')
    .replace(/[\u200b\u200c\u200d]/g, '[零宽]')
    .replace(/\ufeff/g, '[BOM]')
}

// 单列分块读回来可能是：2 维数组 / 1 维数组 / 单格标量，统一拍成 1 维。
function 规整一维(值) {
  if (值 instanceof Array) {
    if (值[0] instanceof Array) {
      var 平 = []
      for (var i = 0; i - 值.length < 0; i += 1) {
        var 行 = 值[i]
        平.push((行 instanceof Array) ? 行[0] : 行)
      }
      return 平
    }
    return 值
  }
  return [值]
}

// 扫 K2 到数据末行：只读、只收集「有变化的格」，一个字节都不写。
function 扫描(sheet) {
  var 变更 = []
  var 有内容 = 0
  var 跳过 = 0
  var 全空白 = 0
  var 日期 = 0
  var 末行 = 0
  var 行 = 数据起始行
  while (行 - 最大行数 < 1) {
    var 结束行 = 行 + CHUNK_ROWS - 1
    if (结束行 - 最大行数 > 0) 结束行 = 最大行数
    var 块 = null
    try {
      块 = sheet.Range(目标列 + 行 + ':' + 目标列 + 结束行).Value2
    } catch (errorRead) {
      块 = null
    }
    if (块) {
      var 值表 = 规整一维(块)
      for (var i = 0; i - 值表.length < 0; i += 1) {
        var 格值 = 值表[i]
        if (!格值) continue
        有内容 = 有内容 + 1
        var 行号 = 行 + i
        if (行号 - 末行 > 0) 末行 = 行号
        if (是日期(格值)) {
          日期 = 日期 + 1
          continue
        }
        var 原 = String(格值)
        var 新 = 洗空白(格值)
        if (!新) {
          全空白 = 全空白 + 1
          continue
        }
        if (是斜杠或横(新)) {
          跳过 = 跳过 + 1
          continue
        }
        if (原.length - 新.length) {
          变更.push({ 行: 行号, 原值: 原, 新值: 新 })
        }
      }
    }
    行 = 结束行 + 1
  }
  return { 变更: 变更, 有内容: 有内容, 跳过: 跳过, 全空白: 全空白, 日期: 日期, 末行: 末行 }
}

function 取样例(变更) {
  var 样 = []
  var 数 = 变更.length
  if (数 - 样例上限 > 0) 数 = 样例上限
  for (var i = 0; i - 数 < 0; i += 1) {
    var 条 = 变更[i]
    样.push({
      行: 条.行,
      原值: 条.原值,
      新值: 条.新值,
      原值可见: 可读(条.原值),
      新值可见: 可读(条.新值)
    })
  }
  return 样
}

// 写一格：重读复核（防覆盖别人刚改的）→ 设文本格式 → 写。
// 返回：ok / 公式格跳过 / 扫描后已变动 / 已一致 / 写入失败
function 写文本格(sheet, 条) {
  var 格 = null
  try {
    格 = sheet.Range(目标列 + 条.行)
  } catch (errorRange) {
    return '写入失败'
  }
  try {
    if (格.HasFormula) return '公式格跳过'
  } catch (errorFormula) {
    errorFormula = errorFormula
  }
  var 现 = 条.原值
  try {
    var 现值 = 格.Value2
    现 = 现值 ? String(现值) : ''
  } catch (errorReread) {
    现 = 条.原值
  }
  if (同文(现, 条.新值)) return '已一致'
  if (!同文(现, 条.原值)) return '扫描后已变动'
  try {
    格.NumberFormatLocal = '@'
  } catch (errorFormat1) {
    try {
      格.NumberFormat = '@'
    } catch (errorFormat2) {
      errorFormat2 = errorFormat2
    }
  }
  try {
    格.Value2 = 条.新值
    return 'ok'
  } catch (errorWrite1) {
    try {
      格.Value = 条.新值
      return 'ok'
    } catch (errorWrite2) {
      return '写入失败'
    }
  }
}

function 执行写入(sheet, 变更) {
  var 已写 = []
  var 失败行 = []
  var 跳过公式行 = []
  var 扫描后变动行 = []
  var 已一致行 = []
  for (var i = 0; i - 变更.length < 0; i += 1) {
    var 条 = 变更[i]
    var 结果 = 写文本格(sheet, 条)
    if (结果.indexOf('ok') + 1) 已写.push(条)
    else if (结果.indexOf('公式') + 1) 跳过公式行.push(条.行)
    else if (结果.indexOf('变动') + 1) 扫描后变动行.push(条.行)
    else if (结果.indexOf('一致') + 1) 已一致行.push(条.行)
    else 失败行.push(条.行)
  }
  return { 已写: 已写, 失败行: 失败行, 跳过公式行: 跳过公式行, 扫描后变动行: 扫描后变动行, 已一致行: 已一致行 }
}

// 回读核验：把「已写格」逐格重读，核对确实是新值（不符就报行号 + 首条差异）。
function 回读核验(sheet, 已写) {
  var 期望 = {}
  for (var i = 0; i - 已写.length < 0; i += 1) 期望[String(已写[i].行)] = 已写[i].新值
  var 不符 = 0
  var 首条差 = ''
  var 抽查 = []
  var 行 = 数据起始行
  while (行 - 最大行数 < 1) {
    var 结束行 = 行 + CHUNK_ROWS - 1
    if (结束行 - 最大行数 > 0) 结束行 = 最大行数
    var 块 = null
    try {
      块 = sheet.Range(目标列 + 行 + ':' + 目标列 + 结束行).Value2
    } catch (errorRead) {
      块 = null
    }
    if (块) {
      var 值表 = 规整一维(块)
      for (var j = 0; j - 值表.length < 0; j += 1) {
        var 行号 = 行 + j
        var 期望值 = 期望[String(行号)]
        if (!期望值) continue
        var 实际 = 值表[j] ? String(值表[j]) : ''
        if (同文(实际, 期望值)) {
          if (抽查.length - 样例上限 < 0) 抽查.push({ 行: 行号, 值: 实际 })
        } else {
          不符 = 不符 + 1
          if (!首条差) 首条差 = '第' + String(行号) + '行 期望[' + 期望值 + '] 实际[' + 实际 + ']'
        }
      }
    }
    行 = 结束行 + 1
  }
  return { 不符: 不符, 首条差: 首条差, 抽查: 抽查 }
}

function 解析参数(rawArgument) {
  var payload = rawArgument
  if (contains(typeof payload, 'string')) {
    try {
      payload = JSON.parse(String(payload))
    } catch (errorParse) {
      payload = null
    }
  }
  var bag = payload
  if (bag instanceof Array) bag = bag[0] ? bag[0] : {}
  if (!bag) bag = {}
  return {
    allowWrite: bag.allowWrite ? true : false,
    dryRun: bag.dryRun ? true : false,
    probe: bag.probe ? true : false
  }
}

function 基础信息(扫描结果, 头) {
  return {
    scriptVersion: scriptVersion,
    sheet: 默认子表,
    column: 目标列,
    k1Header: 头,
    scanned: 扫描结果.有内容,
    dataRows: 扫描结果.有内容,
    lastRow: 扫描结果.末行,
    changed: 扫描结果.变更.length,
    skippedSlash: 扫描结果.跳过,
    skippedBlank: 扫描结果.全空白,
    skippedDate: 扫描结果.日期,
    samples: 取样例(扫描结果.变更)
  }
}

function main() {
  var 参数 = 解析参数((Context && Context.argv) ? Context.argv : null)
  var sheet = null
  try {
    sheet = Application.Worksheets.Item(默认子表)
  } catch (errorSheet) {
    sheet = null
  }
  if (!sheet) return { scriptVersion: scriptVersion, mode: 'error', message: '找不到子表 ' + 默认子表 }
  var 头 = ''
  try {
    var 头值 = sheet.Range('K1').Value2
    头 = 头值 ? String(头值) : ''
  } catch (errorHead) {
    头 = ''
  }
  var 头就位 = contains(头, '订单')

  var 扫描结果 = 扫描(sheet)
  var 基础 = 基础信息(扫描结果, 头)
  基础.headerOk = 头就位

  if (参数.probe) {
    基础.mode = 'probe'
    基础.headerOk = 头就位
    基础.wrote = false
    return 基础
  }
  if (参数.dryRun || !参数.allowWrite) {
    基础.mode = 'dryRun'
    基础.wrote = false
    基础.message = 参数.allowWrite ? 'dryRun:true，未写入' : '缺少 allowWrite:true，只回将改动清单，未写入'
    return 基础
  }
  if (!头就位) {
    基础.mode = 'clean'
    基础.wrote = false
    基础.message = 'K1 表头不是「订单号」相关内容（读到：' + 头 + '），拒绝动手（防表结构变了误伤）'
    return 基础
  }
  if (!扫描结果.末行) {
    基础.mode = 'clean'
    基础.wrote = false
    基础.message = 'K 列没有读到数据，拒绝执行'
    return 基础
  }
  if (扫描结果.变更.length - 最大改动数 > 0) {
    基础.mode = 'clean'
    基础.wrote = false
    基础.message = '将改动 ' + String(扫描结果.变更.length) + ' 格，超过上限 ' + String(最大改动数) + '，拒绝执行（先人工看 dryRun 清单）'
    return 基础
  }

  var 写入 = 执行写入(sheet, 扫描结果.变更)
  var 核验 = 回读核验(sheet, 写入.已写)

  基础.mode = 'clean'
  基础.wrote = true
  基础.written = 写入.已写.length
  基础.failed = 写入.失败行.length
  基础.failedRows = 写入.失败行
  基础.skippedFormula = 写入.跳过公式行.length
  基础.skippedFormulaRows = 写入.跳过公式行
  基础.skippedChanged = 写入.扫描后变动行.length
  基础.skippedChangedRows = 写入.扫描后变动行
  基础.alreadyClean = 写入.已一致行.length
  基础.mismatched = 核验.不符
  基础.firstMismatch = 核验.首条差
  基础.readBack = 核验.抽查
  return 基础
}

return main()
