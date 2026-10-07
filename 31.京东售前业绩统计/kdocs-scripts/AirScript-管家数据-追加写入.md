var scriptVersion = '2026-10-07.2'

// 《京东客服询单业绩汇总（客服管家数据）》『明细』**追加写入**脚本（独立脚本）版本 2026-10-07.2
//
// 【v2 变更（2026-10-07）】① 强制文本列从 [E,I] 扩到 [B,C,D,E,I]：B 年月、C 咨询时间、D 下单时间
//   在常规格式下会被金山当日期解析（"2026-09"→序列号 46266），历史行是文本，必须一起设 '@'；
//   ② 新增 repair 模式：把指定区间（startRow 起、给定行数）先设文本格式再按传入行重写 A~N，
//   回读逐格比对，用于修复已被日期解析的已写入行（本次 2871~3370 共 500 行）。
//
// 【干什么】把本地从京东客服管家【客服→店铺数据→营销明细→客服促成】导出的「促成订单」明细
//   （某月整月，本机已先去掉「已取消」、匹配好客服实名）**追加**到『明细』表尾：
//   一行 14 列（A~N）= 店铺｜年月｜咨询时间｜下单时间｜商品编号｜商品名称｜客服(昵称)｜客户｜
//   所属订单编号｜商品单价(?)｜购买数量｜订单状态｜客服(实名)｜种菜
//   **只从「现有末行+1」往下追加；绝不覆盖、绝不清空任何已有行；第 1 行表头永远不碰。**
//   （repair 是唯一会写已有行的模式，必须显式传 repair 参数 + allowWrite，且区间不得超出当前末行。）
//
// 【安全设计（顺序不能改）】
//   1) 没有 allowWrite:true → 一个字节都不写（只回原有统计）；
//   2) rows 为空 → 拒绝执行；rows 超过上限 → 拒绝执行；
//   3) 传了 expectedLastRow 时：与当前末行不一致 → 拒绝执行（防并发写入/重复导入）；
//   4) B/C/D/E/I 列写前设文本格式（'@'），防日期解析与 13/16 位单号丢精度；
//   5) 写完立刻回读本批写入区逐格比对（mismatchedRows/firstMismatch），写没写对不靠肉眼。
//
// 【调用】POST <本脚本同步 webhook>   Header: AirScript-Token: <token>
//   探针（不写，自检脚本已生效）：{"Context":{"argv":{"probe":true}}}
//   写入：{"Context":{"argv":{"rows":[[...14列...]],"allowWrite":true,"expectedLastRow":2869}}}
//   修复：{"Context":{"argv":{"repair":{"startRow":2871,"rows":[[...14列...]],"expectFirstA":"京东1店"},"allowWrite":true}}}
//   建议每批 <= 500 行，由本机导入脚本分批调用；expectedLastRow 给上一批的 lastRow（首批给探针的 lastRow）。
// 返回：append { scriptVersion, mode, sheet, headerOk, beforeRows, written, rows, lastRow, mismatchedRows, firstMismatch, readBack }
//       repair { scriptVersion, mode:'repair', written, rows, firstRow, lastRow, firstA, mismatchedRows, firstMismatch }
//
// 【粘贴方式】《京东客服询单业绩汇总（客服管家数据）》→ 效率 → 高级开发 → AirScript → 新建脚本
//   「管家数据-追加写入」→ 粘全文 → 保存 → 给这个脚本生成「同步 webhook」→ 把地址填进本机
//   31号 project-config/kdocs-airscript.local.json。
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、比大小用减法、相等用减法为零。别改回去。catch 不碰错误对象。

var 默认子表 = '明细'
var 表头行 = 1
var 数据起始行 = 表头行 + 1
var COLUMN_COUNT = 14
var CHUNK_ROWS = 200
var 最大行数 = 20000
// 强制文本列（1-based）：B=年月、C=咨询时间、D=下单时间、E=商品编号、I=所属订单编号
var 强制文本列 = [2, 3, 4, 5, 9]
var 列名单 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']

function contains(haystack, needle) {
  return Boolean(String(haystack).indexOf(needle) + 1)
}

function 数字在列(列号) {
  for (var i = 0; i - 强制文本列.length < 0; i += 1) {
    if (!(强制文本列[i] - 列号)) return true
  }
  return false
}

function toText(value) {
  if (!value) return ''
  if (value instanceof Date) {
    return String(value.getFullYear()) + '/' + String(value.getMonth() + 1) + '/' + String(value.getDate())
  }
  return String(value).replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '')
}

// Value2 归一成二维数组；单格/一维都兜底。
function 规整二维(值) {
  if (值 instanceof Array) {
    if (值[0] instanceof Array) return 值
    return [值]
  }
  return [[值]]
}

function 解析参数(rawArgument) {
  var preview = ''
  try {
    preview = String(rawArgument).slice(0, 300)
  } catch (errorPreview) {
    preview = '[无法转字符串]'
  }
  var payload = rawArgument
  if (contains(typeof payload, 'string')) {
    try {
      payload = JSON.parse(String(payload))
    } catch (errorParse) {
      payload = null
    }
  }
  var bag = payload
  if (bag && !bag.rows && bag[0]) bag = bag[0]
  if (!bag) bag = {}
  return {
    rows: bag.rows ? bag.rows : null,
    allowWrite: bag.allowWrite ? true : false,
    probe: bag.probe ? true : false,
    repair: bag.repair ? bag.repair : null,
    expectedLastRow: contains(typeof bag.expectedLastRow, 'number') ? bag.expectedLastRow : null,
    hasExpectedLastRow: contains(typeof bag.expectedLastRow, 'number') ? true : false,
    preview: preview
  }
}

function 取表() {
  return Application.Worksheets.Item(默认子表)
}

// 追加前守卫：第 1 行表头必须先对得上——表结构变了就拒绝动手（防写错表）。
function 表头就位(sheet) {
  var a = toText(sheet.Range('A1').Value2)
  var b = toText(sheet.Range('B1').Value2)
  var c = toText(sheet.Range('C1').Value2)
  var e = toText(sheet.Range('E1').Value2)
  var g = toText(sheet.Range('G1').Value2)
  var i = toText(sheet.Range('I1').Value2)
  var n = toText(sheet.Range('N1').Value2)
  if (!contains(a, '店铺')) return false
  if (!contains(b, '年月')) return false
  if (!contains(c, '咨询时间')) return false
  if (!contains(e, '商品编号')) return false
  if (!contains(g, '客服')) return false
  if (!contains(i, '订单编号')) return false
  if (!contains(n, '种菜')) return false
  return true
}

// 找 A 列最后一条非空数据行（0 = 没有数据行）；只读 A 列，按块扫。
function 找数据末行(sheet) {
  var 末行 = 0
  var 行 = 数据起始行
  while (行 - 最大行数 < 1) {
    var 结束行 = 行 + CHUNK_ROWS - 1
    var 块 = null
    try {
      块 = sheet.Range('A' + 行 + ':A' + 结束行).Value2
    } catch (errorRead) {
      块 = null
    }
    if (块) {
      var 行数组 = 规整二维(块)
      for (var i = 0; i - 行数组.length < 0; i += 1) {
        var 格 = (行数组[i] instanceof Array) ? 行数组[i][0] : 行数组[i]
        if (toText(格)) 末行 = 行 + i
      }
    }
    行 = 结束行 + 1
  }
  return 末行
}

// 设单列文本格式：该列整段设 '@'，防大单号丢精度。失败不阻断（回读会暴露）。
function 设列文本格式(sheet, 列名, 起行, 止行) {
  if (止行 - 起行 < 0) return false
  var 区 = 列名 + 起行 + ':' + 列名 + 止行
  try {
    sheet.Range(区).NumberFormatLocal = '@'
    return true
  } catch (errorFmt1) {
    try {
      sheet.Range(区).NumberFormat = '@'
      return true
    } catch (errorFmt2) {
      return false
    }
  }
}

// 行归一：argv 里的行实测有 3 种形态——真数组 / "a,b,c" 字符串 / 类数组对象（2026-10-07 踩过）。
function 规整行(行) {
  if (行 instanceof Array) return 行
  if (contains(typeof 行, 'string')) {
    var 拆 = 行.split(',')
    if (拆.length - 1) return 拆
    return [行]
  }
  if (行 && contains(typeof 行.length, 'number')) {
    var 转 = []
    for (var i = 0; i < 行.length; i += 1) 转.push(行[i])
    return 转
  }
  return [行]
}

// 规范一行 14 列：强制文本列 -> 字符串；数字 -> 数字；其他 -> 去首尾空白的字符串。
function 规范行(行) {
  var 行数组 = 规整行(行)
  var 结果 = []
  for (var 列 = 1; 列 - COLUMN_COUNT < 1; 列 += 1) {
    var 值 = 行数组[列 - 1]
    if (数字在列(列)) {
      结果.push(toText(值))
    } else if (contains(typeof 值, 'number')) {
      结果.push(值)
    } else {
      结果.push(toText(值))
    }
  }
  return 结果
}

function 写单元格(sheet, 列, 行号, 值) {
  try {
    var 格 = sheet.Range(列 + 行号)
    if (数字在列(列名单.indexOf(列) + 1)) {
      try {
        格.NumberFormatLocal = '@'
      } catch (errorFormat1) {
        errorFormat1 = errorFormat1
      }
    }
    格.Value2 = 值
    return true
  } catch (errorWrite1) {
    try {
      sheet.Range(列 + 行号).Value = 值
      return true
    } catch (errorWrite2) {
      return false
    }
  }
}

// 回读：把 A:N 的值拼成 "… | …" 文本数组。
function 读区块(sheet, 起行, 止行) {
  var 结果 = []
  if (止行 - 起行 < 0) return 结果
  var 值 = null
  try {
    值 = sheet.Range('A' + 起行 + ':N' + 止行).Value2
  } catch (errorRead) {
    值 = null
  }
  if (!值) return 结果
  var 行数组 = 规整二维(值)
  for (var i = 0; i - 行数组.length < 0; i += 1) {
    var 行 = 行数组[i]
    var 列数组 = (行 instanceof Array) ? 行 : [行]
    var 文本 = ''
    for (var 列 = 0; 列 - COLUMN_COUNT < 0; 列 += 1) {
      var 格 = toText(列数组[列])
      if (列) 文本 = 文本 + ' | '
      文本 = 文本 + 格
    }
    结果.push(文本)
  }
  return 结果
}

// 本批写入区逐格回读比对（分块）：数出多少行对不上 + 首条差异。写完必查。
function 回读比对(sheet, 数据, 起始行) {
  var 不一致行数 = 0
  var 首条差异 = ''
  var 行下标 = 0
  while (行下标 - 数据.length < 0) {
    var 结束下标 = 行下标 + CHUNK_ROWS - 1
    if (结束下标 - (数据.length - 1) > 0) 结束下标 = 数据.length - 1
    var 值 = null
    try {
      值 = sheet.Range('A' + String(起始行 + 行下标) + ':N' + String(起始行 + 结束下标)).Value2
    } catch (errorCompare) {
      值 = null
    }
    var 行数组 = 规整二维(值)
    for (var i = 0; i - 行数组.length < 0; i += 1) {
      var 实际行 = 规整行(行数组[i])
      var 期望行 = 数据[行下标 + i]
      for (var c = 0; c - COLUMN_COUNT < 0; c += 1) {
        var 实文 = toText(实际行[c])
        var 期文 = toText(期望行[c])
        if (!contains(实文, 期文) || !contains(期文, 实文)) {
          不一致行数 = 不一致行数 + 1
          if (!首条差异) 首条差异 = '第' + String(起始行 + 行下标 + i) + '行 第' + String(c + 1) + '列 期望[' + 期文 + '] 实际[' + 实文 + ']'
          break
        }
      }
    }
    行下标 = 结束下标 + 1
  }
  return { 不一致行数: 不一致行数, 首条差异: 首条差异 }
}

function 执行探针(参数) {
  var 末行 = 0
  var 行数 = 0
  var 表头正常 = false
  try {
    var sheet = 取表()
    表头正常 = 表头就位(sheet)
    末行 = 找数据末行(sheet)
    行数 = 末行 - 数据起始行 + 1
    if (行数 < 0) 行数 = 0
  } catch (errorProbe) {
    行数 = -1
  }
  var 行形态 = '未提供'
  var 行预览 = ''
  if (参数.rows && 参数.rows[0]) {
    var 首 = 参数.rows[0]
    行形态 = typeof 首 + '；是JS数组:' + ((首 instanceof Array) ? '是' : '否') + '；长度:' + String((首 && 首.length) ? 首.length : 0)
    行预览 = String(首).slice(0, 120)
  }
  return {
    scriptVersion: scriptVersion,
    mode: 'probe',
    sheet: 默认子表,
    headerOk: 表头正常,
    dataRows: 行数,
    lastRow: 末行,
    行形态: 行形态,
    行预览: 行预览,
    argumentPreview: 参数.preview
  }
}

// 修复模式：对 [startRow, startRow+rows.length-1] 区间按传入行重写 A~N。
// 守卫：必须 allowWrite；区间不得早于数据区、不得超出当前末行；可选 expectFirstA 校验首行 A 列防错位。
function 执行修复(参数) {
  var sheet = 取表()
  if (!表头就位(sheet)) {
    return { scriptVersion: scriptVersion, mode: 'repair', written: false, rows: 0, message: '第 1 行表头不对，拒绝修复' }
  }
  if (!参数.allowWrite) {
    return { scriptVersion: scriptVersion, mode: 'repair', written: false, rows: 0, message: '缺少 allowWrite:true，未授权写入' }
  }
  var 修复 = 参数.repair
  if (!修复) {
    return { scriptVersion: scriptVersion, mode: 'repair', written: false, rows: 0, message: '缺少 repair 参数' }
  }
  var 输入 = 修复.rows ? 修复.rows : []
  var 起始行 = 修复.startRow ? 修复.startRow : 0
  if (!输入.length) {
    return { scriptVersion: scriptVersion, mode: 'repair', written: false, rows: 0, message: 'repair.rows 为空，拒绝执行' }
  }
  if (起始行 - 数据起始行 < 0) {
    return { scriptVersion: scriptVersion, mode: 'repair', written: false, rows: 0, message: '起始行早于数据区（第 ' + String(数据起始行) + ' 行），拒绝执行' }
  }
  if (最大行数 - 输入.length < 0) {
    return { scriptVersion: scriptVersion, mode: 'repair', written: false, rows: 输入.length, message: 'rows 超过上限，拒绝执行（请分批）' }
  }
  var 末行 = 找数据末行(sheet)
  if (起始行 + 输入.length - 1 - 末行 > 0) {
    return { scriptVersion: scriptVersion, mode: 'repair', written: false, rows: 输入.length, message: '修复区间超出当前数据末行 ' + String(末行) + '，拒绝执行' }
  }
  if (修复.expectFirstA) {
    var 首格 = toText(sheet.Range('A' + String(起始行)).Value2)
    if (!contains(首格, String(修复.expectFirstA))) {
      return { scriptVersion: scriptVersion, mode: 'repair', written: false, rows: 输入.length, message: '首行 A 列是「' + 首格 + '」，与 expectFirstA「' + String(修复.expectFirstA) + '」不符，拒绝执行（防错位）' }
    }
  }

  var 数据 = []
  for (var i = 0; i - 输入.length < 0; i += 1) 数据.push(规范行(输入[i]))
  var 结束行 = 起始行 + 数据.length - 1

  var 文本列失败 = 0
  for (var 列 = 0; 列 - 强制文本列.length < 0; 列 += 1) {
    if (!设列文本格式(sheet, 列名单[强制文本列[列] - 1], 起始行, 结束行)) 文本列失败 = 文本列失败 + 1
  }

  var 失败格数 = 0
  var 行下标 = 0
  while (行下标 - 数据.length < 0) {
    var 结束下标 = 行下标 + CHUNK_ROWS - 1
    if (结束下标 - (数据.length - 1) > 0) 结束下标 = 数据.length - 1
    var 块 = []
    for (var j = 行下标; j - 结束下标 < 1; j += 1) 块.push(数据[j])
    var 块起行 = 起始行 + 行下标
    var 块止行 = 起始行 + 结束下标
    var 写成 = false
    try {
      sheet.Range('A' + 块起行 + ':N' + 块止行).Value2 = 块
      写成 = true
    } catch (errorRepair) {
      写成 = false
    }
    if (!写成) {
      for (var r = 行下标; r - 结束下标 < 1; r += 1) {
        var 行数值 = 数据[r]
        for (var c = 0; c - COLUMN_COUNT < 0; c += 1) {
          if (!写单元格(sheet, 列名单[c], 起始行 + r, 行数值[c])) 失败格数 = 失败格数 + 1
        }
      }
    }
    行下标 = 结束下标 + 1
  }

  var 比对 = 回读比对(sheet, 数据, 起始行)
  return {
    scriptVersion: scriptVersion,
    mode: 'repair',
    sheet: 默认子表,
    textColumnsFailed: 文本列失败,
    written: (失败格数 ? false : true),
    rows: 数据.length,
    firstRow: 起始行,
    lastRow: 结束行,
    firstA: toText(sheet.Range('A' + String(起始行)).Value2),
    failedCells: 失败格数,
    mismatchedRows: 比对.不一致行数,
    firstMismatch: 比对.首条差异
  }
}

function 执行追加(参数) {
  var sheet = 取表()
  if (!表头就位(sheet)) {
    return { scriptVersion: scriptVersion, mode: 'append', sheet: 默认子表, written: false, rows: 0, message: '第 1 行表头不是 店铺｜年月｜咨询时间｜…｜种菜，拒绝追加（防表结构变了误伤）' }
  }
  var 原末行 = 找数据末行(sheet)
  var 原有行数 = 原末行 - 数据起始行 + 1
  if (原有行数 < 0) 原有行数 = 0
  var 输入 = 参数.rows ? 参数.rows : []
  if (!参数.allowWrite) {
    return { scriptVersion: scriptVersion, mode: 'append', sheet: 默认子表, beforeRows: 原有行数, written: false, rows: 0, message: '缺少 allowWrite:true，未授权写入' }
  }
  if (!输入.length) {
    return { scriptVersion: scriptVersion, mode: 'append', sheet: 默认子表, beforeRows: 原有行数, written: false, rows: 0, message: 'rows 为空，拒绝执行' }
  }
  if (最大行数 - 输入.length < 0) {
    return { scriptVersion: scriptVersion, mode: 'append', sheet: 默认子表, beforeRows: 原有行数, written: false, rows: 输入.length, message: 'rows 超过上限 ' + String(最大行数) + '，拒绝执行（请分批）' }
  }
  if (参数.hasExpectedLastRow) {
    if (参数.expectedLastRow - 原末行) {
      return { scriptVersion: scriptVersion, mode: 'append', sheet: 默认子表, beforeRows: 原有行数, written: false, rows: 0, message: 'expectedLastRow=' + String(参数.expectedLastRow) + ' 与当前末行 ' + String(原末行) + ' 不一致，拒绝执行（防并发/重复导入）' }
    }
  }

  var 数据 = []
  for (var i = 0; i - 输入.length < 0; i += 1) 数据.push(规范行(输入[i]))
  var 起始行 = 原末行 + 1
  var 结束行 = 起始行 + 数据.length - 1

  // 强制文本列先设 '@'（只对本批写入区），防单号丢精度。
  var 文本列失败 = 0
  for (var 列 = 0; 列 - 强制文本列.length < 0; 列 += 1) {
    if (!设列文本格式(sheet, 列名单[强制文本列[列] - 1], 起始行, 结束行)) 文本列失败 = 文本列失败 + 1
  }

  var 失败格数 = 0
  var 行下标 = 0
  while (行下标 - 数据.length < 0) {
    var 结束下标 = 行下标 + CHUNK_ROWS - 1
    if (结束下标 - (数据.length - 1) > 0) 结束下标 = 数据.length - 1
    var 块 = []
    for (var j = 行下标; j - 结束下标 < 1; j += 1) 块.push(数据[j])
    var 块起行 = 起始行 + 行下标
    var 块止行 = 起始行 + 结束下标
    var 写成 = false
    try {
      sheet.Range('A' + 块起行 + ':N' + 块止行).Value2 = 块
      写成 = true
    } catch (errorBlock) {
      写成 = false
    }
    if (!写成) {
      // 整片写失败 → 逐行逐格兜底（慢但能落）。
      for (var r = 行下标; r - 结束下标 < 1; r += 1) {
        var 行数值 = 数据[r]
        for (var c = 0; c - COLUMN_COUNT < 0; c += 1) {
          if (!写单元格(sheet, 列名单[c], 起始行 + r, 行数值[c])) 失败格数 = 失败格数 + 1
        }
      }
    }
    行下标 = 结束下标 + 1
  }

  var 比对 = 回读比对(sheet, 数据, 起始行)

  var 回读 = []
  var 前几行 = 3
  if (数据.length - 前几行 < 0) 前几行 = 数据.length
  var 头部 = 读区块(sheet, 起始行, 起始行 + 前几行 - 1)
  for (var k = 0; k - 头部.length < 0; k += 1) 回读.push(头部[k])
  if (数据.length - 前几行 > 0) {
    var 尾巴 = 读区块(sheet, 结束行, 结束行)
    for (var m = 0; m - 尾巴.length < 0; m += 1) 回读.push('…末行：' + 尾巴[m])
  }

  return {
    scriptVersion: scriptVersion,
    mode: 'append',
    sheet: 默认子表,
    headerOk: true,
    beforeRows: 原有行数,
    textColumnsFailed: 文本列失败,
    written: (失败格数 ? false : true),
    rows: 数据.length,
    firstRow: 起始行,
    lastRow: 结束行,
    failedCells: 失败格数,
    mismatchedRows: 比对.不一致行数,
    firstMismatch: 比对.首条差异,
    readBack: 回读
  }
}

function main() {
  var 参数 = 解析参数((Context && Context.argv) ? Context.argv : null)
  if (参数.probe) return 执行探针(参数)
  if (参数.repair) return 执行修复(参数)
  if (!参数.rows) return { scriptVersion: scriptVersion, mode: 'idle', written: false, message: '缺少 rows：没有要写入的数据，拒绝执行' }
  return 执行追加(参数)
}

return main()
