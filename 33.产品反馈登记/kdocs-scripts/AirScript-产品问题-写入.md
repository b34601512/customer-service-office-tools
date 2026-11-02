var scriptVersion = '2026-10-08.1'

// 《2026年【交接&跟进】表》「产品问题」子表 —— 表头初始化 + 追加写入（33号 产品反馈登记）。
//
// 【干什么】客服部→产品部反馈的产品问题，逐条登记进「产品问题」子表，后续人工更新「处理进度/处理结果」追踪进度。
//   本脚本只干三件事：① probe 只读探针；② 写表头（仅当整行表头为空时）；③ 追加写入 rows（第 2 行起，只追加、
//   绝不覆盖/清空已有行，表头行永远不碰）。
//
// 【动作】POST <本脚本同步 webhook>   Header: AirScript-Token: <token>   Body: {"Context":{"argv":{...}}}
//   探针（只读）   {"probe":true}
//   写表头         {"写表头":true,"allowWrite":true}           仅当 A1..I1 全空且 A 列没有数据行
//   预演（只读）   {"dryRun":true,"rows":[[9列]…],"expectedLastRow":0}
//   写入           {"rows":[[9列]…],"expectedLastRow":0,"allowWrite":true}
//   没有 allowWrite:true → 写动作一个字节都不写，只回报检查结果。
//
// 【安全设计（顺序不能改）】
//   1) 写表头：表头行必须整行空 + A 列没有数据行，否则拒绝（防改别人的表）；
//   2) 写入：表头必须与脚本里「表头」数组逐格一致（不一致就拒绝，防表结构变了误伤）；
//   3) 写入必须带 expectedLastRow：与当前 A 列数据末行不一致就拒绝（防重复导入/并发写入）；
//   4) 日期列（A/F）写前设文本格式 '@'，防被当日期序列号（2026/10/8 保持原样）；
//   5) 写完立刻回读逐格比对（mismatchedRows/firstMismatch），写没写对不靠肉眼；
//   6) 表头与回读一律防 #N/A：表头格逐格单格读（同文档 30号 教训：范围读碰 #N/A 会抛错、单格读不抛）；
//      回读先整块读，块读抛错自动改逐格单格读兜底。
//
// 【调用建议】写表头前先 probe；写入前先 dryRun，用 probe 的 lastRow 当 expectedLastRow。
// 【粘贴方式】打开《2026年【交接&跟进】表》→ 效率 → 高级开发 → AirScript 脚本编辑器 → 新建脚本
//   「产品问题-写入」→ 清空默认内容 → 粘全文 → 保存 → 脚本「更多」里复制「同步 webhook」→
//   填进本机 33号 project-config/kdocs-airscript.local.json 的 scripts.write_product_issue.webhookUrl。
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、字符串相等用等长 indexOf、比大小用减法。别改回去。
//   catch 里一律不碰错误对象（碰 .message 会二次抛错）。不用箭头函数、不用模板字符串。

var 默认子表 = '产品问题'
var 表头行 = 1
var 数据起始行 = 表头行 + 1
var 列数 = 9
var 列名单 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
var 表头 = ['登记日期', '反馈人', '产品型号', '问题描述', '反馈对象', '反馈日期', '处理进度', '处理结果', '备注']
var 日期列 = [1, 6]
var CHUNK_ROWS = 200
var 最大行数 = 20000
var 单批上限 = 200

function contains(haystack, needle) {
  return Boolean(String(haystack).indexOf(needle) + 1)
}

// 值 → 文本：Date 转 年/月/日；null/undefined/对象给空。
function 成文(值) {
  if (值 instanceof Date) {
    return String(值.getFullYear()) + '/' + String(值.getMonth() + 1) + '/' + String(值.getDate())
  }
  var 类 = typeof 值
  if (类.indexOf('object') + 1) return ''
  if (类.indexOf('undefined') + 1) return ''
  return String(值)
}

// 去首尾空白（含全角空格）。
function toText(值) {
  return 成文(值).replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '')
}

// 文本相等（不用成双等号）：等长 + indexOf。
function 同文(a, b) {
  var x = toText(a)
  var y = toText(b)
  if (x.length - y.length) return false
  if (!x) return true
  return Boolean(y.indexOf(x) + 1)
}

// Value2 归一成二维数组；单格/一维都兜底。
function 规整二维(值) {
  if (值 instanceof Array) {
    if (值.length && (值[0] instanceof Array)) return 值
    return [值]
  }
  return [[值]]
}

// argv 里的行实测有 3 种形态：真数组 / "a,b,c" 字符串 / 类数组对象。
function 规整行(行) {
  if (行 instanceof Array) return 行
  if (contains(typeof 行, 'string')) {
    var 拆 = String(行).split(',')
    if (拆.length - 1) return 拆
    return [行]
  }
  if (行 && contains(typeof 行.length, 'number')) {
    var 转 = []
    for (var i = 0; i - 行.length < 0; i += 1) 转.push(行[i])
    return 转
  }
  return [行]
}

// 单格读（catch 不碰错误对象；#N/A 单格读不抛错）：{ ok, 形, 值, 文本 }
function 读单格(sheet, 地址) {
  var 出 = { ok: false, 形: '读不到', 值: '', 文本: '' }
  var 读成 = false
  var 值 = null
  try {
    值 = sheet.Range(地址).Value2
    读成 = true
  } catch (错误值) {
    读成 = false
  }
  if (读成) {
    出.ok = true
    出.形 = 'Value2'
    出.值 = 成文(值)
  }
  var 文 = null
  try {
    文 = sheet.Range(地址).Text
  } catch (错误文) {
    文 = null
  }
  if (文) 出.文本 = 成文(文).slice(0, 30)
  if (!出.ok && 出.文本) {
    出.ok = true
    出.形 = 'Text'
    出.值 = 出.文本
  }
  return 出
}

// 表头现状（A1..I1 逐格单格读）：{ 就位, 空, 读不到数, 实际 }
function 表头现状(sheet) {
  var 实际 = []
  var 读不到数 = 0
  var 空 = true
  for (var i = 0; i - 列数 < 0; i += 1) {
    var 单 = 读单格(sheet, 列名单[i] + 表头行)
    if (!单.ok) {
      读不到数 += 1
      实际.push('(读不到)')
      空 = false
      continue
    }
    var 文 = toText(单.值)
    实际.push(文)
    if (文) 空 = false
  }
  var 就位 = true
  for (var j = 0; j - 表头.length < 0; j += 1) {
    if (!同文(实际[j], 表头[j])) 就位 = false
  }
  if (读不到数) 就位 = false
  return { 就位: 就位, 空: 空, 读不到数: 读不到数, 实际: 实际 }
}

// A 列数据末行：分块读；块读失败（撞 #N/A）改逐格单格读兜底。{ 末行, 读异常数, 异常格 }
function 找数据末行(sheet) {
  var 末行 = 0
  var 读异常数 = 0
  var 异常格 = ''
  var 行 = 数据起始行
  while (行 - 最大行数 < 1) {
    var 结束行 = 行 + CHUNK_ROWS - 1
    if (结束行 - 最大行数 > 0) 结束行 = 最大行数
    var 块 = null
    var 块成 = false
    try {
      块 = sheet.Range('A' + 行 + ':A' + 结束行).Value2
      块成 = true
    } catch (错误块) {
      块成 = false
    }
    if (块成) {
      var 表 = 规整二维(块)
      for (var i = 0; i - 表.length < 0; i += 1) {
        var 格 = (表[i] instanceof Array) ? 表[i][0] : 表[i]
        if (toText(格)) 末行 = 行 + i
      }
    } else {
      for (var k = 行; k - 结束行 < 1; k += 1) {
        var 单 = 读单格(sheet, 'A' + k)
        if (!单.ok) {
          读异常数 += 1
          if (!异常格) 异常格 = 'A' + k
          continue
        }
        if (toText(单.值)) 末行 = k
      }
    }
    行 = 结束行 + 1
  }
  return { 末行: 末行, 读异常数: 读异常数, 异常格: 异常格 }
}

// 设某列一段为文本格式（'@'）；失败不阻断，回读会暴露。
function 设列文本格式(sheet, 列号, 起行, 止行) {
  var 列 = 列名单[列号 - 1]
  var 区 = 列 + 起行 + ':' + 列 + 止行
  try {
    sheet.Range(区).NumberFormatLocal = '@'
    return true
  } catch (错误1) {
    try {
      sheet.Range(区).NumberFormat = '@'
      return true
    } catch (错误2) {
      return false
    }
  }
}

// 一行归一成 9 列文本。
function 规范行(一行) {
  var 数组 = 规整行(一行)
  var 出 = []
  for (var c = 1; c - 列数 < 1; c += 1) 出.push(toText(数组[c - 1]))
  return 出
}

// 回读 A:I 一块：整块读；块读抛错改逐格单格读兜底。{ 矩阵, 兜底, 读不到 }
function 回读矩阵(sheet, 起行, 止行) {
  var 块 = null
  var 块成 = false
  try {
    块 = sheet.Range('A' + 起行 + ':I' + 止行).Value2
    块成 = true
  } catch (错误块) {
    块成 = false
  }
  if (块成) {
    var 表 = 规整二维(块)
    var 出 = []
    for (var i = 0; i - 表.length < 0; i += 1) {
      var 行 = (表[i] instanceof Array) ? 表[i] : [表[i]]
      var 归一 = []
      for (var c = 0; c - 列数 < 0; c += 1) 归一.push(成文(行[c]))
      出.push(归一)
    }
    return { 矩阵: 出, 兜底: false, 读不到: 0 }
  }
  var 出2 = []
  var 读不到 = 0
  for (var r = 起行; r - 止行 < 1; r += 1) {
    var 行2 = []
    for (var c2 = 0; c2 - 列数 < 0; c2 += 1) {
      var 单 = 读单格(sheet, 列名单[c2] + r)
      if (!单.ok) 读不到 += 1
      行2.push(单.ok ? 单.值 : '(读不到)')
    }
    出2.push(行2)
  }
  return { 矩阵: 出2, 兜底: true, 读不到: 读不到 }
}

// 期望行表 vs 实际矩阵逐格比（文本归一后比）：{ 不一致行数, 首条差异, 前几行 }
function 比对矩阵(期望行表, 实际矩阵, 起始行) {
  var 不一致 = 0
  var 首条 = ''
  var 前几 = []
  for (var i = 0; i - 期望行表.length < 0; i += 1) {
    var 实 = (实际矩阵[i] instanceof Array) ? 实际矩阵[i] : [实际矩阵[i]]
    var 行文 = []
    for (var c = 0; c - 列数 < 0; c += 1) {
      var 实文 = toText(实[c])
      var 期文 = toText(期望行表[i][c])
      if (!同文(实文, 期文)) {
        不一致 += 1
        if (!首条) 首条 = '第' + String(起始行 + i) + '行 第' + String(c + 1) + '列 期望[' + 期文 + '] 实际[' + 实文 + ']'
      }
      行文.push(实文)
    }
    if (前几.length - 3 < 0) 前几.push(行文.join(' | ').slice(0, 240))
  }
  return { 不一致行数: 不一致, 首条差异: 首条, 前几行: 前几 }
}

function 解析参数(rawArgument) {
  var payload = rawArgument
  if (contains(typeof payload, 'string')) {
    try {
      payload = JSON.parse(String(payload))
    } catch (错误解) {
      payload = null
    }
  }
  var bag = payload
  if (bag instanceof Array) bag = bag[0] ? bag[0] : {}
  if (!bag) bag = {}
  var 有预期 = false
  var 预期 = 0
  if (contains(typeof bag.expectedLastRow, 'number')) {
    有预期 = true
    预期 = bag.expectedLastRow
  }
  return {
    rows: bag.rows ? bag.rows : null,
    allowWrite: bag.allowWrite ? true : false,
    probe: bag.probe ? true : false,
    dryRun: bag.dryRun ? true : false,
    写表头: bag.写表头 ? true : false,
    hasExpectedLastRow: 有预期,
    expectedLastRow: 预期
  }
}

function 取表() {
  return Application.Worksheets.Item(默认子表)
}

// 写入前的统一检查：表头 + 末行 + expectedLastRow + 行数。{ 通过, 原因, 行表, 现状, 末行, 起行 }
function 检查写入条件(参数, sheet) {
  var 现状 = 表头现状(sheet)
  var 末 = 找数据末行(sheet)
  var 行表 = []
  if (参数.rows) {
    for (var i = 0; i - 参数.rows.length < 0; i += 1) 行表.push(规范行(参数.rows[i]))
  }
  var 通过 = true
  var 原因 = '可以写入'
  if (现状.读不到数) {
    通过 = false
    原因 = '表头行有读不到的格（' + String(现状.读不到数) + ' 个），停下来问人，没动'
  } else if (现状.空) {
    通过 = false
    原因 = '表头行是空的：先跑「写表头」建好列头，再写入'
  } else if (!现状.就位) {
    通过 = false
    原因 = '表头与脚本定义不一致（实际：' + 现状.实际.join('｜') + '），拒绝写入'
  } else if (!行表.length) {
    通过 = false
    原因 = 'rows 是空的，拒绝写入'
  } else if (行表.length - 单批上限 > 0) {
    通过 = false
    原因 = 'rows 超过单批上限 ' + String(单批上限) + ' 行，请分批'
  } else if (!参数.hasExpectedLastRow) {
    通过 = false
    原因 = '缺少 expectedLastRow（先 probe 取当前末行，带上再写，防重复）'
  } else if (末.读异常数) {
    通过 = false
    原因 = 'A 列有读不到的格（' + 末.异常格 + ' 起），停下来问人，没动'
  } else if (末.末行 - 参数.expectedLastRow) {
    通过 = false
    原因 = '当前 A 列数据末行 ' + String(末.末行) + ' 与 expectedLastRow ' + String(参数.expectedLastRow) + ' 不一致，拒绝（防重复导入/并发写入）'
  }
  var 起行 = 末.末行 + 1
  if (起行 - 数据起始行 < 0) 起行 = 数据起始行
  return { 通过: 通过, 原因: 原因, 行表: 行表, 现状: 现状, 末行: 末.末行, 起行: 起行 }
}

// 写表头：仅当 A1..I1 全空且 A 列没有数据行；写后回读逐格比对。
function 执行写表头(参数) {
  var sheet = 取表()
  var 现状 = 表头现状(sheet)
  var 末 = 找数据末行(sheet)
  var 基础 = {
    scriptVersion: scriptVersion, mode: '写表头', sheet: 默认子表,
    headerOk: 现状.就位, headerEmpty: 现状.空, lastRow: 末.末行,
    表头读不到数: 现状.读不到数, 实际表头: 现状.实际, 将写表头: 表头
  }
  if (现状.读不到数) {
    基础.written = false
    基础.message = '表头行有 ' + String(现状.读不到数) + ' 个格读不到，停下来问人，没动'
    return 基础
  }
  if (!现状.空) {
    基础.written = false
    基础.message = '表头行不是空的，拒绝改写（现有内容见 实际表头）'
    return 基础
  }
  if (末.末行) {
    基础.written = false
    基础.message = 'A 列第 ' + String(末.末行) + ' 行有数据但表头为空，表形态怪，拒绝动手'
    return 基础
  }
  if (!参数.allowWrite) {
    基础.written = false
    基础.message = '缺少 allowWrite:true，未写'
    return 基础
  }
  var 块成 = false
  try {
    sheet.Range('A' + 表头行 + ':I' + 表头行).Value2 = [表头]
    块成 = true
  } catch (错误块) {
    块成 = false
  }
  var 失败格 = 0
  if (!块成) {
    for (var c = 0; c - 列数 < 0; c += 1) {
      var 成格 = false
      try {
        sheet.Range(列名单[c] + 表头行).Value2 = 表头[c]
        成格 = true
      } catch (错误格) {
        成格 = false
      }
      if (!成格) 失败格 += 1
    }
  }
  var 回读 = 回读矩阵(sheet, 表头行, 表头行)
  var 比对 = 比对矩阵([表头], 回读.矩阵, 表头行)
  基础.written = 失败格 ? false : true
  基础.失败格 = 失败格
  基础.回读差异数 = 比对.不一致行数
  基础.首条差异 = 比对.首条差异
  基础.回读 = 比对.前几行
  基础.message = (失败格 || 比对.不一致行数) ? '写完回读有差异，看 首条差异' : '表头已写入，回读一致'
  return 基础
}

// 预演：只读检查，报告将写什么；绝不写。
function 执行预演(参数) {
  var sheet = 取表()
  var 查 = 检查写入条件(参数, sheet)
  return {
    scriptVersion: scriptVersion, mode: 'dryRun', sheet: 默认子表,
    通过: 查.通过, 原因: 查.原因,
    表头就位: 查.现状.就位, 表头为空: 查.现状.空, 实际表头: 查.现状.实际,
    当前末行: 查.末行,
    预期末行: 参数.hasExpectedLastRow ? 参数.expectedLastRow : '(未传)',
    将写行数: 查.行表.length, 将写起始行: 查.起行,
    行预览: 查.行表.length ? 查.行表[0].join(' | ').slice(0, 240) : ''
  }
}

// 追加写入：只从「当前末行+1」往下写；写完回读逐格比对。
function 执行写入(参数) {
  var sheet = 取表()
  var 查 = 检查写入条件(参数, sheet)
  var 基础 = {
    scriptVersion: scriptVersion, mode: 'write', sheet: 默认子表,
    headerOk: 查.现状.就位, passed: 查.通过, lastRow: 查.末行,
    message: 查.原因
  }
  if (!查.通过) {
    基础.written = false
    基础.rows = 查.行表.length
    return 基础
  }
  if (!参数.allowWrite) {
    基础.written = false
    基础.rows = 查.行表.length
    基础.message = '缺少 allowWrite:true，未写'
    return 基础
  }
  var 起行 = 查.起行
  var 止行 = 起行 + 查.行表.length - 1
  var 格式失败 = 0
  for (var d = 0; d - 日期列.length < 0; d += 1) {
    if (!设列文本格式(sheet, 日期列[d], 起行, 止行)) 格式失败 += 1
  }
  var 块成 = false
  try {
    sheet.Range('A' + 起行 + ':I' + 止行).Value2 = 查.行表
    块成 = true
  } catch (错误块) {
    块成 = false
  }
  var 失败格 = 0
  if (!块成) {
    for (var r = 0; r - 查.行表.length < 0; r += 1) {
      for (var c = 0; c - 列数 < 0; c += 1) {
        var 成格 = false
        try {
          sheet.Range(列名单[c] + (起行 + r)).Value2 = 查.行表[r][c]
          成格 = true
        } catch (错误格) {
          成格 = false
        }
        if (!成格) 失败格 += 1
      }
    }
  }
  var 回读 = 回读矩阵(sheet, 起行, 止行)
  var 比对 = 比对矩阵(查.行表, 回读.矩阵, 起行)
  基础.written = 失败格 ? false : true
  基础.rows = 查.行表.length
  基础.firstRow = 起行
  基础.末行 = 止行
  基础.格式失败 = 格式失败
  基础.failedCells = 失败格
  基础.回读兜底 = 回读.兜底
  基础.回读读不到 = 回读.读不到
  基础.mismatchedRows = 比对.不一致行数
  基础.firstMismatch = 比对.首条差异
  基础.readBack = 比对.前几行
  基础.message = (失败格 || 比对.不一致行数) ? '写完回读不一致，看 firstMismatch' : '写入完成，回读一致'
  return 基础
}

function main() {
  var 参数 = 解析参数((Context && Context.argv) ? Context.argv : null)
  var sheet = null
  try {
    sheet = 取表()
  } catch (错误表) {
    sheet = null
  }
  if (!sheet) return { scriptVersion: scriptVersion, mode: 'error', message: '找不到子表 ' + 默认子表 }
  if (参数.probe) {
    var 现状 = 表头现状(sheet)
    var 末 = 找数据末行(sheet)
    var 数据行数 = 末.末行 - 数据起始行 + 1
    if (数据行数 - 0 < 0) 数据行数 = 0
    return {
      scriptVersion: scriptVersion, mode: 'probe', sheet: 默认子表,
      headerOk: 现状.就位, headerEmpty: 现状.空, 表头读不到数: 现状.读不到数,
      实际表头: 现状.实际,
      lastRow: 末.末行, dataRows: 数据行数, A列读不到数: 末.读异常数,
      message: 现状.读不到数 ? '表头格读不到，停下来问人'
        : (现状.空 ? '表头行是空的：先跑 写表头'
          : (现状.就位 ? '表头就位，数据末行 ' + String(末.末行)
            : '表头与脚本定义不一致，停下来问人'))
    }
  }
  if (参数.写表头) return 执行写表头(参数)
  if (参数.dryRun) return 执行预演(参数)
  return 执行写入(参数)
}

return main()
