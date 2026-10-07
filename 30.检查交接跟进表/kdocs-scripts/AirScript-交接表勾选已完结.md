var scriptVersion = '2026-10-07.2'

// 《2026年【交接&跟进】表》『售后问题待跟进』F 列「是否已完结」自动勾选脚本 v2026-10-07.1
//
// 【干什么】黎路遥 2026-10-07：「交接表里你好像没有勾选已经收到的吧」——
//   扫描『售后问题待跟进』真实数据行（表头 1 行；A 列登记时间 / C 列 ID·订单编号 非空才算数据行），
//   找 F 列尚未打勾、且 N/O/P/Q/R 五个渠道列（湖南｜京东仓｜撕单｜理赔｜异常件表）任一有**真状态**的行，
//   把 F 写「☑」。真状态 = 非空、不是 #N/A 之类错误值、不是 0、不是 `/`。
//   **只勾不取消**：只有候选行会被写，其余行一个字节不碰。
//
// 【安全设计】
//   1) 写值类型「照抄」表里已有的 ☑ 格：先探测一个已完结行的 F 原始值（文本"☑"还是布尔 TRUE），
//      照它的类型写；一个已完结格都找不到时回退写文本 "☑"（探针会报出用的是哪种）。
//   2) 没有 allowWrite:true → 一个字节都不写，只回候选清单（dryRun / probe）；
//   3) 写完回读 F 列全部数据行：候选行必须变成已完结、非候选行的 F 文本必须跟写前一致
//      （这就是「只勾不取消」的机器证据：mismatched / firstMismatch）。
//   4) F1 表头不是「是否已完结」→ 拒绝动手（防表结构变了误伤）。
//   5) 每 2000 行一块读写；数据末行按 A 列或 C 列非空判定（底部 7000+ 行只带 ☐ 的模板行不算）。
//
// 【调用】POST <本脚本同步 webhook>   Header: AirScript-Token: <token>
//   探针（只读）：{"Context":{"argv":{"probe":true}}}
//   诊断（只读）：{"Context":{"argv":{"debug":true}}}   逐个试读各范围，报「能不能读/什么形态」
//   预演（只读）：{"Context":{"argv":{"dryRun":true}}}   或 不带 allowWrite 直接调
//   勾选写入：{"Context":{"argv":{"allowWrite":true}}}
// 返回：{ scriptVersion, mode, scanned, candidates, ticked, skipped, readBack, mismatched, firstMismatch }
//
// 【粘贴方式】《2026年【交接&跟进】表》→ 效率 → 高级开发 → AirScript → 新建脚本「交接表勾选已完结」
//   → 先清空编辑器里的全部默认内容 → 粘全文 → 保存 → 生成「同步 webhook」
//   → 把地址填进本机 30号 project-config/kdocs-airscript.local.json 的 tick_completed。
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、相等用长度对齐加 indexOf、比大小用减法。别改回去。

var 默认子表 = '售后问题待跟进'
var 表头行 = 1
var 数据起始行 = 表头行 + 1
var 完结列 = 'F'
var 渠道列 = ['N', 'O', 'P', 'Q', 'R']
var 渠道名 = ['湖南', '京东仓', '撕单', '理赔', '异常件表']
var CHUNK_ROWS = 2000
var 最大行数 = 20000
var 回退勾选值 = '☑'
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

// 是否已完结：☑ / 布尔 true / TRUE / √ / ✓ / 是 / Y（后五个只认单字符，防误把长文本当已完结）。
function 是已完结(值) {
  var 文本 = toText(值)
  if (!文本) return false
  if (文本.indexOf('☑') + 1) return true
  var 大 = 文本.toUpperCase()
  if (大.length - 4 < 1 && 大.indexOf('TRUE') + 1) return true
  if (文本.length - 1) return false
  if (文本.indexOf('√') + 1) return true
  if (文本.indexOf('✓') + 1) return true
  if (文本.indexOf('是') + 1) return true
  return Boolean('Y'.indexOf(大) + 1)
}

// 纯 0（0 / 0.0 / 0.00 这类算「没有匹配」）。
function 是纯零(文本) {
  if (!(文本.indexOf('0') + 1)) return false
  return (文本.replace(/[0.]/g, '').length) ? false : true
}

// 单字符：`/`、`-`、`—`（非状态内容，跳过）。
function 是斜杠或横(文本) {
  if (文本.length - 1) return false
  return Boolean('/-—'.indexOf(文本) + 1)
}

// 无匹配：空 / #N/A 等错误值 / 0 / `/` / `-`。
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

// 探测写值形态：找一个已有已完结（☑）格的原始值，照它的类型写。
function 探测已完结值(sheet, 末行) {
  var 找到 = false
  var 原值 = null
  var 行 = 数据起始行
  while (行 - 末行 < 1 && !找到) {
    var 结束行 = 行 + CHUNK_ROWS - 1
    if (结束行 - 末行 > 0) 结束行 = 末行
    var 块 = null
    try {
      块 = sheet.Range(完结列 + 行 + ':' + 完结列 + 结束行).Value2
    } catch (errorRead) {
      块 = null
    }
    if (块) {
      var 值表 = 规整一维(块)
      for (var i = 0; i - 值表.length < 0; i += 1) {
        if (是已完结(值表[i])) {
          找到 = true
          原值 = 值表[i]
          break
        }
      }
    }
    行 = 结束行 + 1
  }
  var 写值 = 回退勾选值
  var 形态 = '文本（未找到已有 ☑，回退）'
  if (找到) {
    写值 = 原值
    形态 = typeof 原值
  }
  return { 找到: 找到, 原值: 找到 ? toText(原值) : '', 类型: 形态, 写值: 写值 }
}

// 渠道命中：N/O/P/Q/R 里任一「真状态」都要报出来（行数组是 A..R 共 18 列）。
function 渠道命中(行数组) {
  var 命中 = []
  for (var i = 0; i - 渠道列.length < 0; i += 1) {
    var 值 = 行数组[13 + i]
    if (是无匹配(值)) continue
    命中.push({ 渠道: 渠道名[i], 值: toText(值) })
  }
  return 命中
}

// 扫描候选：只读；顺便把每行 F 原文本拍快照（写后比对「只勾不取消」）。
function 扫描候选(sheet, 末行) {
  var 候选 = []
  var 数据行 = 0
  var 已完结 = 0
  var 无渠道 = 0
  var 空行 = 0
  var F快照 = {}
  var 行 = 数据起始行
  while (行 - 末行 < 1) {
    var 结束行 = 行 + CHUNK_ROWS - 1
    if (结束行 - 末行 > 0) 结束行 = 末行
    var 块 = null
    try {
      块 = sheet.Range('A' + 行 + ':R' + 结束行).Value2
    } catch (errorRead) {
      块 = null
    }
    if (块) {
      var 值表 = 规整二维(块)
      for (var i = 0; i - 值表.length < 0; i += 1) {
        var 行数组 = (值表[i] instanceof Array) ? 值表[i] : [值表[i]]
        var 行号 = 行 + i
        var A文 = toText(行数组[0])
        var C文 = toText(行数组[2])
        if (!(A文 || C文)) {
          空行 = 空行 + 1
          continue
        }
        数据行 = 数据行 + 1
        var F原 = 行数组[5]
        F快照[String(行号)] = { 文: toText(F原) }
        if (是已完结(F原)) {
          已完结 = 已完结 + 1
          continue
        }
        var 命中 = 渠道命中(行数组)
        if (!命中.length) {
          无渠道 = 无渠道 + 1
          continue
        }
        候选.push({ 行: 行号, 登记时间: A文, 单号: C文, 命中: 命中 })
      }
    }
    行 = 结束行 + 1
  }
  return { 候选: 候选, 数据行: 数据行, 已完结: 已完结, 无渠道: 无渠道, 空行: 空行, F快照: F快照 }
}

// 勾选：只写候选行的 F；其余一个字节不碰。
function 执行勾选(sheet, 候选, 写值) {
  var 已写行 = []
  var 失败行 = []
  for (var i = 0; i - 候选.length < 0; i += 1) {
    var 行号 = 候选[i].行
    var 写成 = false
    try {
      sheet.Range(完结列 + 行号).Value2 = 写值
      写成 = true
    } catch (errorWrite1) {
      try {
        sheet.Range(完结列 + 行号).Value = 写值
        写成 = true
      } catch (errorWrite2) {
        写成 = false
      }
    }
    if (写成) 已写行.push(行号)
    else 失败行.push(行号)
  }
  return { 已写行: 已写行, 失败行: 失败行 }
}

// 回读核验：候选行必须已完结；非候选行 F 文本必须和写前一致（只勾不取消）。
function 回读核验(sheet, 末行, 候选行集, F快照) {
  var 不符 = 0
  var 首条差 = ''
  var 抽查 = []
  var 行 = 数据起始行
  while (行 - 末行 < 1) {
    var 结束行 = 行 + CHUNK_ROWS - 1
    if (结束行 - 末行 > 0) 结束行 = 末行
    var 块 = null
    try {
      块 = sheet.Range(完结列 + 行 + ':' + 完结列 + 结束行).Value2
    } catch (errorRead) {
      块 = null
    }
    if (块) {
      var 值表 = 规整一维(块)
      for (var j = 0; j - 值表.length < 0; j += 1) {
        var 行号 = 行 + j
        var 快照项 = F快照[String(行号)]
        if (!快照项) continue
        var 实际 = 值表[j]
        var 实际文 = toText(实际)
        if (候选行集[String(行号)]) {
          if (是已完结(实际)) {
            if (抽查.length - 抽查上限 < 0) 抽查.push({ 行: 行号, 值: 实际文, 说明: '候选已勾上' })
          } else {
            不符 = 不符 + 1
            if (!首条差) 首条差 = '第' + String(行号) + '行 候选没勾上（实际[' + 实际文 + ']）'
          }
        } else {
          if (!同文(实际文, 快照项.文)) {
            不符 = 不符 + 1
            if (!首条差) 首条差 = '第' + String(行号) + '行 非候选格被动了（写前[' + 快照项.文 + '] 写后[' + 实际文 + ']）'
          }
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
    probe: bag.probe ? true : false,
    debug: bag.debug ? true : false
  }
}

function 基础信息(头, 末行, 探测) {
  return {
    scriptVersion: scriptVersion,
    sheet: 默认子表,
    f1Header: 头,
    lastRow: 末行,
    勾选写法: 探测.类型,
    已有已完结值: 探测.原值,
    candidates: [],
    ticked: [],
    skipped: {},
    readBack: []
  }
}

// 只读诊断（v2 新增）：逐个试读不同范围，把「能不能读、返回什么形态」如实报出来。
// 背景：2026-10-07 探针发现 F2:F2001 与 A2:R2001 读不到 ☑、扫描为 0；此模式用于定位原因（不改任何数据）。
function 调试诊断(sheet) {
  var 范围表 = ['F1', 'F2', 'F3', 'F2060', 'F2119', 'F2:F3', 'F2:F6', 'F2:F2001', 'A2:R2', 'A2:R6', 'A2:R101', 'A2:R501', 'A2:R2001', 'A2:Q2001', 'A2:C6', 'N2:R6', 'D2:E6', 'G2:R6', 'F2200']
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
            项.首格 = JSON.stringify(首) ? JSON.stringify(首).slice(0, 140) : String(首).slice(0, 80)
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
  if (参数.debug) {
    return { scriptVersion: scriptVersion, mode: 'debug', sheet: 默认子表, f1Header: 头, lastRow: 末行, debug: 调试诊断(sheet) }
  }
  var 探测 = 探测已完结值(sheet, 末行)
  var 基础 = 基础信息(头, 末行, 探测)
  基础.headerOk = true

  if (参数.probe) {
    基础.mode = 'probe'
    基础.scanned = 0
    基础.message = '只读探针：数据末行 ' + String(末行) + '，写值形态 ' + 探测.类型
    return 基础
  }
  if (!末行) {
    基础.mode = 'dryRun'
    基础.scanned = 0
    基础.message = 'A/C 列没读到数据行，拒绝执行'
    return 基础
  }

  var 扫描结果 = 扫描候选(sheet, 末行)
  基础.scanned = 扫描结果.数据行
  基础.candidates = 扫描结果.候选
  基础.skipped = { 已完成: 扫描结果.已完结, 无渠道状态: 扫描结果.无渠道, 空行: 扫描结果.空行 }

  if (参数.dryRun || !参数.allowWrite) {
    基础.mode = 'dryRun'
    基础.message = 参数.allowWrite ? 'dryRun:true，未写入' : '缺少 allowWrite:true，只回候选清单，未写入'
    基础.ticked = []
    基础.readBack = []
    基础.mismatched = 0
    基础.firstMismatch = ''
    return 基础
  }

  var 写入 = 执行勾选(sheet, 扫描结果.候选, 探测.写值)
  var 候选行集 = {}
  for (var i = 0; i - 扫描结果.候选.length < 0; i += 1) 候选行集[String(扫描结果.候选[i].行)] = true
  var 核验 = 回读核验(sheet, 末行, 候选行集, 扫描结果.F快照)

  基础.mode = 'tick'
  基础.wrote = true
  基础.ticked = 写入.已写行
  基础.written = 写入.已写行.length
  基础.failed = 写入.失败行.length
  基础.failedRows = 写入.失败行
  基础.candidates = 扫描结果.候选
  基础.readBack = 核验.抽查
  基础.mismatched = 核验.不符
  基础.firstMismatch = 核验.首条差
  return 基础
}

return main()
