// 《2026年【交接&跟进】表》『售后问题待跟进』F 列勾选已完结 —— AirScript（v2026-10-07.4）
//
// 【2026-10-07 两轮实测结论·别推翻】
//   1) F 列的勾是**单元格复选框**（网页端实测：格值 = 数字 1（勾）/ 0（未勾），单元格字段类型 = Checkbox；
//      不是浮动控件 —— sheet.Shapes 数量为 0；也不是文本 "☑"）。
//   2) 含 F 列的**整块读取**（如 A2:R2001）在 AirScript 里会抛错（错误对象连 .message 都不能碰，
//      碰了二次抛错会把整个脚本弄崩 → 网关报 "exchange response missing data"）。
//      ⇒ 铁律：**catch 里一律不碰错误对象**（只赋常量），并且**读数据避开 F 列**（A:E + G:R 分开读）。
//   3) F 列自身的读/写能否用（单格 / 小块 / 写值）→ 用本脚本「试」模式逐个实测，别猜。
//
// 【模式】POST <本脚本同步 webhook>   Header: AirScript-Token: <token>
//   {"Context":{"argv":{"probe":true}}}                        只读探针：版本 + 数据末行
//   {"Context":{"argv":{"试":"单格读"}}}                       只读小测（见下），一次只干一件事，崩也只崩这一测
//   {"Context":{"argv":{"dryRun":true}}}                       只读预演：候选 = 渠道列有真状态 且 F 未勾
//   {"Context":{"argv":{"dryRun":true,"候选行":[1319,...]}}}   只读预演（指定行版；F 状态读不到时用这个）
//   {"Context":{"argv":{"allowWrite":true, ...同 dryRun}}}     真写：把候选行 F 写成 1 + 回读
//   试名：单格读 | F块读 | 宽读 | 分列读 | 单格连读 | 未勾行 | 写试
//
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、相等用长度对齐加 indexOf、比大小用减法。别改回去。

var scriptVersion = '2026-10-07.4'
var 默认子表 = '售后问题待跟进'
var 表头行 = 1
var 数据起始行 = 表头行 + 1
var 完结列 = 'F'
var 渠道列 = ['N', 'O', 'P', 'Q', 'R']
var 渠道名 = ['湖南', '京东仓', '撕单', '理赔', '异常件表']
var CHUNK_ROWS = 2000      // 找数据末行用（A:C 分块）
var 扫描块行数 = 500       // 扫候选用（A:E + G:R 分开读，避开 F）
var 未勾块行数 = 500       // 找未勾行用（F 分块读）
var 最大行数 = 20000
var 抽查上限 = 30
var 勾写值 = 1             // 网页实测：F 格勾 = 数字 1

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

// 单格 F 读（catch 不碰错误对象）：{ ok, 判, 值 }。
function 读F格(sheet, 行号) {
  var 出 = { ok: false, 判: '读不到', 值: '', 文本: '' }
  var 值 = null
  try {
    值 = sheet.Range(完结列 + 行号).Value2
  } catch (错误1) {
    值 = null
    return 出
  }
  var 文 = null
  try {
    文 = sheet.Range(完结列 + 行号).Text
  } catch (错误2) {
    文 = null
  }
  出.ok = true
  出.判 = 控件值判定(值)
  出.值 = String(值)
  出.文本 = 文 ? String(文).slice(0, 10) : ''
  return 出
}

// 找未勾行（F 分块读）：返回 { 未勾: [行号], 块错: 数字, 总行: 数字 }；未勾 为 null 表示块读失败。
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

// 扫渠道状态行（A:E + G:R 分开读，避开 F 列）：返回 { 状态行: [{行,登记时间,单号,命中}], 数据行, 空行, 读异常 }
function 扫渠道状态行(sheet, 末行) {
  var 状态行 = []
  var 数据行 = 0
  var 空行 = 0
  var 读异常 = []
  var 行 = 数据起始行
  while (行 - 末行 < 1) {
    var 结束行 = 行 + 扫描块行数 - 1
    if (结束行 - 末行 > 0) 结束行 = 末行
    var 前块 = null
    var 后块 = null
    try { 前块 = sheet.Range('A' + 行 + ':E' + 结束行).Value2 } catch (错误前) { 前块 = null }
    try { 后块 = sheet.Range('G' + 行 + ':R' + 结束行).Value2 } catch (错误后) { 后块 = null }
    if (!前块 || !后块) {
      读异常.push(String(行) + '-' + String(结束行))
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
      if (!命中.length) continue
      状态行.push({ 行: 行号, 登记时间: A文, 单号: C文, 命中: 命中 })
    }
    行 = 结束行 + 1
  }
  return { 状态行: 状态行, 数据行: 数据行, 空行: 空行, 读异常: 读异常 }
}

// 指定行版候选：逐行读 N:R 复核有状态 + 读 F 复核未勾。
function 复核候选行(sheet, 候选行) {
  var 候选 = []
  var 跳过 = []
  for (var i = 0; i - 候选行.length < 0; i += 1) {
    var 行号 = Number(候选行[i])
    if (!行号) continue
    var 命中 = []
    var 渠道值 = null
    try {
      渠道值 = sheet.Range('N' + 行号 + ':R' + 行号).Value2
    } catch (错误渠) {
      渠道值 = null
    }
    if (渠道值) {
      var 渠表 = 规整二维(渠道值)
      var 渠行 = (渠表[0] instanceof Array) ? 渠表[0] : [渠表[0]]
      命中 = 渠道命中([null, null, null, null, null, null, null, null, null, null, null, null, null].concat(渠行))
    }
    if (!命中.length) { 跳过.push({ 行: 行号, 因: '渠道列没有真状态' }); continue }
    var F = 读F格(sheet, 行号)
    if (F.ok && (F.判.indexOf('勾') + 1) && !(F.判.indexOf('未知') + 1)) { 跳过.push({ 行: 行号, 因: 'F 已经是勾' }); continue }
    候选.push({ 行: 行号, 命中: 命中, 现判: F.ok ? F.判 : '读不到', 现值: F.ok ? F.值 : '' })
  }
  return { 候选: 候选, 跳过: 跳过 }
}

// 自检版候选：渠道状态行 ∩ F 未勾。
function 自检候选(sheet, 末行) {
  var 未勾结果 = 找未勾行(sheet, 末行)
  if (!未勾结果.未勾) {
    return { 候选: null, 消息: 'F 分块读失败（' + String(未勾结果.块错) + ' 块读不到），改带 候选行 数组再跑' }
  }
  var 未勾集 = {}
  for (var i = 0; i - 未勾结果.未勾.length < 0; i += 1) 未勾集[String(未勾结果.未勾[i])] = true
  var 扫 = 扫渠道状态行(sheet, 末行)
  var 候选 = []
  for (var j = 0; j - 扫.状态行.length < 0; j += 1) {
    var 行 = 扫.状态行[j]
    if (未勾集[String(行.行)]) 候选.push({ 行: 行.行, 登记时间: 行.登记时间, 单号: 行.单号, 命中: 行.命中, 现判: '空', 现值: '' })
  }
  return { 候选: 候选, 消息: '', 未勾数: 未勾结果.未勾.length, 未勾样例: 未勾结果.未勾.slice(0, 40), 数据行: 扫.数据行, 空行: 扫.空行, 读异常: 扫.读异常 }
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

// ============ 「试」：一次只干一件事，结果小；某个读法把引擎弄崩也只崩这一测 ============

function 跑试(sheet, 试名, argv) {
  var 出 = { 试: 试名 }
  if (试名.indexOf('单格读') + 1) {
    出.明细 = []
    var 行表 = [1, 2, 3, 749, 1319, 2060, 2141, 3000]
    for (var i = 0; i - 行表.length < 0; i += 1) {
      var 项 = { 行: 行表[i] }
      var F = 读F格(sheet, 行表[i])
      项.ok = F.ok
      项.判 = F.判
      项.值 = F.值
      项.文本 = F.文本
      出.明细.push(项)
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
          项2.末 = JSON.stringify(块[块.length - 1]).slice(0, 60)
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
      if (块3) {
        项3.ok = true
        if (块3 instanceof Array) {
          项3.行数 = 块3.length
          项3.首行 = JSON.stringify(块3[0]).slice(0, 120)
        } else {
          项3.值 = String(块3).slice(0, 40)
        }
      } else {
        项3.ok = false
      }
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
      if (左 instanceof Array) 项4.左行数 = 左.length
      if (右 instanceof Array) {
        项4.右行数 = 右.length
        项4.右首行 = JSON.stringify(右[0]).slice(0, 100)
      }
      出.明细.push(项4)
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
    for (var n = 0; n - 300 < 0; n += 1) {
      var 行号 = 2 + n * 7
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
    if (未勾结果.未勾) {
      出.未勾数 = 未勾结果.未勾.length
      出.未勾样例 = 未勾结果.未勾.slice(0, 60)
    } else {
      出.未勾数 = null
    }
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
  return { 试: 试名, 错: '不认识的试名（可用：单格读 F块读 宽读 分列读 单格连读 未勾行 写试）' }
}

// 取未勾数（自检失败时为 null；不用成双等号）。
function 取未勾数(自检) {
  if (!自检) return null
  if ((typeof 自检.未勾数).indexOf('number') + 1) return 自检.未勾数
  return null
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
