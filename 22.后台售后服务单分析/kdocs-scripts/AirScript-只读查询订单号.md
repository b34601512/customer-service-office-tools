// 金山《2026年【湖南怀化售后】对接表》只读查询脚本　版本 2026-09-18.3
//
// 用途：给 AI（22号 后台售后服务单分析）查订单号 / 关键字用——在整份文档的**所有工作表**里查找，
//       只返回命中行。**只读**：只调用 Range(...).Value2 读取，不调用 Save / Add / ClearContents / Activate，
//       也不给任何属性赋值。
//
// 为什么需要它：网页版表格的运行时只把「当前窗口」的数据加载进内存（实测 退货退款表 真实 46503 行，
// 匿名读只拿到 29412 行），所以直接在浏览器里读会漏行；AirScript 在云端读整表，不受这个限制。
//
// 粘贴方式（用户做一次，约 2 分钟）：
//   1) 打开 https://www.kdocs.cn/l/ccj1mhG3wLy6 → 顶部「效率」→「高级开发」→ AirScript
//   2) **先清空编辑器里的全部默认内容**，再把本文件**全部内容**粘进去，保存（脚本名建议：只读查询订单号）
//   3) 脚本令牌（AirScript-Token）与同步 webhook 从界面复制；（2026-09-18 实测：同一账号下的
//      AirScript-Token 可跨脚本使用，22号 可直接沿用 12号 项目里那份，无需再复制）
//
// 调用：POST <webhookUrl>   Header: AirScript-Token: <token>
//       Body: {"Context":{"argv":[{"keywords":["5127667812586099609"],"maxRows":50000}]}}
//       可选：{"sheets":["退货退款表","异常件"]} 只查指定表（快）；默认全部工作表。
// 返回：{ scriptVersion, keywords, checkedSheets, scannedRows, sheetDetails[], matchCount, matches[] }
//
//
// 【重要·为什么本脚本不用 `===`】2026-09-18 实测：从本地复制粘贴到金山 AirScript 编辑器后，
//   `value === null || value === undefined` 会退化成 `value = null || value = undefined`，
//   金山侧直接报 SyntaxError: Invalid left-hand side in assignment（脚本第 28 行）。
//   → 本脚本一律用 `==` / `== null` 这类宽松比较，规避粘贴退化。
// 语法说明：本版刻意只用最保守写法（全都是 var / 普通函数 / 不用模板字符串和箭头函数），
//   因为 2026-09-18 第一版粘贴后在金山侧报过 `Invalid left-hand side in assignment`。

var scriptVersion = '2026-09-18.3'
var MAX_MATCHES = 40
var COLUMN_LIMIT = 'AH'   // 读到第 34 列，与「退货退款表」最大列对齐
var CHUNK_ROWS = 2000
var DEFAULT_MAX_ROWS = 50000
var FALLBACK_SHEETS = [
  '退货退款表', '换货维修登记表', '保外收费明细', '售后发货记录汇总表',
  '阿里巴巴德达医疗售后', '德达商城售后登记表', '湖南营销部', '线上分销退货（核算用）',
  '备用-转换赋氧售后表', 'Sheet1', '异常件', '工作表11'
]

function toText(value) {
  if (value == null) return ''
  var text = String(value)
  return text.replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '')
}

function collectSheetNames() {
  var names = []
  try {
    var count = Application.Worksheets.Count
    for (var index = 1; index <= count; index += 1) {
      try {
        names.push(Application.Worksheets.Item(index).Name)
      } catch (errorInner) {
        var ignoredInner = errorInner
      }
    }
  } catch (errorOuter) {
    names = []
  }
  if (!names.length) {
    for (var fallbackIndex = 0; fallbackIndex < FALLBACK_SHEETS.length; fallbackIndex += 1) {
      names.push(FALLBACK_SHEETS[fallbackIndex])
    }
  }
  return names
}

function rowHitsKeywords(row, keywords) {
  for (var columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
    var cellText = toText(row[columnIndex])
    if (!cellText) continue
    for (var keywordIndex = 0; keywordIndex < keywords.length; keywordIndex += 1) {
      if (cellText.indexOf(keywords[keywordIndex]) >= 0) return true
    }
  }
  return false
}

function rowIsEmpty(row) {
  for (var columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
    if (toText(row[columnIndex])) return false
  }
  return true
}

function scanSheet(name, keywords, maxRows) {
  var sheet = Application.Worksheets.Item(name)
  var matches = []
  var scanned = 0
  var start = 1
  while (start <= maxRows) {
    var end = start + CHUNK_ROWS - 1
    if (end > maxRows) end = maxRows
    var values = null
    try {
      values = sheet.Range('A' + start + ':' + COLUMN_LIMIT + end).Value2
    } catch (error) {
      values = null
    }
    if (values) {
      var rows = (values instanceof Array) ? values : [values]
      var hasData = false
      for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        var row = (rows[rowIndex] instanceof Array) ? rows[rowIndex] : [rows[rowIndex]]
        if (!rowIsEmpty(row)) hasData = true
        if (rowHitsKeywords(row, keywords)) {
          var shown = []
          for (var showIndex = 0; showIndex < row.length; showIndex += 1) {
            var shownText = toText(row[showIndex])
            if (shownText) shown.push(shownText)
          }
          matches.push({ sheet: name, row: start + rowIndex, values: shown })
        }
      }
      if (!hasData && start > CHUNK_ROWS) break
    }
    scanned = end
    start = end + 1
  }
  return { matches: matches, scanned: scanned }
}

function main() {
  var argv = (Context && Context.argv) ? Context.argv : []
  var options = (argv[0] && typeof argv[0] == 'object') ? argv[0] : { keywords: argv }
  var keywords = []
  var rawKeywords = options.keywords ? options.keywords : []
  for (var keywordIndex = 0; keywordIndex < rawKeywords.length; keywordIndex += 1) {
    var keywordText = toText(rawKeywords[keywordIndex])
    if (keywordText.length >= 6) keywords.push(keywordText)
  }
  var maxRows = options.maxRows ? Number(options.maxRows) : DEFAULT_MAX_ROWS
  var allNames = collectSheetNames()
  var targets = allNames
  if (options.sheets && options.sheets.length) {
    targets = []
    for (var filterIndex = 0; filterIndex < options.sheets.length; filterIndex += 1) {
      var wanted = options.sheets[filterIndex]
      for (var nameIndex = 0; nameIndex < allNames.length; nameIndex += 1) {
        if (allNames[nameIndex] == wanted) targets.push(wanted)
      }
    }
  }

  var matches = []
  var details = []
  var scannedRows = 0
  for (var sheetIndex = 0; sheetIndex < targets.length; sheetIndex += 1) {
    var result = { matches: [], scanned: 0 }
    try {
      result = scanSheet(targets[sheetIndex], keywords, maxRows)
    } catch (error) {
      details.push({ sheet: targets[sheetIndex], rows: 0, hits: 0, error: String(error && error.message ? error.message : error).slice(0, 120) })
      continue
    }
    details.push({ sheet: targets[sheetIndex], rows: result.scanned, hits: result.matches.length })
    scannedRows += result.scanned
    for (var matchIndex = 0; matchIndex < result.matches.length; matchIndex += 1) {
      if (matches.length >= MAX_MATCHES) break
      matches.push(result.matches[matchIndex])
    }
    if (matches.length >= MAX_MATCHES) break
  }

  return {
    scriptVersion: scriptVersion,
    keywords: keywords,
    checkedSheets: details.length,
    scannedRows: scannedRows,
    sheetDetails: details,
    matchCount: matches.length,
    matches: matches
  }
}

main()
