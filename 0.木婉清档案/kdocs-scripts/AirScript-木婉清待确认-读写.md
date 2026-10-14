var scriptVersion = '2026-10-14.1'

// 《木婉清待确认清单》（待建）AirScript —— 子表行写入 + 答案读回（一体脚本）
//
// 源＝探域 v2 通用脚本（2026-10-14.2）；本副本默认列＝木婉清待确认 8 列，keyCol=3（事项）。
//   调用时可传 header 自定义表头、keyCol 指定去重列（1 起）。
//
// 【干什么】给《木婉清待确认清单》铺行、并读回老板回填的答案：
//   - 子表不存在可自动新建；第 1 行空着自动补表头；
//   - mode='write'：按去重列**追加**新行；已存在的键一行都不碰（不覆盖已填答案）；
//   - mode='read' ：整表读回（含老板填的答案列，按表头名标出）；
//   - mode='probe'：零写入诊断（子表清单/使用行数）。
// 【授权】写动作必须带 allowWrite:true（本机逐次授权）；否则只回预览、一个字不写。
// 【调用】{"Context":{"argv":{"mode":"write","sheet":"工作表1","header":["序号","类别","事项","要确认什么","示例","我的建议","现状证据","您的回复"],"keyCol":3,"rows":[[...],...],"allowWrite":true}}}
// 【返回】JSON：{scriptVersion, mode, sheet, written, appended, skipped, failed, readBack[], sheets[] | rows[]}
//
// 【粘贴方式】《木婉清待确认清单》（新建的空表）→ 效率 → 高级开发 → AirScript → 新建脚本 → 粘全文 → 保存 → 生成同步 webhook

var 默认子表 = ''
var 列数 = 8
var COLUMN_LIMIT = 'H'
var 表头列 = ['序号', '类别', '事项', '要确认什么', '示例', '我的建议', '现状证据', '您的回复']
var DEFAULT_MAX_ROWS = 8000
var CHUNK_ROWS = 500
var 去重列序号 = 3  // 事项（C 列）

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
    allowWrite: bag.allowWrite ? true : false,
  }
}

function 套用表头(parsedArgument) {
  if (parsedArgument.header && parsedArgument.header.length) {
    var 新表头 = []
    for (var i = 0; i - parsedArgument.header.length < 0; i += 1) 新表头.push(toText(parsedArgument.header[i]))
    表头列 = 新表头
    列数 = 新表头.length
    COLUMN_LIMIT = 列字母(列数)
  }
  if (parsedArgument.keyCol) 去重列序号 = parsedArgument.keyCol
}

function main() {
  var parsedArgument = 解析参数((Context && Context.argv) ? Context.argv : null)
  var 模式 = parsedArgument.mode || 'probe'
  套用表头(parsedArgument)

  if (模式 === 'probe') {
    return { scriptVersion: scriptVersion, mode: 模式, 列数: 列数, 去重列: 去重列序号, sheets: 子表清单() }
  }

  var 名 = parsedArgument.sheet
  if (!名) {
    return { scriptVersion: scriptVersion, mode: 模式, error: '缺少 sheet：请带子表名（如 发货）' }
  }

  var 要建 = (模式 === 'ensure' || 模式 === 'write')
  var sheet = 取子表(名, 要建)
  if (!sheet) {
    return { scriptVersion: scriptVersion, mode: 模式, sheet: 名, error: '没有该子表且新建失败——请手工新建子表「' + 名 + '」后重试' }
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

  return { scriptVersion: scriptVersion, mode: 模式, error: '未知 mode：可用 probe / ensure / write / read' }
}

return main()
