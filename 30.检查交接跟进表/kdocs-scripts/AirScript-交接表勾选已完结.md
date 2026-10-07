// 《2026年【交接&跟进】表》『售后问题待跟进』F 列勾选已完结 —— AirScript（v2026-10-07.3）
//
// 【2026-10-07 为什么重写】F 列的勾是**复选框控件**（用户确认），不是单元格文本：
//   · Range.Value2 读不到它们（探针扫 F2:F2001 一个 ☑ 都没有；A2:R2001 还整块读空）。
//   · 官方文档（airsheet.wps.cn）：复选框用 Shape 控件 API ——
//     sheet.Shapes → Item(i).FormControlType == xlCheckBox(1) → Item(i).ControlFormat.Value 读写（true=勾）；
//     行位置用 Item(i).TopLeftCell.Row（本表复选框按行有序时 = 序号 + 行偏移，脚本会先取样验证）。
//
// 【功能】
//   1) debug（只读）：报数据末行 + 取样探控件（名字/类型/控件类型/值/行）+ F 列 Value2 试读。
//   2) dryRun（只读）：扫『售后问题待跟进』渠道列 N/O/P/Q/R（A:E + G:R 分开读，避开 F 控件区），
//      找出「有真状态（非空、不是 #N/A 类错误、不是 0、不是 /）且复选框没勾」的行 → 候选清单（不写）。
//   3) allowWrite（写）：把候选行的复选框 ControlFormat.Value 写 true，写完逐个回读；只勾不取消。
//   4) 找不到复选框控件 / F1 表头不对 → 拒绝动手，报 message。
//
// 【调用】POST <本脚本同步 webhook>   Header: AirScript-Token: <token>
//   探针（只读）：{"Context":{"argv":{"probe":true}}}
//   诊断（只读）：{"Context":{"argv":{"debug":true}}}
//   预演（只读）：{"Context":{"argv":{"dryRun":true}}}
//   勾选写入：{"Context":{"argv":{"allowWrite":true}}}
// 返回：{ scriptVersion, mode, sheet, f1Header, lastRow, 控件:{数,有序,行偏移,取样}, scanned, candidates, ticked, skipped, readBack, mismatched, firstMismatch, message }
//
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、相等用长度对齐加 indexOf、比大小用减法。别改回去。

var scriptVersion = '2026-10-07.3'
var 默认子表 = '售后问题待跟进'
var 表头行 = 1
var 数据起始行 = 表头行 + 1
var 完结列 = 'F'
var 渠道列 = ['N', 'O', 'P', 'Q', 'R']
var 渠道名 = ['湖南', '京东仓', '撕单', '理赔', '异常件表']
var CHUNK_ROWS = 2000      // 找数据末行用（A:C 分块，已验证可用）
var 扫描块行数 = 500       // 扫候选用（A:E + G:R 分开读，避开 F 控件区）
var 最大行数 = 20000
var 最大图形数 = 20000
var 控件取样步长 = 250
var 抽查上限 = 30

function contains(haystack, needle) {
  return Boolean(String(haystack).indexOf(needle) + 1)
}

// 显示/比较用文本：掐头去尾空白（不用成双等号）。
function toText(value) {
  if (!value) return ''
  if (value instanceof Date) {
    return String(value.getFullYear()) + '/' + String(value.getMonth() + 1) + '/' + String(value.getDate())
  }
  return String(value).replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '')
}

// 文本相等（不用成双等号）。
function 同文(a, b) {
  var 甲 = String(a)
  var 乙 = String(b)
  if (甲.length - 乙.length) return false
  if (!甲) return true
  return Boolean(乙.indexOf(甲) + 1)
}

// 纯 0（0 / 0.0 / 0.00 这类算「没有匹配」）。
function 是纯零(文本) {
  if (!(文本.indexOf('0') + 1)) return false
  return (文本.replace(/[0.]/g, '').length) ? false : true
}

// 单字符：/、-、—（非状态内容，跳过）。
function 是斜杠或横(文本) {
  if (文本.length - 1) return false
  return Boolean('/-—'.indexOf(文本) + 1)
}

// 无匹配：空 / #N/A 等错误值 / 0 / / / -。
function 是无匹配(值) {
  var 文本 = toText(值)
  if (!文本) return true
  if (('#').indexOf(文本.charAt(0)) + 1) return true
  if (是纯零(文本)) return true
  if (是斜杠或横(文本)) return true
  return false
}

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

function 规整二维(值) {
  if (值 instanceof Array) {
    if (值[0] instanceof Array) return 值
    return [值]
  }
  return [[值]]
}

// 数据末行：A（登记时间）或 C（ID/订单编号）非空的最后一行；0 = 没有数据行。
function 找数据末行(sheet) {
  var 末行 = 0
  var 行 = 数据起始行
  while (行 - 最大行数 < 1) {
    var 结束行 = 行 + CHUNK_ROWS - 1
    if (结束行 - 最大行数 > 0) 结束行 = 最大行数
    var 块 = null
    try {
      块 = sheet.Range('A' + 行 + ':C' + 结束行).Value2
    } catch (errorRead) {
      块 = null
    }
    if (块) {
      var 值表 = 规整二维(块)
      for (var i = 0; i - 值表.length < 0; i += 1) {
        var 行数组 = (值表[i] instanceof Array) ? 值表[i] : [值表[i]]
        var a = toText(行数组[0])
        var c = toText(行数组[2])
        if (a || c) 末行 = 行 + i
      }
    }
    行 = 结束行 + 1
  }
  return 末行
}

// ============ 复选框控件（官方 Shape/ControlFormat API） ============

// 控件值判定：true / 1 / TRUE 算「勾」；false / 0 / -4146 / 空 算「空」；其它报「未知」。
function 控件值判定(值) {
  var 类 = typeof 值
  if (类.indexOf('boolean') + 1) return 值 ? '勾' : '空'
  var 文本 = toText(值)
  if (!文本) return '空'
  var 大 = 文本.toUpperCase()
  if (大.indexOf('TRUE') + 1) return '勾'
  if (大.indexOf('FALSE') + 1) return '空'
  if (文本.indexOf('-4146') + 1) return '空'
  if (文本.indexOf('1') + 1 && 文本.length - 1 < 1) return '勾'
  if (文本.indexOf('0') + 1 && 文本.length - 1 < 1) return '空'
  return '未知[' + 文本.slice(0, 24) + ']'
}

// 取样探控件：确认是复选框控件 + 按行有序（第 i 个控件 → 第 i + 行偏移 行）。
function 探控件(sheet) {
  var 结果 = { 数: 0, 有序: false, 行偏移: 0, 取样: [], 异常: '' }
  var shapes = null
  try { shapes = sheet.Shapes } catch (e1) { 结果.异常 = '取 Shapes 失败：' + String(e1).slice(0, 80); return 结果 }
  if (!shapes) { 结果.异常 = '工作表没有 Shapes 集合'; return 结果 }
  try { 结果.数 = shapes.Count } catch (e2) { 结果.异常 = '读 Shapes.Count 失败：' + String(e2).slice(0, 80); return 结果 }
  if (!结果.数) { 结果.异常 = 'Shapes 数量为 0'; return 结果 }
  var 序 = []
  var i = 1
  while (i - 结果.数 < 1) {
    序.push(i)
    i += 控件取样步长
  }
  if (结果.数 - 序[序.length - 1] > 0) 序.push(结果.数)
  for (var k = 0; k - 序.length < 0; k += 1) {
    var 项 = { i: 序[k] }
    try {
      var sh = shapes.Item(序[k])
      try { 项.名 = String(sh.Name).slice(0, 30) } catch (e3) { 项.名 = '' }
      try { 项.类型 = String(sh.Type) } catch (e4) { 项.类型 = '' }
      try { 项.控件类型 = String(sh.FormControlType) } catch (e5) { 项.控件类型 = '' }
      try { 项.值 = String(sh.ControlFormat.Value) } catch (e6) { 项.值 = '' }
      try { 项.行 = String(sh.TopLeftCell.Row) } catch (e7) { 项.行 = '' }
    } catch (e8) { 项.异常 = String(e8).slice(0, 80) }
    结果.取样.push(项)
  }
  var 偏移 = 0
  var 首偏移已记 = false
  var 有序 = true
  var 复选数 = 0
  for (var m = 0; m - 结果.取样.length < 0; m += 1) {
    var s = 结果.取样[m]
    if (s.控件类型.indexOf('1') + 1 && s.控件类型.length - 1 < 1) 复选数 += 1
    if (!s.行) { 有序 = false; continue }
    var d = Number(s.行) - s.i
    if (!首偏移已记) { 偏移 = d; 首偏移已记 = true }
    else if (偏移 - d) 有序 = false
  }
  结果.有序 = 有序
  结果.行偏移 = 首偏移已记 ? 偏移 : 0
  结果.取样复选框数 = 复选数
  return 结果
}

// 读某行复选框状态（有序映射：控件序号 = 行号 - 行偏移）。
function 控件状态(sheet, 行号, 行偏移) {
  try {
    var sh = sheet.Shapes.Item(行号 - 行偏移)
    var 判 = 控件值判定(sh.ControlFormat.Value)
    return { ok: true, 判: 判, 值: String(sh.ControlFormat.Value) }
  } catch (e) {
    return { ok: false, 判: '读不到', 值: String(e).slice(0, 80) }
  }
}

// 勾选某行复选框（有序映射）。
function 勾选控件(sheet, 行号, 行偏移) {
  try {
    sheet.Shapes.Item(行号 - 行偏移).ControlFormat.Value = true
    return { ok: true }
  } catch (e1) {
    try {
      sheet.Shapes.Item(行号 - 行偏移).ControlFormat.Value = 1
      return { ok: true, 回退: '数字1' }
    } catch (e2) {
      return { ok: false, 错: String(e2).slice(0, 80) }
    }
  }
}

// 渠道命中：N/O/P/Q/R 里任一「真状态」（行数组 A..R 共 18 列，F 占位 null 在 index 5）。
function 渠道命中(行数组) {
  var 命中 = []
  for (var i = 0; i - 渠道列.length < 0; i += 1) {
    var 值 = 行数组[13 + i]
    if (是无匹配(值)) continue
    命中.push({ 渠道: 渠道名[i], 值: toText(值) })
  }
  return 命中
}

// 扫候选：A:E + G:R 分开读（避开 F 控件区），渠道有真状态且复选框未勾 → 候选。
function 扫候选(sheet, 末行, 行偏移) {
  var 候选 = []
  var 数据行 = 0
  var 已勾数 = 0
  var 无渠道 = 0
  var 空行 = 0
  var 读不到数 = 0
  var 读异常 = []
  var 行 = 数据起始行
  while (行 - 末行 < 1) {
    var 结束行 = 行 + 扫描块行数 - 1
    if (结束行 - 末行 > 0) 结束行 = 末行
    var 前块 = null
    var 后块 = null
    try { 前块 = sheet.Range('A' + 行 + ':E' + 结束行).Value2 } catch (e1) { 前块 = null }
    try { 后块 = sheet.Range('G' + 行 + ':R' + 结束行).Value2 } catch (e2) { 后块 = null }
    if (!前块 || !后块) {
      读异常.push(String(行) + '-' + String(结束行) + (前块 ? '' : '(A:E读不到)') + (后块 ? '' : '(G:R读不到)'))
      行 = 结束行 + 1
      continue
    }
    var 前表 = 规整二维(前块)
    var 后表 = 规整二维(后块)
    var 行数 = 前表.length
    if (后表.length - 行数 < 0) 行数 = 后表.length
    for (var i = 0; i - 行数 < 0; i += 1) {
      var 前行 = (前表[i] instanceof Array) ? 前表[i] : [前表[i]]
      var 后行 = (后表[i] instanceof Array) ? 后表[i] : [后表[i]]
      var 行数组 = []
      var c = 0
      while (c - 5 < 0) { 行数组.push(前行[c]); c += 1 }
      行数组.push(null)
      c = 0
      while (c - 后行.length < 0) { 行数组.push(后行[c]); c += 1 }
      var 行号 = 行 + i
      var A文 = toText(行数组[0])
      var C文 = toText(行数组[2])
      if (!(A文 || C文)) { 空行 += 1; continue }
      数据行 += 1
      var 命中 = 渠道命中(行数组)
      if (!命中.length) { 无渠道 += 1; continue }
      var 状 = 控件状态(sheet, 行号, 行偏移)
      if (!状.ok) { 读不到数 += 1; 读异常.push('第' + String(行号) + '行控件：' + 状.值); continue }
      if (状.判.indexOf('勾') + 1 && !(状.判.indexOf('未知') + 1)) { 已勾数 += 1; continue }
      候选.push({ 行: 行号, 登记时间: A文, 单号: C文, 命中: 命中, 现判: 状.判, 现值: 状.值 })
    }
    行 = 结束行 + 1
  }
  return { 候选: 候选, 数据行: 数据行, 已勾数: 已勾数, 无渠道: 无渠道, 空行: 空行, 读不到数: 读不到数, 读异常: 读异常 }
}

// 回读核验：候选行复选框必须已勾；非候选不碰（不读不回写）。
function 回读核验(sheet, 候选, 行偏移) {
  var 不符 = 0
  var 首条差 = ''
  var 抽查 = []
  for (var i = 0; i - 候选.length < 0; i += 1) {
    var 行号 = 候选[i].行
    var 状 = 控件状态(sheet, 行号, 行偏移)
    if (状.ok && (状.判.indexOf('勾') + 1) && !(状.判.indexOf('未知') + 1)) {
      if (抽查.length - 抽查上限 < 0) 抽查.push({ 行: 行号, 值: 状.值, 说明: '已勾上' })
    } else {
      不符 += 1
      if (!首条差) 首条差 = '第' + String(行号) + '行 候选没勾上（实际[' + 状.值 + '] ' + 状.判 + '）'
    }
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
    probe: bag.probe ? true : false,
    debug: bag.debug ? true : false
  }
}

// 只读诊断：逐个试读不同范围，把「能不能读、返回什么形态」如实报出来。
function 调试诊断(sheet) {
  var 范围表 = ['F1', 'F2', 'F3', 'F2060', 'F2119', 'F2:F3', 'F2:F6', 'F2:F2001', 'A2:R2', 'A2:R6', 'A2:R101', 'A2:R501', 'A2:R2001', 'A2:C6', 'A2:E6', 'G2:R6', 'N2:R6', 'D2:E6']
  var 结果 = []
  for (var i = 0; i - 范围表.length < 0; i += 1) {
    var 范围 = 范围表[i]
    var 项 = { 范围: 范围 }
    var 块 = null
    try {
      块 = sheet.Range(范围).Value2
    } catch (错误读) {
      项.异常 = String(错误读 && 错误读.message ? 错误读.message : 错误读).slice(0, 160)
    }
    if (!项.异常) {
      项.类型 = typeof 块
      项.是数组 = (块 instanceof Array) ? true : false
      if (块) {
        try { 项.长度 = 块.length } catch (错误长) { 项.长度 = '读不到' }
        try {
          var 首 = 块[0]
          项.首格类型 = typeof 首
          项.首格是数组 = (首 instanceof Array) ? true : false
          if (首 instanceof Array) {
            项.首格 = JSON.stringify(首).slice(0, 140)
          } else {
            项.首格 = String(首).slice(0, 80)
          }
        } catch (错误首) { 项.首格 = '读不到：' + String(错误首).slice(0, 80) }
      } else {
        项.空值 = String(块)
      }
    }
    结果.push(项)
  }
  return 结果
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
    var 头值 = sheet.Range('F1').Value2
    头 = 头值 ? String(头值) : ''
  } catch (errorHead) {
    头 = ''
  }
  if (!contains(头, '完结')) {
    return { scriptVersion: scriptVersion, mode: 'error', sheet: 默认子表, f1Header: 头, headerOk: false, message: 'F1 表头不是「是否已完结」（读到：' + 头 + '），拒绝动手（防表结构变了误伤）' }
  }
  var 末行 = 找数据末行(sheet)
  var 控件 = 探控件(sheet)

  if (参数.probe) {
    return {
      scriptVersion: scriptVersion, mode: 'probe', sheet: 默认子表, f1Header: 头, headerOk: true,
      lastRow: 末行, 控件: 控件, scanned: 0, candidates: [], ticked: [], skipped: {}, readBack: [],
      message: '只读探针：数据末行 ' + String(末行) + '，Shapes ' + String(控件.数) + ' 个，有序=' + String(控件.有序) + '，行偏移=' + String(控件.行偏移)
    }
  }
  if (参数.debug) {
    return {
      scriptVersion: scriptVersion, mode: 'debug', sheet: 默认子表, f1Header: 头, headerOk: true,
      lastRow: 末行, 控件: 控件, F读探针: 调试诊断(sheet)
    }
  }
  if (!末行) {
    return { scriptVersion: scriptVersion, mode: 'dryRun', sheet: 默认子表, f1Header: 头, headerOk: true, lastRow: 0, 控件: 控件, scanned: 0, candidates: [], message: 'A/C 列没读到数据行，拒绝执行' }
  }
  if (!控件.数) {
    return { scriptVersion: scriptVersion, mode: 'error', sheet: 默认子表, f1Header: 头, headerOk: true, lastRow: 末行, 控件: 控件, message: '没找到复选框控件（Shapes 为空或读不到）：' + 控件.异常 }
  }
  if (!控件.有序) {
    return { scriptVersion: scriptVersion, mode: 'error', sheet: 默认子表, f1Header: 头, headerOk: true, lastRow: 末行, 控件: 控件, message: '复选框控件不是按行有序（取样验证失败），先别写：请把 debug 结果发给木婉清看' }
  }

  var 扫描结果 = 扫候选(sheet, 末行, 控件.行偏移)
  var 基础 = {
    scriptVersion: scriptVersion, sheet: 默认子表, f1Header: 头, headerOk: true, lastRow: 末行,
    控件: { 数: 控件.数, 有序: 控件.有序, 行偏移: 控件.行偏移, 取样: 控件.取样 },
    scanned: 扫描结果.数据行,
    candidates: 扫描结果.候选,
    skipped: { 已勾过: 扫描结果.已勾数, 无渠道状态: 扫描结果.无渠道, 空行: 扫描结果.空行, 控件读不到: 扫描结果.读不到数 },
    readBack: []
  }
  if (扫描结果.读异常.length) 基础.读异常 = 扫描结果.读异常.slice(0, 20)

  if (参数.dryRun || !参数.allowWrite) {
    基础.mode = 'dryRun'
    基础.message = 参数.allowWrite ? 'dryRun:true，未写入' : '缺少 allowWrite:true，只回候选清单，未写入'
    基础.ticked = []
    基础.mismatched = 0
    基础.firstMismatch = ''
    return 基础
  }

  // ===== 写入 =====
  var 已写 = []
  var 失败 = []
  for (var i = 0; i - 扫描结果.候选.length < 0; i += 1) {
    var 行号 = 扫描结果.候选[i].行
    var 写 = 勾选控件(sheet, 行号, 控件.行偏移)
    if (写.ok) 已写.push(行号)
    else 失败.push(行号 + '：' + 写.错)
  }
  var 核验 = 回读核验(sheet, 扫描结果.候选, 控件.行偏移)
  基础.mode = 'tick'
  基础.wrote = true
  基础.ticked = 已写
  基础.written = 已写.length
  基础.failed = 失败.length
  基础.failedRows = 失败.slice(0, 20)
  基础.readBack = 核验.抽查
  基础.mismatched = 核验.不符
  基础.firstMismatch = 核验.首条差
  return 基础
}

return main()
