var scriptVersion = '2026-10-07.2'

// 《退款检测文件》『京东仓退货数据』**覆盖写入脚本**（独立脚本）版本 2026-10-07.2
//
// 【v2026-10-07.2 修什么】首导发现：argv 里的行**不一定是 JS 数组**（实测整行被 String() 成
//   "单号,运单,状态" 一串 → 旧代码 instanceof 判空 → 全挤进 A 列、B 空、C 只剩默认值）。
//   修法：规整行() 兼容 真数组 / "a,b,c" 字符串 / 类数组对象 三种形态；
//   另加 回读比对()：写完逐格比全表，返回 mismatchedRows/firstMismatch，内容对不对不靠肉眼。
//   探针带 rows 时回报「行形态」诊断（随时可查 argv 到底长什么样）。
//
// 【干什么】把本地从京东物流【退货至京东库房管理】导出的明细（最近 3 个月）映射成 3 列：
//   销售平台单号｜逆向运单号｜是否退回（值=已退回京东仓），经本脚本的同步 webhook **覆盖**写入本表数据区。
//   **保留第 1 行表头**；只清 A2:C{原数据末行}；第 1 行永远不碰。
//
// 【安全设计（顺序不能改）】
//   1) 没有 allowWrite:true → 一个字节都不写（只回原有统计）；
//   2) rows 为空 → 拒绝执行（防误清空）；rows 超过上限 → 拒绝执行；
//   3) 清数据区后、写入前，把目标区 A:C 设成文本格式（NumberFormatLocal='@'），
//      防 19 位销售平台单号被当数字丢精度（7号 2026-09-30 实测踩过：后 4 位变 0）；
//   4) 写完立刻回读（前 5 行 + 末行），写没写进去不靠猜。
//
// 【调用】POST <本脚本同步 webhook>   Header: AirScript-Token: <token>
//   探针（不写，自检脚本已生效）：{"Context":{"argv":{"probe":true}}}
//   写入：{"Context":{"argv":{"rows":[["5127367358271030036","JDVC37739141239","已退回京东仓"]],"allowWrite":true}}}
// 返回：{ scriptVersion, mode, sheet, beforeRows, written, rows, lastRow, readBack }
//
// 【粘贴方式】《退款检测文件》→ 效率 → 高级开发 → AirScript → 新建脚本「京东仓退货数据-写入」→ 粘全文 → 保存
//   → 给这个脚本生成「同步 webhook」→ 把地址填进本机 30号 project-config/kdocs-airscript.local.json。
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、比大小用减法、相等用长度对齐加互相包含。别改回去。

var 默认子表 = '京东仓退货数据'
var 表头行 = 1
var 数据起始行 = 表头行 + 1
var COLUMN_LIMIT = 'C'
var COLUMN_COUNT = 3
var CHUNK_ROWS = 500
var 最大行数 = 20000
var 默认退回值 = '已退回京东仓'
var 列名单 = ['A', 'B', 'C']

function contains(haystack, needle) {
  return Boolean(String(haystack).indexOf(needle) + 1)
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
    preview: preview
  }
}

function 取表() {
  return Application.Worksheets.Item(默认子表)
}

// 覆盖前守卫：第 1 行表头必须还是 销售平台单号｜逆向运单号｜是否退回——表结构变了就拒绝动手。
function 表头就位(sheet) {
  var a = toText(sheet.Range('A1').Value2)
  var b = toText(sheet.Range('B1').Value2)
  var c = toText(sheet.Range('C1').Value2)
  if (!contains(a, '单号')) return false
  if (!contains(b, '运单')) return false
  if (!contains(c, '退回')) return false
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

// 设文本格式：直接写字符串前先设 '@'，防大单号丢精度。失败不阻断（回读会暴露）。
function 设文本格式(sheet, 起行, 止行) {
  if (止行 - 起行 < 0) return false
  try {
    sheet.Range('A' + 起行 + ':C' + 止行).NumberFormatLocal = '@'
    return true
  } catch (errorFmt1) {
    try {
      sheet.Range('A' + 起行 + ':C' + 止行).NumberFormat = '@'
      return true
    } catch (errorFmt2) {
      return false
    }
  }
}

// 只清数据区（A2:C{原末行}），表头行不碰。
function 清数据区(sheet, 原末行) {
  if (原末行 - 数据起始行 < 0) return true
  try {
    sheet.Range('A' + 数据起始行 + ':C' + 原末行).ClearContents()
    return true
  } catch (errorClear1) {
    try {
      sheet.Range('A' + 数据起始行 + ':C' + 原末行).Value2 = ''
      return true
    } catch (errorClear2) {
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

function 规范行(行) {
  var 行数组 = 规整行(行)
  var 单号 = toText(行数组[0])
  var 运单 = toText(行数组[1])
  var 状态 = toText(行数组[2])
  if (!状态) 状态 = 默认退回值
  return [单号, 运单, 状态]
}

function 写单元格(sheet, 列, 行号, 值) {
  try {
    var 格 = sheet.Range(列 + 行号)
    try {
      格.NumberFormatLocal = '@'
    } catch (errorFormat1) {
      try {
        格.NumberFormat = '@'
      } catch (errorFormat2) {
        errorFormat2 = errorFormat2
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

// 回读：把 A:C 的值拼成 "单号 | 运单 | 状态" 文本数组。
function 读区块(sheet, 起行, 止行) {
  var 结果 = []
  if (止行 - 起行 < 0) return 结果
  var 值 = null
  try {
    值 = sheet.Range('A' + 起行 + ':C' + 止行).Value2
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

// 写完整片回读逐格比对（分块）：数出多少行对不上 + 首条差异。写完必查，内容对不对不靠肉眼。
function 回读比对(sheet, 数据) {
  var 不一致行数 = 0
  var 首条差异 = ''
  var 行下标 = 0
  while (行下标 - 数据.length < 0) {
    var 结束下标 = 行下标 + CHUNK_ROWS - 1
    if (结束下标 - (数据.length - 1) > 0) 结束下标 = 数据.length - 1
    var 值 = null
    try {
      值 = sheet.Range('A' + String(数据起始行 + 行下标) + ':C' + String(数据起始行 + 结束下标)).Value2
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
          if (!首条差异) 首条差异 = '第' + String(数据起始行 + 行下标 + i) + '行 期望[' + 期文 + '] 实际[' + 实文 + ']'
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

function 执行覆盖(参数) {
  var sheet = 取表()
  if (!表头就位(sheet)) {
    return { scriptVersion: scriptVersion, mode: 'overwrite', sheet: 默认子表, written: false, rows: 0, message: '第 1 行表头不是 销售平台单号｜逆向运单号｜是否退回，拒绝覆盖（防表结构变了误伤）' }
  }
  var 原末行 = 找数据末行(sheet)
  var 原有行数 = 原末行 - 数据起始行 + 1
  if (原有行数 < 0) 原有行数 = 0
  var 输入 = 参数.rows ? 参数.rows : []
  if (!参数.allowWrite) {
    return { scriptVersion: scriptVersion, mode: 'overwrite', sheet: 默认子表, beforeRows: 原有行数, written: false, rows: 0, message: '缺少 allowWrite:true，未授权写入' }
  }
  if (!输入.length) {
    return { scriptVersion: scriptVersion, mode: 'overwrite', sheet: 默认子表, beforeRows: 原有行数, written: false, rows: 0, message: 'rows 为空，拒绝执行（防误清空）' }
  }
  if (最大行数 - 输入.length < 0) {
    return { scriptVersion: scriptVersion, mode: 'overwrite', sheet: 默认子表, beforeRows: 原有行数, written: false, rows: 输入.length, message: 'rows 超过上限 ' + String(最大行数) + '，拒绝执行' }
  }

  var 数据 = []
  for (var i = 0; i - 输入.length < 0; i += 1) 数据.push(规范行(输入[i]))
  var 目标末行 = 数据起始行 + 数据.length - 1

  var 已清空 = 清数据区(sheet, 原末行)
  var 已设文本 = 设文本格式(sheet, 数据起始行, 目标末行)

  var 失败格数 = 0
  var 行下标 = 0
  while (行下标 - 数据.length < 0) {
    var 结束下标 = 行下标 + CHUNK_ROWS - 1
    if (结束下标 - (数据.length - 1) > 0) 结束下标 = 数据.length - 1
    var 块 = []
    for (var j = 行下标; j - 结束下标 < 1; j += 1) 块.push(数据[j])
    var 块起行 = 数据起始行 + 行下标
    var 块止行 = 数据起始行 + 结束下标
    var 写成 = false
    try {
      sheet.Range('A' + 块起行 + ':C' + 块止行).Value2 = 块
      写成 = true
    } catch (errorBlock) {
      写成 = false
    }
    if (!写成) {
      // 整片写失败 → 逐行逐格兜底（慢但能落）。
      for (var r = 行下标; r - 结束下标 < 1; r += 1) {
        var 行数值 = 数据[r]
        for (var c = 0; c - COLUMN_COUNT < 0; c += 1) {
          if (!写单元格(sheet, 列名单[c], 数据起始行 + r, 行数值[c])) 失败格数 = 失败格数 + 1
        }
      }
    }
    行下标 = 结束下标 + 1
  }

  var 比对 = 回读比对(sheet, 数据)

  var 回读 = []
  var 回读末行 = 数据起始行 + 数据.length - 1
  var 前几行 = 5
  if (数据.length - 前几行 < 0) 前几行 = 数据.length
  var 头部 = 读区块(sheet, 数据起始行, 数据起始行 + 前几行 - 1)
  for (var k = 0; k - 头部.length < 0; k += 1) 回读.push(头部[k])
  if (数据.length - 前几行 > 0) {
    var 尾巴 = 读区块(sheet, 回读末行, 回读末行)
    for (var m = 0; m - 尾巴.length < 0; m += 1) 回读.push('…末行：' + 尾巴[m])
  }

  return {
    scriptVersion: scriptVersion,
    mode: 'overwrite',
    sheet: 默认子表,
    beforeRows: 原有行数,
    cleared: 已清空,
    textFormat: 已设文本,
    written: (失败格数 ? false : true),
    rows: 数据.length,
    lastRow: 回读末行,
    failedCells: 失败格数,
    mismatchedRows: 比对.不一致行数,
    firstMismatch: 比对.首条差异,
    readBack: 回读
  }
}

function main() {
  var 参数 = 解析参数((Context && Context.argv) ? Context.argv : null)
  if (参数.probe) return 执行探针(参数)
  if (!参数.rows) return { scriptVersion: scriptVersion, mode: 'idle', written: false, message: '缺少 rows：没有要写入的数据，拒绝执行' }
  return 执行覆盖(参数)
}

return main()
