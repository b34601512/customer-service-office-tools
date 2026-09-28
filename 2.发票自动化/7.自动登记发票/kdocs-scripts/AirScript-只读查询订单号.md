// 金山《2026年【德达医疗器械发票】登记总表》只读查询脚本　版本 2026-09-28.1
//
// 用途：给 AI（7号 自动登记发票）查「这个订单号客服登记过没有」——在**云端读全表**，不受网页版「只加载当前窗口」的限制。
//   **只读**：只调用 Range(...).Value2 读取，不调用保存 / 新增 / 清空 / 激活，也不给任何属性赋值。
//
// 为什么需要它：网页版表格只把「当前窗口」的数据加载进内存（22号 实测：退货退款表真实 46503 行，匿名读只拿到 29412 行）。
//   7号 2026-09-28 实测同款坑：德达登记表匿名读只拿到 489 行（最后一条 2025/10/14），看着像"表停在 2025 年"，
//   其实很可能是读漏了 2026 年的行。查重必须走云端。
//
// 【本版为什么长这样·务必保留】2026-09-18 实测：**粘贴进金山 AirScript 编辑器会吃掉等号序列**
//   - 三连等号存进去变成单个等号 → SyntaxError: Invalid left-hand side in assignment
//   - 双连等号存进去整段消失 → SyntaxError: Unexpected string
//   → 所以本脚本里**一个等号比较都不用**：判空用真值、找索引用 indexOf 加一取真、比大小一律用 < 和 >，
//     循环边界写成加减法（例如「小于等于 N」写成「减 N 小于 1」）。别改回去。
//
// 粘贴方式（用户做一次）：打开 https://www.kdocs.cn/l/coz87mpAe0cO → 顶部「效率」→「高级开发」→ AirScript
//   → **先清空编辑器里的全部默认内容** → 把本文件全文粘进去 → 保存（脚本名：只读查询订单号）
//   → 发布 / 生成「同步 webhook」→ 把同步地址交给 AI 填进 project-config/kdocs-airscript.json。
//   建议用记事本或 VSCode 打开本文件复制，别从网页或聊天窗口复制。
//
// 调用：POST <webhookUrl>   Header: AirScript-Token: <token>
//       Body: {"Context":{"argv":[{"keywords":["260903-171347832413939"],"tailRows":3}]}}
//       可选：{"sheets":["德达医疗器械发票登记 --毛叶红"]} 只查指定表；{"allSheets":true} 查全部工作表。
//       诊断：keywords 留空 → 只回「行数 / 最后一行 / 各年条数 / 最后几行」。
// 返回：{ scriptVersion, keywords, checkedSheets, scannedRows, sheetDetails[], matchCount, matches[], tail[] }

var scriptVersion = '2026-09-28.1'
var MAX_MATCHES = 40
var COLUMN_LIMIT = 'AT'          // A..AT = 前 46 列（登记日期…份数），够查重与看摘要；要读批量开票区再往后加
var CHUNK_ROWS = 1000
var DEFAULT_MAX_ROWS = 20000
var MIN_KEYWORD_LENGTH = 4
var TAIL_LIMIT = 24              // 每行最多回传多少个非空单元格
var DEFAULT_SHEETS = ['德达医疗器械发票登记 --毛叶红']
var FALLBACK_SHEETS = ['德达医疗器械发票登记 --毛叶红', '德达医疗器械--发票开出']

function toText(value) {
  if (!value) return ''
  // 日期对象要格式化，否则 String(new Date()) 出来的是 "Wed Sep 28 2026 …"，年份统计和人工看都会错。
  if (value.getFullYear) {
    return String(value.getFullYear()) + '/' + String(value.getMonth() + 1) + '/' + String(value.getDate())
  }
  var text = String(value)
  return text.replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '')
}

function contains(haystack, needle) {
  // 不用「大于等于 0」：那要写等号；indexOf 结果加一后为真值即命中（-1 加一是 0，假）。
  return Boolean(String(haystack).indexOf(needle) + 1)
}

function collectSheetNames() {
  var names = []
  try {
    var count = Application.Worksheets.Count
    for (var index = 1; index - count < 1; index += 1) {
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
    for (var fallbackIndex = 0; fallbackIndex - FALLBACK_SHEETS.length < 0; fallbackIndex += 1) {
      names.push(FALLBACK_SHEETS[fallbackIndex])
    }
  }
  return names
}

function rowHitsKeywords(row, keywords) {
  for (var columnIndex = 0; columnIndex - row.length < 0; columnIndex += 1) {
    var cellText = toText(row[columnIndex])
    if (!cellText) continue
    for (var keywordIndex = 0; keywordIndex - keywords.length < 0; keywordIndex += 1) {
      if (contains(cellText, keywords[keywordIndex])) return true
    }
  }
  return false
}

function rowIsEmpty(row) {
  for (var columnIndex = 0; columnIndex - row.length < 0; columnIndex += 1) {
    if (toText(row[columnIndex])) return false
  }
  return true
}

function compactRow(row) {
  var shown = []
  for (var showIndex = 0; showIndex - row.length < 0; showIndex += 1) {
    var shownText = toText(row[showIndex])
    if (!shownText) continue
    shown.push(shownText.slice(0, 40))
    if (shown.length - TAIL_LIMIT > -1) break
  }
  return shown
}

function scanSheet(name, keywords, maxRows, tailRows) {
  var sheet = Application.Worksheets.Item(name)
  var matches = []
  var tail = []
  var yearCounts = {}
  var scanned = 0
  var lastRow = 0
  var lastRowDate = ''
  var start = 1
  while (start - maxRows < 1) {
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
      for (var rowIndex = 0; rowIndex - rows.length < 0; rowIndex += 1) {
        var row = (rows[rowIndex] instanceof Array) ? rows[rowIndex] : [rows[rowIndex]]
        if (rowIsEmpty(row)) continue
        hasData = true
        var rowNumber = start + rowIndex
        lastRow = rowNumber
        lastRowDate = toText(row[0])
        var year = lastRowDate.slice(0, 4)
        if (year) yearCounts[year] = (yearCounts[year] || 0) + 1
        if (tailRows > 0) {
          tail.push({ row: rowNumber, values: compactRow(row) })
          if (tail.length > tailRows) tail.shift()
        }
        if (rowHitsKeywords(row, keywords)) {
          matches.push({ sheet: name, row: rowNumber, values: compactRow(row) })
          if (MAX_MATCHES - matches.length < 1) break
        }
      }
      if (!hasData && start > CHUNK_ROWS) break
    }
    scanned = end
    start = end + 1
  }
  return { matches: matches, tail: tail, scanned: scanned, lastRow: lastRow, lastRowDate: lastRowDate, yearCounts: yearCounts }
}

function buildTargets(allNames, requestedSheets, allSheets) {
  var wanted = []
  if (requestedSheets && requestedSheets.length) wanted = requestedSheets
  else if (!allSheets) wanted = DEFAULT_SHEETS
  if (!wanted.length) return allNames
  var targets = []
  for (var index = 0; index - wanted.length < 0; index += 1) {
    var name = wanted[index]
    if (contains(allNames.join('\n'), name)) targets.push(name)
  }
  if (!targets.length) return allNames
  return targets
}

function parseArgument(rawArgument) {
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
  if (bag instanceof Array) bag = bag[0]
  if (!bag || !bag.keywords) bag = { keywords: bag && bag.keywords ? bag.keywords : [] }

  var keywords = []
  var rawKeywords = bag.keywords ? bag.keywords : []
  if (contains(typeof rawKeywords, 'string')) rawKeywords = [rawKeywords]
  for (var keywordIndex = 0; keywordIndex - rawKeywords.length < 0; keywordIndex += 1) {
    var keywordText = toText(rawKeywords[keywordIndex])
    if (keywordText.length < MIN_KEYWORD_LENGTH) continue
    keywords.push(keywordText)
  }
  var tailRows = bag.tailRows ? Number(bag.tailRows) : 3
  if (tailRows > 10) tailRows = 10
  if (tailRows < 0) tailRows = 0
  return { keywords: keywords, sheets: bag.sheets, allSheets: bag.allSheets, maxRows: bag.maxRows, tailRows: tailRows, preview: preview }
}

function main() {
  var parsedArgument = parseArgument((Context && Context.argv) ? Context.argv : null)
  var keywords = parsedArgument.keywords
  var maxRows = parsedArgument.maxRows ? Number(parsedArgument.maxRows) : DEFAULT_MAX_ROWS
  var targets = buildTargets(collectSheetNames(), parsedArgument.sheets, parsedArgument.allSheets)

  var matches = []
  var tail = []
  var details = []
  var scannedRows = 0
  for (var sheetIndex = 0; sheetIndex - targets.length < 0; sheetIndex += 1) {
    var result = { matches: [], tail: [], scanned: 0, lastRow: 0, lastRowDate: '', yearCounts: {} }
    try {
      result = scanSheet(targets[sheetIndex], keywords, maxRows, parsedArgument.tailRows)
    } catch (error) {
      var message = String(error && error.message ? error.message : error).slice(0, 120)
      details.push({ sheet: targets[sheetIndex], rows: 0, hits: 0, lastRow: 0, lastRowDate: '', yearCounts: {}, error: message })
      continue
    }
    details.push({
      sheet: targets[sheetIndex],
      rows: result.scanned,
      hits: result.matches.length,
      lastRow: result.lastRow,
      lastRowDate: result.lastRowDate,
      yearCounts: result.yearCounts
    })
    scannedRows += result.scanned
    for (var tailIndex = 0; tailIndex - result.tail.length < 0; tailIndex += 1) {
      tail.push({ sheet: targets[sheetIndex], row: result.tail[tailIndex].row, values: result.tail[tailIndex].values })
    }
    for (var matchIndex = 0; matchIndex - result.matches.length < 0; matchIndex += 1) {
      if (MAX_MATCHES - matches.length < 1) break
      matches.push(result.matches[matchIndex])
    }
    if (MAX_MATCHES - matches.length < 1) break
  }

  return {
    scriptVersion: scriptVersion,
    argumentPreview: parsedArgument.preview,
    keywords: keywords,
    checkedSheets: details.length,
    scannedRows: scannedRows,
    sheetDetails: details,
    matchCount: matches.length,
    matches: matches,
    tail: tail
  }
}

return main()
