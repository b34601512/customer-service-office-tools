// 《2026年【交接&跟进】表》『售后问题待跟进』F 列勾选已完结 —— AirScript（v2026-10-07.5）
//
// 【2026-10-07 实测结论·别推翻】
//   1) F 列的勾是**单元格复选框**：格值 = 数字 1（勾）/ 0（未勾），文本 = ☑ / ☐；单格、F 列块读都正常；
//      **写 Value2 = 1 就能勾上**（写试实锤：0→写1→回读1☑→还原0→回读0☐）。
//   2) **G..R 列的任何范围读都会抛错**（G2:R101、A2:R2 连 1 行都读不到；A:E 与 F 列正常）。
//      ⇒ 读数据避开 G..R：行基础信息读 A:E；渠道状态读 N..R 的**单格**（候选行复核）；自检时读 N..R 的**单列**。
//   3) catch 里**一律不碰错误对象**（碰 .message 会二次抛错把脚本弄崩 → 网关 "exchange response missing data"）。
//
// 【模式】POST <本脚本同步 webhook>   Header: AirScript-Token: <token>
//   {"Context":{"argv":{"probe":true}}}                        只读探针：版本 + 数据末行
//   {"Context":{"argv":{"试":"单格读"}}}                       只读小测（见下），一次只干一件事，崩也只崩这一测
//   {"Context":{"argv":{"dryRun":true}}}                       只读预演：自检候选（未勾 ∩ 渠道有真状态）
//   {"Context":{"argv":{"dryRun":true,"候选行":[1319,...]}}}   只读预演（指定行版；渠道状态读不到也照跑，标 渠道读不到）
//   {"Context":{"argv":{"allowWrite":true, ...同 dryRun}}}     真写：把候选行 F 写成 1 + 回读
//   试名：单格读 | F块读 | 宽读 | 分列读 | 列读 | 毒段 | 单格连读 | 未勾行 | 写试
//
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、相等用长度对齐加 indexOf、比大小用减法。别改回去。

var scriptVersion = '2026-10-07.5'
var 默认子表 = '售后问题待跟进'
var 表头行 = 1
var 数据起始行 = 表头行 + 1
var 完结列 = 'F'
var 渠道列 = ['N', 'O', 'P', 'Q', 'R']
var 渠道名 = ['湖南', '京东仓', '撕单', '理赔', '异常件表']
var CHUNK_ROWS = 2000      // 找数据末行用（A:C 分块）
var 扫描块行数 = 500       // 扫 A:E / 渠道列用
var 未勾块行数 = 500       // 找未勾行用（F 分块读）
var 最大行数 = 20000
var 抽查上限 = 30
var 勾写值 = 1             // 实测：F 格勾 = 数字 1

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

// F 格值判定：1 / true / TRUE / ☑ / √ / ✓ / 是 / Y → 勾；0 / false / FALSE / ☐ / 空 → 空；其它 → 未知。
function 控件值判定(值) {
  var 类 = typeof 值
  if (类.indexOf('boolean') + 1) return 值 ? '勾' : '空'
  var 文本 = toText(值)
  if (!文本) return '空'
  if (文本.indexOf('☑') + 1) return '勾'
  if (文本.indexOf('☐') + 1) return '空'
  var 大 = 文本.toUpperCase()
  if (大.indexOf('TRUE') + 1) return '勾'
  if (大.indexOf('FALSE') + 1) return '空'
  if (文本.indexOf('-4146') + 1) return '空'
  if (文本.indexOf('1') + 1 && 文本.length - 1 < 1) return '勾'
  if (文本.indexOf('0') + 1 && 文本.length - 1 < 1) return '空'
  return '未知[' + 文本.slice(0, 24) + ']'
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
    } catch (错误读) {
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

// 成文：null/undefined → ''；其它 String（不用成双等号）。
function 成文(值) {
  var 类 = typeof 值
  if (类.indexOf('object') + 1) return ''
  if (类.indexOf('undefined') + 1) return ''
  return String(值)
}

// 单格读（catch 不碰错误对象）：先 Value2，读不到再试 Text；{ ok, 形, 值, 文本 }。
function 读单格(sheet, 地址) {
  var 出 = { ok: false, 形: '读不到', 值: '', 文本: '' }
  var 读成 = false
  var 值 = null
  try {
    值 = sheet.Range(地址).Value2
    读成 = true
  } catch (错误1) {
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
  } catch (错误2) {
    文 = null
  }
  if (文) 出.文本 = 成文(文).slice(0, 20)
  if (!出.ok && 出.文本) {
    出.ok = true
    出.形 = 'Text'
    出.值 = 出.文本
  }
  return 出
}

// 读 F 格：{ ok, 判, 值, 文本 }。
function 读F格(sheet, 行号) {
  var 单 = 读单格(sheet, 完结列 + 行号)
  return { ok: 单.ok, 判: 控件值判定(单.值), 值: 单.值, 文本: 单.文本 }
}

// 找未勾行（F 分块读）：{ 未勾: [行号] 或 null, 块错, 总行 }。
function 找未勾行(sheet, 末行) {
  var 未勾 = []
  var 块错 = 0
  var 总行 = 0
  var 行 = 数据起始行
  while (行 - 末行 < 1) {
    var 结束行 = 行 + 未勾块行数 - 1
    if (结束行 - 末行 > 0) 结束行 = 末行
    var 块 = null
    try {
      块 = sheet.Range(完结列 + 行 + ':' + 完结列 + 结束行).Value2
    } catch (错误块) {
      块 = null
    }
    if (!块) {
      块错 += 1
      行 = 结束行 + 1
      continue
    }
    var 表 = 规整一维(块)
    总行 += 表.length
    for (var i = 0; i - 表.length < 0; i += 1) {
      var 判 = 控件值判定(表[i])
      if (判.indexOf('空') + 1 || 判.indexOf('未知') + 1) 未勾.push(行 + i)
    }
    行 = 结束行 + 1
  }
  return { 未勾: 块错 ? null : 未勾, 块错: 块错, 总行: 总行 }
}

// 扫 A:E（行基础信息；避开 F 与 G..R）：{ 行们, 数据行, 空行, 读异常 }
function 扫左块(sheet, 末行) {
  var 行们 = []
  var 数据行 = 0
  var 空行 = 0
  var 读异常 = []
  var 行 = 数据起始行
  while (行 - 末行 < 1) {
    var 结束行 = 行 + 扫描块行数 - 1
    if (结束行 - 末行 > 0) 结束行 = 末行
    var 块 = null
    try {
      块 = sheet.Range('A' + 行 + ':E' + 结束行).Value2
    } catch (错误左) {
      块 = null
    }
    if (!块) {
      读异常.push(String(行) + '-' + String(结束行))
      行 = 结束行 + 1
      continue
    }
    var 表 = 规整二维(块)
    for (var i = 0; i - 表.length < 0; i += 1) {
      var 行数组 = (表[i] instanceof Array) ? 表[i] : [表[i]]
      var 行号 = 行 + i
      var A文 = toText(行数组[0])
      var C文 = toText(行数组[2])
      if (!(A文 || C文)) { 空行 += 1; continue }
      数据行 += 1
      行们.push({ 行: 行号, 登记时间: A文, 单号: C文 })
    }
    行 = 结束行 + 1
  }
  return { 行们: 行们, 数据行: 数据行, 空行: 空行, 读异常: 读异常 }
}

// 读一个渠道列（分块）：{ ok, 值表: [..]（index 0 = 数据起始行）, 块错 }
function 读渠道列(sheet, 列, 末行) {
  var 值表 = []
  var 块错 = 0
  var 行 = 数据起始行
  while (行 - 末行 < 1) {
    var 结束行 = 行 + 扫描块行数 - 1
    if (结束行 - 末行 > 0) 结束行 = 末行
    var 块 = null
    try {
      块 = sheet.Range(列 + 行 + ':' + 列 + 结束行).Value2
    } catch (错误列) {
      块 = null
    }
    if (!块) {
      块错 += 1
      行 = 结束行 + 1
      continue
    }
    var 表 = 规整一维(块)
    for (var i = 0; i - 表.length < 0; i += 1) 值表.push(表[i])
    行 = 结束行 + 1
  }
  return { ok: 块错 ? false : true, 值表: 值表, 块错: 块错 }
}

// 自检候选：A:E 找数据行 + N..R 五列分列读 + F 未勾集合。
function 自检候选(sheet, 末行) {
  var 未勾结果 = 找未勾行(sheet, 末行)
  if (!未勾结果.未勾) {
    return { 候选: null, 消息: 'F 分块读失败（' + String(未勾结果.块错) + ' 块读不到），改带 候选行 数组再跑' }
  }
  var 未勾集 = {}
  for (var i = 0; i - 未勾结果.未勾.length < 0; i += 1) 未勾集[String(未勾结果.未勾[i])] = true

  var 列数据 = []
  var 读不到列 = []
  for (var c = 0; c - 渠道列.length < 0; c += 1) {
    var 列读 = 读渠道列(sheet, 渠道列[c], 末行)
    if (!列读.ok) 读不到列.push(渠道列[c])
    列数据.push(列读.值表)
  }
  if (读不到列.length) {
    return {
      候选: null,
      消息: '渠道列 ' + 读不到列.join('/') + ' 在 AirScript 侧读不到（G..R 范围读取受限），改用 候选行 数组再跑',
      未勾数: 未勾结果.未勾.length
    }
  }

  var 扫 = 扫左块(sheet, 末行)
  var 候选 = []
  for (var j = 0; j - 扫.行们.length < 0; j += 1) {
    var 行 = 扫.行们[j]
    if (!未勾集[String(行.行)]) continue
    var 下标 = 行.行 - 数据起始行
    var 行数组 = [null, null, null, null, null, null, null, null, null, null, null, null, null]
    for (var k = 0; k - 渠道列.length < 0; k += 1) 行数组.push(列数据[k][下标])
    var 命中 = 渠道命中(行数组)
    if (!命中.length) continue
    候选.push({ 行: 行.行, 登记时间: 行.登记时间, 单号: 行.单号, 命中: 命中, 现判: '空', 现值: '' })
  }
  return {
    候选: 候选, 消息: '',
    未勾数: 未勾结果.未勾.length,
    未勾样例: 未勾结果.未勾.slice(0, 40),
    数据行: 扫.数据行, 空行: 扫.空行, 读异常: 扫.读异常
  }
}

// 指定行版候选：逐行读 N..R 单格复核有状态（读不到也照收，标 渠道读不到）+ 读 F 复核未勾。
function 复核候选行(sheet, 候选行) {
  var 候选 = []
  var 跳过 = []
  for (var i = 0; i - 候选行.length < 0; i += 1) {
    var 行号 = Number(候选行[i])
    if (!行号) continue
    var 命中 = []
    var 读不到 = 0
    for (var c = 0; c - 渠道列.length < 0; c += 1) {
      var 单 = 读单格(sheet, 渠道列[c] + 行号)
      if (!单.ok) { 读不到 += 1; continue }
      if (是无匹配(单.值)) continue
      命中.push({ 渠道: 渠道名[c], 值: toText(单.值) })
    }
    var F = 读F格(sheet, 行号)
    if (F.ok && (F.判.indexOf('勾') + 1) && !(F.判.indexOf('未知') + 1)) { 跳过.push({ 行: 行号, 因: 'F 已经是勾' }); continue }
    if (!命中.length && !读不到) { 跳过.push({ 行: 行号, 因: '渠道列没有真状态' }); continue }
    候选.push({
      行: 行号, 命中: 命中, 现判: F.ok ? F.判 : '读不到', 现值: F.ok ? F.值 : '',
      渠道读不到: 读不到 ? (读不到 + '/5 格读不到') : ''
    })
  }
  return { 候选: 候选, 跳过: 跳过 }
}

// 写候选 + 回读（catch 不碰错误对象）。
function 写候选(sheet, 候选) {
  var 已写 = []
  var 失败 = []
  for (var i = 0; i - 候选.length < 0; i += 1) {
    var 行号 = 候选[i].行
    var 成 = false
    try {
      sheet.Range(完结列 + 行号).Value2 = 勾写值
      成 = true
    } catch (错误写) {
      成 = false
    }
    if (成) 已写.push(行号)
    else 失败.push(行号)
  }
  var 不符 = 0
  var 首条差 = ''
  var 抽查 = []
  for (var j = 0; j - 候选.length < 0; j += 1) {
    var 行2 = 候选[j].行
    var F = 读F格(sheet, 行2)
    if (F.ok && (F.判.indexOf('勾') + 1) && !(F.判.indexOf('未知') + 1)) {
      if (抽查.length - 抽查上限 < 0) 抽查.push({ 行: 行2, 值: F.值, 文本: F.文本, 说明: '已勾上' })
    } else {
      不符 += 1
      if (!首条差) 首条差 = '第' + String(行2) + '行没勾上（' + (F.ok ? '实际[' + F.值 + '] ' + F.判 : 'F 读不到') + '）'
    }
  }
  return { 已写: 已写, 失败: 失败, 不符: 不符, 首条差: 首条差, 抽查: 抽查 }
}

// 取未勾数（自检失败时为 null；不用成双等号）。
function 取未勾数(自检) {
  if (!自检) return null
  if ((typeof 自检.未勾数).indexOf('number') + 1) return 自检.未勾数
  return null
}

// ============ 「试」：一次只干一件事，结果小；某个读法把引擎弄崩也只崩这一测 ============

function 跑试(sheet, 试名, argv) {
  var 出 = { 试: 试名 }
  if (试名.indexOf('单格读') + 1) {
    出.明细 = []
    var 行表 = [1, 2, 3, 749, 1319, 2060, 2141, 3000]
    for (var i = 0; i - 行表.length < 0; i += 1) {
      var F = 读F格(sheet, 行表[i])
      出.明细.push({ 行: 行表[i], ok: F.ok, 判: F.判, 值: F.值, 文本: F.文本 })
    }
    return 出
  }
  if (试名.indexOf('F块读') + 1) {
    出.明细 = []
    var 块表 = ['F2:F51', 'F2:F101', 'F2:F501', 'F2:F2001']
    for (var j = 0; j - 块表.length < 0; j += 1) {
      var 项2 = { 范围: 块表[j] }
      var 块 = null
      try {
        块 = sheet.Range(块表[j]).Value2
      } catch (错误块) {
        块 = null
      }
      if (块) {
        项2.ok = true
        项2.是数组 = (块 instanceof Array) ? true : false
        if (块 instanceof Array) {
          项2.长度 = 块.length
          项2.首 = JSON.stringify(块[0]).slice(0, 60)
        } else {
          项2.值 = String(块).slice(0, 40)
        }
      } else {
        项2.ok = false
      }
      出.明细.push(项2)
    }
    return 出
  }
  if (试名.indexOf('宽读') + 1) {
    出.明细 = []
    var 宽表 = ['A2:R2', 'A2:R6', 'A2:R101', 'A2:R501']
    for (var k = 0; k - 宽表.length < 0; k += 1) {
      var 项3 = { 范围: 宽表[k] }
      var 块3 = null
      try {
        块3 = sheet.Range(宽表[k]).Value2
      } catch (错误宽) {
        块3 = null
      }
      项3.ok = 块3 ? true : false
      出.明细.push(项3)
    }
    return 出
  }
  if (试名.indexOf('分列读') + 1) {
    出.明细 = []
    var 分表 = [['A2:E101', 'G2:R101'], ['A2:E2001', 'G2:R2001'], ['A2:E2141', 'G2:R2141']]
    for (var m = 0; m - 分表.length < 0; m += 1) {
      var 项4 = { 左: 分表[m][0], 右: 分表[m][1] }
      var 左 = null
      var 右 = null
      try { 左 = sheet.Range(分表[m][0]).Value2 } catch (错误左) { 左 = null }
      try { 右 = sheet.Range(分表[m][1]).Value2 } catch (错误右) { 右 = null }
      项4.左ok = 左 ? true : false
      项4.右ok = 右 ? true : false
      出.明细.push(项4)
    }
    return 出
  }
  if (试名.indexOf('列读') + 1) {
    出.明细 = []
    var 列表 = ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R']
    for (var n2 = 0; n2 - 列表.length < 0; n2 += 1) {
      var 列名 = 列表[n2]
      var 项5 = { 列: 列名 }
      var 块列 = null
      try {
        块列 = sheet.Range(列名 + '2:' + 列名 + '101').Value2
      } catch (错误列) {
        块列 = null
      }
      项5.范围ok = 块列 ? true : false
      if (块列 instanceof Array) 项5.行数 = 块列.length
      var 单 = 读单格(sheet, 列名 + '2')
      项5.单格ok = 单.ok
      项5.单格形 = 单.形
      项5.单格值 = 单.值.slice(0, 40)
      项5.单格文本 = 单.文本.slice(0, 40)
      出.明细.push(项5)
    }
    var 探 = {}
    var 原O = null
    try { 原O = sheet.Range('O2').Value2 } catch (错误O) { 原O = null }
    探.O2类型 = typeof 原O
    探.O2值 = String(原O).slice(0, 40)
    var 原R = null
    try { 原R = sheet.Range('R2').Value2 } catch (错误R) { 原R = null }
    探.R2类型 = typeof 原R
    探.R2值 = String(原R).slice(0, 40)
    出.原值探针 = 探
    return 出
  }
  if (试名.indexOf('毒段') + 1) {
    出.明细 = []
    var 段表 = ['G2:R2', 'G2:R6', 'G2:R26', 'G2:R51', 'G2:R101', 'G52:R101', 'G2:R2001']
    for (var q = 0; q - 段表.length < 0; q += 1) {
      var 项6 = { 范围: 段表[q] }
      var 块段 = null
      try {
        块段 = sheet.Range(段表[q]).Value2
      } catch (错误段) {
        块段 = null
      }
      项6.ok = 块段 ? true : false
      出.明细.push(项6)
    }
    return 出
  }
  if (试名.indexOf('单格连读') + 1) {
    var 起 = new Date().getTime()
    var 勾 = 0
    var 空 = 0
    var 怪 = 0
    var 错 = 0
    var 样例 = []
    for (var p = 0; p - 300 < 0; p += 1) {
      var 行号 = 2 + p * 7
      var F2 = 读F格(sheet, 行号)
      if (!F2.ok) 错 += 1
      else if (F2.判.indexOf('勾') + 1 && !(F2.判.indexOf('未知') + 1)) 勾 += 1
      else if (F2.判.indexOf('空') + 1) 空 += 1
      else {
        怪 += 1
        if (样例.length - 5 < 0) 样例.push({ 行: 行号, 值: F2.值, 判: F2.判 })
      }
    }
    出.毫秒 = new Date().getTime() - 起
    出.勾 = 勾
    出.空 = 空
    出.怪 = 怪
    出.错 = 错
    出.样例 = 样例
    return 出
  }
  if (试名.indexOf('未勾行') + 1) {
    var 末行 = 找数据末行(sheet)
    var 未勾结果 = 找未勾行(sheet, 末行)
    出.末行 = 末行
    出.块错 = 未勾结果.块错
    出.总行 = 未勾结果.总行
    出.未勾数 = 未勾结果.未勾 ? 未勾结果.未勾.length : null
    出.未勾样例 = 未勾结果.未勾 ? 未勾结果.未勾.slice(0, 60) : []
    return 出
  }
  if (试名.indexOf('写试') + 1) {
    var 试行 = argv.写试行 ? Number(argv.写试行) : 3000
    var 步骤 = []
    var F前 = 读F格(sheet, 试行)
    步骤.push({ 步: '写前', ok: F前.ok, 值: F前.值, 判: F前.判, 文本: F前.文本 })
    var 成1 = false
    try { sheet.Range(完结列 + 试行).Value2 = 勾写值; 成1 = true } catch (错误写1) { 成1 = false }
    步骤.push({ 步: '写' + String(勾写值), 成: 成1 })
    var F后 = 读F格(sheet, 试行)
    步骤.push({ 步: '写后', ok: F后.ok, 值: F后.值, 判: F后.判, 文本: F后.文本 })
    var 原是勾 = F前.判.indexOf('勾') + 1 && !(F前.判.indexOf('未知') + 1)
    var 还原值 = 原是勾 ? 1 : 0
    var 成0 = false
    try { sheet.Range(完结列 + 试行).Value2 = 还原值; 成0 = true } catch (错误写0) { 成0 = false }
    步骤.push({ 步: '还原（写' + String(还原值) + '）', 成: 成0 })
    var F还 = 读F格(sheet, 试行)
    步骤.push({ 步: '还原后', ok: F还.ok, 值: F还.值, 判: F还.判, 文本: F还.文本 })
    出.试行 = 试行
    出.步骤 = 步骤
    return 出
  }
  return { 试: 试名, 错: '不认识的试名（可用：单格读 F块读 宽读 分列读 列读 毒段 单格连读 未勾行 写试）' }
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
  var 候选行 = []
  if (bag.候选行 instanceof Array) 候选行 = bag.候选行
  return {
    allowWrite: bag.allowWrite ? true : false,
    dryRun: bag.dryRun ? true : false,
    probe: bag.probe ? true : false,
    试: bag.试 ? String(bag.试) : '',
    候选行: 候选行,
    写试行: bag.写试行 ? Number(bag.写试行) : 0
  }
}

function main() {
  var 参数 = 解析参数((Context && Context.argv) ? Context.argv : null)
  var sheet = null
  try {
    sheet = Application.Worksheets.Item(默认子表)
  } catch (错误表) {
    sheet = null
  }
  if (!sheet) return { scriptVersion: scriptVersion, mode: 'error', message: '找不到子表 ' + 默认子表 }
  var 头 = ''
  var 头值 = null
  try {
    头值 = sheet.Range('F1').Value2
  } catch (错误头) {
    头值 = null
  }
  if (头值) 头 = String(头值)
  if (!contains(头, '完结')) {
    return { scriptVersion: scriptVersion, mode: 'error', sheet: 默认子表, f1Header: 头, headerOk: false, message: 'F1 表头不是「是否已完结」（读到：' + 头 + '），拒绝动手（防表结构变了误伤）' }
  }
  var 末行 = 找数据末行(sheet)

  if (参数.试) {
    var 试结果 = 跑试(sheet, 参数.试, 参数)
    试结果.scriptVersion = scriptVersion
    试结果.mode = '试'
    试结果.lastRow = 末行
    return 试结果
  }
  if (参数.probe) {
    return {
      scriptVersion: scriptVersion, mode: 'probe', sheet: 默认子表, f1Header: 头, headerOk: true,
      lastRow: 末行, candidates: [], ticked: [], skipped: {}, readBack: [],
      message: '只读探针：数据末行 ' + String(末行)
    }
  }
  if (!末行) {
    return { scriptVersion: scriptVersion, mode: 'dryRun', sheet: 默认子表, f1Header: 头, headerOk: true, lastRow: 0, candidates: [], message: 'A/C 列没读到数据行，拒绝执行' }
  }

  // ===== 候选 =====
  var 候选 = null
  var 跳过 = []
  var 自检 = null
  if (参数.候选行.length) {
    var 复核 = 复核候选行(sheet, 参数.候选行)
    候选 = 复核.候选
    跳过 = 复核.跳过
  } else {
    自检 = 自检候选(sheet, 末行)
    候选 = 自检.候选
  }
  if (!候选) {
    return { scriptVersion: scriptVersion, mode: 'error', sheet: 默认子表, f1Header: 头, headerOk: true, lastRow: 末行, message: 自检 ? 自检.消息 : '候选检测失败' }
  }

  var 基础 = {
    scriptVersion: scriptVersion, sheet: 默认子表, f1Header: 头, headerOk: true, lastRow: 末行,
    scanned: 自检 ? 自检.数据行 : 参数.候选行.length,
    candidates: 候选,
    skipped: { 指定跳过: 跳过, 空行: 自检 ? 自检.空行 : 0, 未勾数: 取未勾数(自检) },
    readBack: []
  }
  if (自检 && 自检.读异常 && 自检.读异常.length) 基础.读异常 = 自检.读异常.slice(0, 20)

  if (参数.dryRun || !参数.allowWrite) {
    基础.mode = 'dryRun'
    基础.message = 参数.allowWrite ? 'dryRun:true，未写入' : '缺少 allowWrite:true，只回候选清单，未写入'
    基础.ticked = []
    基础.mismatched = 0
    基础.firstMismatch = ''
    return 基础
  }

  // ===== 写入 =====
  var 写结果 = 写候选(sheet, 候选)
  基础.mode = 'tick'
  基础.wrote = true
  基础.ticked = 写结果.已写
  基础.written = 写结果.已写.length
  基础.failed = 写结果.失败.length
  基础.failedRows = 写结果.失败.slice(0, 20)
  基础.readBack = 写结果.抽查
  基础.mismatched = 写结果.不符
  基础.firstMismatch = 写结果.首条差
  return 基础
}

return main()
