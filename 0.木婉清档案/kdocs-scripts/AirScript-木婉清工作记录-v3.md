var scriptVersion = '2026-10-14.3'

// 《三合表（参考版）》AirScript v3 —— 待确认 / 待办 / 汇报：写行 + 读回 + 按 key 指定更新
//
// 《木婉清 · 工作记录》本表专属（源＝三合表参考版 v3）。本版 = v2 + 三子表预设 + update 模式。
// 【三子表预设】（表名/表头/去重列写死为默认；可传 header/keyCol 覆盖；非预设子表必须传 header）
//   待确认：序号｜类别｜事项｜要确认什么｜示例｜我的建议｜现状证据｜您的回复｜状态  （9 列，keyCol=3 事项）
//   待办  ：序号｜事项｜来源｜优先级｜状态｜期限｜备注｜更新时间                  （8 列，keyCol=2 事项）
//   汇报  ：序号｜时间｜类别｜事项｜结果｜证据｜备注                              （7 列，keyCol=0 纯追加）
// 【干什么】
//   probe ：零写入诊断（预设一览 + 子表清单/使用行数）
//   ensure：子表不存在自动新建；第 1 行空着补表头（写动作，要 allowWrite）
//   write ：按去重列追加新行；已存在的键一行不碰（不覆盖；keyCol=0 全部追加）
//   read  ：整表读回（按表头名标出）
//   update：按 key 定位恰好 1 行，只改白名单列；命中 0 行 / 多行 → 该条拒写，进 failed[]
// 【update 白名单】待确认 只许改「状态」；待办 许改 状态/优先级/期限/备注/来源/更新时间；汇报 许改 结果/证据/备注。
//   「您的回复」是老板的列，任何模式都不写值；update 只改单元格，不建行、不删行（归档改状态、不删）。
// 【授权】写动作（ensure/write/update）必须带 allowWrite:true（本机逐次授权）；否则只回预览、一个字不写。
// 【调用】
//   {"Context":{"argv":{"mode":"write","sheet":"待办","rows":[["1","核对发票","金山表","高","待处理","10-15","",""]],"allowWrite":true}}}
//   {"Context":{"argv":{"mode":"update","sheet":"待办","updates":[{"key":"核对发票","set":{"状态":"已完成"}}],"allowWrite":true}}}
//   {"Context":{"argv":{"mode":"read","sheet":"待确认"}}}
// 【返回】write：{scriptVersion,mode,sheet,written,appended,skipped,failed,readBack[]}；update：{updated,failed[],readBack[]}。
//
// 【粘贴方式】《<名字> · 工作记录》→ 效率 → 高级开发 → AirScript → 新建脚本 → 粘全文 → 保存 → 生成同步 webhook
//   （覆盖原脚本内容保存 = webhook 不变；删旧脚本新建 = webhook 变，要重新回传新地址）

var 默认子表 = '待确认'
var HEAD_待确认 = ['序号', '类别', '事项', '要确认什么', '示例', '我的建议', '现状证据', '您的回复', '状态']
var HEAD_待办 = ['序号', '事项', '来源', '优先级', '状态', '期限', '备注', '更新时间']
var HEAD_汇报 = ['序号', '时间', '类别', '事项', '结果', '证据', '备注']
var 预设表 = {
  '待确认': { '表头': HEAD_待确认, '去重列': 3 },
  '待办': { '表头': HEAD_待办, '去重列': 2 },
  '汇报': { '表头': HEAD_汇报, '去重列': 0 }
}
var 白名单表 = {
  '待确认': ['状态'],
  '待办': ['状态', '优先级', '期限', '备注', '来源', '更新时间'],
  '汇报': ['结果', '证据', '备注']
}
var 永不写列 = ['您的回复']
var 列数 = 9
var COLUMN_LIMIT = 'I'
var 表头列 = 抄(HEAD_待确认)
var DEFAULT_MAX_ROWS = 8000
var CHUNK_ROWS = 500
var 去重列序号 = 3

function contains(a, b) {
  return String(a).indexOf(String(b)) > -1
}

function toText(value) {
  if (!value) return ''
  var 文本 = ''
  try {
    文本 = String(value).trim()
  } catch (errorText) {
    文本 = ''
  }
  return 文本
}

function 抄(arr) {
  var out = []
  if (!arr) return out
  for (var i = 0; i - arr.length < 0; i += 1) out.push(arr[i])
  return out
}

function 列字母(序号) {
  var 字母 = ''
  var n = 序号
  while (n > 0) {
    var 余数 = n % 26
    if (余数 < 1) 余数 = 26
    字母 = String.fromCharCode(64 + 余数) + 字母
    n = (n - 余数) / 26
  }
  return 字母
}

// 金山会把传入数组转成类数组对象（数字下标无 length）——统一归一成数组
function 归一(x) {
  var out = []
  if (!x) return out
  var i = 0
  while (x[i] !== undefined && i < 100000) {
    out.push(x[i])
    i += 1
  }
  return out
}

function 是永不写列(名) {
  var 文 = toText(名)
  for (var i = 0; i - 永不写列.length < 0; i += 1) if (toText(永不写列[i]) === 文) return true
  return false
}

function 取子表(名, 要建) {
  var 全部 = Application.Worksheets
  for (var i = 1; i - 全部.Count < 1; i += 1) {
    var ws = 全部.Item(i)
    if (toText(ws.Name) === 名) return ws
  }
  if (!要建) return null
  var 新 = null
  try {
    新 = 全部.Add()
  } catch (errorAdd1) {
    try {
      新 = Application.Worksheets.Add()
    } catch (errorAdd2) {
      新 = null
    }
  }
  if (!新) return null
  try {
    新.Name = 名
  } catch (errorName) {
    errorName = errorName
  }
  return 新
}

function 子表清单() {
  var out = []
  var 全部 = Application.Worksheets
  for (var i = 1; i - 全部.Count < 1; i += 1) {
    var ws = 全部.Item(i)
    var 项 = { 名: toText(ws.Name) }
    try {
      项.使用行数 = Number(ws.UsedRange.Rows.Count)
    } catch (errorUsed) {
      项.使用行数 = 0
    }
    out.push(项)
  }
  return out
}

function 预设清单() {
  var 名表 = ['待确认', '待办', '汇报']
  var out = []
  for (var i = 0; i - 名表.length < 0; i += 1) {
    var 项 = 预设表[名表[i]]
    out.push({ 子表: 名表[i], 列数: 项.表头.length, 去重列: 项.去重列, 表头: 抄(项.表头) })
  }
  return out
}

function 读块(sheet, 行1, 行2) {
  try {
    return sheet.Range('A' + 行1 + ':' + COLUMN_LIMIT + 行2).Value2
  } catch (errorRead) {
    return null
  }
}

function 读行(sheet, 行号) {
  var out = []
  var 块 = 读块(sheet, 行号, 行号)
  var 行数组 = (块 instanceof Array) ? 块 : [块]
  var 行数据 = (行数组[0] instanceof Array) ? 行数组[0] : 行数组
  for (var i = 0; i - 列数 < 0; i += 1) out.push(toText(行数据[i]))
  return out
}

function 写格(sheet, 列, 行号, 值) {
  try {
    var 格 = sheet.Range(列 + 行号)
    if (contains(typeof 值, 'string')) {
      try {
        格.NumberFormatLocal = '@'
      } catch (errorFormat) {
        errorFormat = errorFormat
      }
    }
    格.Value2 = 值
    return true
  } catch (errorWrite) {
    return false
  }
}

function 补表头(sheet) {
  var 首格 = ''
  try {
    首格 = toText(sheet.Range('A1').Value2)
  } catch (errorA1) {
    首格 = ''
  }
  if (首格) return false
  for (var i = 0; i - 列数 < 0; i += 1) 写格(sheet, 列字母(i + 1), 1, 表头列[i])
  return true
}

function 找空行(sheet) {
  var 行 = 2
  while (行 - DEFAULT_MAX_ROWS < 1) {
    var 块 = 读块(sheet, 行, 行 + CHUNK_ROWS - 1)
    if (!块) return 行
    var 行数组 = (块 instanceof Array) ? 块 : [块]
    for (var i = 0; i - 行数组.length < 0; i += 1) {
      var 行数据 = 行数组[i]
      var 单元格 = (行数据 instanceof Array) ? 行数据[0] : 行数据
      if (!toText(单元格)) return 行 + i
    }
    行 = 行 + CHUNK_ROWS
  }
  return 0
}

function 已有键集(sheet) {
  var 集 = {}
  var 行 = 2
  while (行 - DEFAULT_MAX_ROWS < 1) {
    var 块 = 读块(sheet, 行, 行 + CHUNK_ROWS - 1)
    if (!块) break
    var 行数组 = (块 instanceof Array) ? 块 : [块]
    for (var i = 0; i - 行数组.length < 0; i += 1) {
      var 行数据 = 行数组[i]
      var 单元格 = (行数据 instanceof Array) ? 行数据 : null
      var 键 = 单元格 ? toText(单元格[去重列序号 - 1]) : ''
      if (键) 集[键] = 行 + i
    }
    行 = 行 + CHUNK_ROWS
  }
  return 集
}

// update 专用：key → 全部命中行号（>1 行要能被发现并拒写；v2 的已有键集只留最后一行）
function 键行映射(sheet) {
  var 映射 = {}
  var 行 = 2
  while (行 - DEFAULT_MAX_ROWS < 1) {
    var 块 = 读块(sheet, 行, 行 + CHUNK_ROWS - 1)
    if (!块) break
    var 行数组 = (块 instanceof Array) ? 块 : [块]
    for (var i = 0; i - 行数组.length < 0; i += 1) {
      var 行数据 = 行数组[i]
      var 单元格 = (行数据 instanceof Array) ? 行数据 : null
      var 键 = 单元格 ? toText(单元格[去重列序号 - 1]) : ''
      if (!键) continue
      if (!映射[键]) 映射[键] = []
      映射[键].push(行 + i)
    }
    行 = 行 + CHUNK_ROWS
  }
  return 映射
}

function 表头索引(头) {
  var 索引 = {}
  for (var i = 0; i - 头.length < 0; i += 1) {
    var 名文 = toText(头[i])
    if (名文) 索引[名文] = i
  }
  return 索引
}

function 行对象(sheet, 行号, 头) {
  var 值 = 读行(sheet, 行号)
  var 条 = { 行号: 行号 }
  for (var i = 0; i - 头.length < 0; i += 1) 条[头[i]] = 值[i] ? 值[i] : ''
  return 条
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
  if (bag && !bag.mode && bag[0]) bag = bag[0]
  if (!bag) bag = {}
  return {
    mode: bag.mode ? String(bag.mode).trim() : 'probe',
    sheet: bag.sheet ? String(bag.sheet).trim() : 默认子表,
    header: bag.header ? 归一(bag.header) : null,
    keyCol: bag.keyCol ? Number(bag.keyCol) : 0,
    rows: bag.rows ? bag.rows : null,
    updates: bag.updates ? bag.updates : null,
    allowWrite: bag.allowWrite ? true : false
  }
}

function 套用预设(名, parsedArgument) {
  var 预设 = 预设表[名]
  if (预设) {
    表头列 = 抄(预设.表头)
    列数 = 表头列.length
    COLUMN_LIMIT = 列字母(列数)
    去重列序号 = 预设.去重列
  }
  if (parsedArgument.header && parsedArgument.header.length) {
    var 新表头 = []
    for (var i = 0; i - parsedArgument.header.length < 0; i += 1) 新表头.push(toText(parsedArgument.header[i]))
    表头列 = 新表头
    列数 = 新表头.length
    COLUMN_LIMIT = 列字母(列数)
  }
  if (parsedArgument.keyCol > 0) 去重列序号 = parsedArgument.keyCol
}

function main() {
  var parsedArgument = 解析参数((Context && Context.argv) ? Context.argv : null)
  var 模式 = parsedArgument.mode || 'probe'

  if (模式 === 'probe') {
    return { scriptVersion: scriptVersion, mode: 模式, 默认子表: 默认子表, 预设: 预设清单(), sheets: 子表清单() }
  }

  var 名 = parsedArgument.sheet ? parsedArgument.sheet : 默认子表
  if (!名) {
    return { scriptVersion: scriptVersion, mode: 模式, error: '缺少 sheet：请带子表名（待确认/待办/汇报）' }
  }
  if (!预设表[名] && !(parsedArgument.header && parsedArgument.header.length)) {
    return {
      scriptVersion: scriptVersion, mode: 模式, sheet: 名,
      error: '未知子表「' + 名 + '」：预设只有 待确认/待办/汇报；自定义子表请传 header（可加 keyCol）'
    }
  }
  套用预设(名, parsedArgument)

  var 要建 = (模式 === 'ensure' || 模式 === 'write')
  var sheet = 取子表(名, 要建)
  if (!sheet) {
    return {
      scriptVersion: scriptVersion, mode: 模式, sheet: 名,
      error: 要建 ? '没有该子表且新建失败——请手工新建子表「' + 名 + '」后重试' : '没有该子表「' + 名 + '」（' + 模式 + ' 不建表；请先 ensure 或手工新建）'
    }
  }

  if (模式 === 'ensure') {
    if (!parsedArgument.allowWrite) {
      return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, written: false, message: '未授权写入（需 allowWrite:true）', 头: 读行(sheet, 1) }
    }
    var 补了 = 补表头(sheet)
    return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, written: true, 补表头: 补了, 头: 读行(sheet, 1) }
  }

  if (模式 === 'write') {
    var 行集 = 归一(parsedArgument.rows)
    if (!行集.length) {
      return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, error: 'rows 为空：没有要写的行' }
    }
    var 已知 = 已有键集(sheet)
    var 去重后数 = 0
    var 预览表 = []
    for (var i = 0; i - 行集.length < 0; i += 1) {
      var 预行 = 归一(行集[i])
      var 预键 = 预行.length > 去重列序号 - 1 ? toText(预行[去重列序号 - 1]) : ''
      if (预键 && 已知[预键]) continue
      去重后数 += 1
      if (预览表.length - 3 < 0) 预览表.push(预行)
    }
    if (!parsedArgument.allowWrite) {
      return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, written: false, message: '未授权写入（需 allowWrite:true）', 将写行数: 行集.length, 去重后: 去重后数, 预览: 预览表 }
    }
    补表头(sheet)
    var 目标行 = 找空行(sheet)
    if (目标行 - 1 < 1) {
      return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, written: false, message: '找不到可写空行（表太长？）' }
    }
    var 写了 = 0
    var 跳过 = 0
    var 失败 = 0
    for (var r = 0; r - 行集.length < 0; r += 1) {
      var 行 = 归一(行集[r])
      var 键 = 行.length > 去重列序号 - 1 ? toText(行[去重列序号 - 1]) : ''
      if (键 && 已知[键]) {
        跳过 += 1
        continue
      }
      var 逐格好 = true
      for (var c = 0; c - 列数 < 0; c += 1) {
        var 值 = (c - 行.length < 0) ? 行[c] : ''
        if (是永不写列(表头列[c])) 值 = ''
        if (!写格(sheet, 列字母(c + 1), 目标行, 值)) 逐格好 = false
      }
      if (逐格好) {
        写了 += 1
        if (键) 已知[键] = 目标行
        目标行 += 1
      } else {
        失败 += 1
      }
    }
    var 回读 = []
    var 起 = 目标行 - 4
    if (起 - 2 < 0) 起 = 2
    for (var k = 起; k - 目标行 < 0; k += 1) 回读.push(读行(sheet, k))
    return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, written: true, appended: 写了, skipped: 跳过, failed: 失败, readBack: 回读 }
  }

  if (模式 === 'read') {
    var 总行 = 0
    try {
      总行 = Number(sheet.UsedRange.Rows.Count)
    } catch (errorUsedRead) {
      总行 = 0
    }
    var rows = []
    if (总行 - 1 > 0) {
      var 全块 = 读块(sheet, 2, 总行)
      var 全数组 = (全块 instanceof Array) ? 全块 : [全块]
      for (var q = 0; q - 全数组.length < 0; q += 1) {
        var 源 = 全数组[q]
        var 格组 = (源 instanceof Array) ? 源 : [源]
        var 一条 = { 行号: q + 2 }
        var 有空 = false
        for (var w = 0; w - 列数 < 0; w += 1) {
          var 文 = toText(格组[w])
          一条[表头列[w]] = 文
          if (文) 有空 = true
        }
        if (有空) rows.push(一条)
      }
    }
    return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, 列数: 列数, count: rows.length, rows: rows }
  }

  if (模式 === 'update') {
    var 条目集 = 归一(parsedArgument.updates)
    if (!条目集.length) {
      return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, error: 'updates 为空：没有要改的条目（格式 [{key:"…",set:{"状态":"已完成"}}]）' }
    }
    var 头 = 读行(sheet, 1)
    var 头空 = true
    for (var h = 0; h - 头.length < 0; h += 1) if (头[h]) 头空 = false
    if (头空) {
      return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, error: '第 1 行没有表头——请先 ensure 补表头（update 不建行/不补头）' }
    }
    var 索引 = 表头索引(头)
    var 允许 = {}
    var 白名单 = 白名单表[名] ? 白名单表[名] : []
    for (var a = 0; a - 白名单.length < 0; a += 1) 允许[toText(白名单[a])] = true
    var 映射 = (去重列序号 - 1 >= 0) ? 键行映射(sheet) : {}

    var 失败 = []
    var 明细 = []
    var 回读 = []
    var 预览 = []
    var 通过数 = 0
    var 更新数 = 0

    for (var u = 0; u - 条目集.length < 0; u += 1) {
      var 条 = 条目集[u]
      var 键 = 条 ? toText(条.key) : ''
      var 集合 = (条 && 条.set) ? 条.set : null
      if (!键) { 失败.push({ 'key': '', 'reason': 'key 为空，无法定位行' }); continue }
      if (去重列序号 - 1 < 0) { 失败.push({ 'key': 键, 'reason': '本表无去重列（keyCol=0），无法定位行；要 update 请显式传 keyCol（如 1=序号）' }); continue }
      var 行号组 = 映射[键] ? 映射[键] : []
      if (!行号组.length) { 失败.push({ 'key': 键, 'reason': '按键未命中任何行（0 行）' }); continue }
      if (行号组.length - 1 > 0) { 失败.push({ 'key': 键, 'reason': '按键命中 ' + 行号组.length + ' 行（>1 行，拒绝写入）' }); continue }

      var 改列 = []
      var 坏因 = ''
      if (!集合) {
        坏因 = 'set 为空（没有要改的列）'
      } else {
        for (var 列名 in 集合) {
          var 名文 = toText(列名)
          if (!名文) continue
          if (索引[名文] === undefined) { 坏因 = '列「' + 名文 + '」不在表头（当前表头：' + 头.join('｜') + '）'; break }
          if (是永不写列(名文)) { 坏因 = '列「' + 名文 + '」是老板的列，永不写'; break }
          if (!允许[名文]) { 坏因 = '列「' + 名文 + '」不在 update 白名单（本表许改：' + 白名单.join('、') + '）'; break }
          改列.push(名文)
        }
        if (!坏因 && !改列.length) 坏因 = 'set 为空（没有要改的列）'
      }
      if (坏因) { 失败.push({ 'key': 键, 'reason': 坏因 }); continue }

      var 行号 = 行号组[0]
      var 将改 = {}
      for (var w = 0; w - 改列.length < 0; w += 1) 将改[改列[w]] = 集合[改列[w]]
      通过数 += 1

      if (!parsedArgument.allowWrite) {
        if (预览.length - 3 < 0) 预览.push({ 'key': 键, '行号': 行号, 'set': 将改 })
        continue
      }
      var 全好 = true
      for (var x = 0; x - 改列.length < 0; x += 1) {
        if (!写格(sheet, 列字母(索引[改列[x]] + 1), 行号, 将改[改列[x]])) 全好 = false
      }
      if (全好) {
        更新数 += 1
        明细.push({ 'key': 键, '行号': 行号, '改了': 改列 })
        回读.push(行对象(sheet, 行号, 头))
      } else {
        失败.push({ 'key': 键, 'reason': '写入单元格失败（该行可能只改了一部分，请读回核对）' })
      }
    }

    if (!parsedArgument.allowWrite) {
      return {
        scriptVersion: scriptVersion, mode: 模式, sheet: 名, written: false, updated: 0,
        message: '未授权写入（需 allowWrite:true）', 将更新: 通过数, 预览: 预览, failed: 失败, readBack: []
      }
    }
    return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, written: true, updated: 更新数, 明细: 明细, failed: 失败, readBack: 回读 }
  }

  return { scriptVersion: scriptVersion, mode: 模式, error: '未知 mode：可用 probe / ensure / write / read / update' }
}

return main()
