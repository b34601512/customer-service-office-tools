// 金山《2026年【湖南怀化售后】对接表》只读查询脚本　版本 2026-09-18.5
//
// 用途：给 AI（22号 后台售后服务单分析）查订单号 / 关键字——在整份文档的**所有工作表**里查找，只返回命中行。
//   **只读**：只调用 Range(...).Value2 读取，不调用保存 / 新增 / 清空 / 激活，也不给任何属性赋值。
//
// 为什么需要它：网页版表格只把「当前窗口」的数据加载进内存（实测 退货退款表 真实 46503 行，匿名读只拿到 29412 行），
//   直接在浏览器里读会漏行；AirScript 在云端读整表，不受这个限制。
//
// 【本版为什么长这样·务必保留】2026-09-18 实测：**粘贴进金山 AirScript 编辑器会吃掉等号序列**
//   - 三连等号存进去变成单个等号 → SyntaxError: Invalid left-hand side in assignment（脚本第 28 行）
//   - 双连等号存进去整段消失 → SyntaxError: Unexpected string（脚本第 125 行）
//   - 单等号（赋值）没事；据此推断「大于等于 / 小于等于」里的等号也可能被吃掉，那会**静默漏匹配**，更危险。
//   → 所以本脚本里**一个等号比较都不用**：判空用真值、找索引用 indexOf 加一取真、比大小一律用 < 和 >，
//     循环边界写成加减法（例如「小于等于 N」写成「减 N 小于 1」）。
//     `tests/airScriptPasteSafety.test.js` 会锁死这条规则，别改回去。
//
// 粘贴方式（用户做一次）：打开 https://www.kdocs.cn/l/ccj1mhG3wLy6 → 顶部「效率」→「高级开发」→ AirScript
//   → **先清空编辑器里的全部默认内容** → 把本文件全文粘进去 → 保存（脚本名：只读查询订单号）。
//   建议用记事本或 VSCode 打开本文件复制，别从网页或聊天窗口复制。
//
// 调用：POST <webhookUrl>   Header: AirScript-Token: <token>
//       Body: {"Context":{"argv":[{"keywords":["5127667812586099609"],"maxRows":50000}]}}
//       可选：{"sheets":["退货退款表","异常件"]} 只查指定表（快）；默认全部工作表。
// 返回：{ scriptVersion, keywords, checkedSheets, scannedRows, sheetDetails[], matchCount, matches[] }

var scriptVersion = '2026-09-18.5'
var MAX_MATCHES = 40
var COLUMN_LIMIT = 'AH'   // 读到第 34 列，与「退货退款表」最大列对齐
var CHUNK_ROWS = 2000
var DEFAULT_MAX_ROWS = 50000
var MIN_KEYWORD_LENGTH = 6
var FALLBACK_SHEETS = [
  '退货退款表', '换货维修登记表', '保外收费明细', '售后发货记录汇总表',
  '阿里巴巴德达医疗售后', '德达商城售后登记表', '湖南营销部', '线上分销退货（核算用）',
  '备用-转换赋氧售后表', 'Sheet1', '异常件', '工作表11'
]

function toText(value) {
  if (!value) return ''
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

function scanSheet(name, keywords, maxRows) {
  var sheet = Application.Worksheets.Item(name)
  var matches = []
  var scanned = 0
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
        if (!rowIsEmpty(row)) hasData = true
        if (rowHitsKeywords(row, keywords)) {
          var shown = []
          for (var showIndex = 0; showIndex - row.length < 0; showIndex += 1) {
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

function buildTargets(allNames, requestedSheets) {
  if (!requestedSheets || !requestedSheets.length) return allNames
  var targets = []
  for (var index = 0; index - requestedSheets.length < 0; index += 1) {
    var wanted = requestedSheets[index]
    if (contains(allNames.join('\n'), wanted)) targets.push(wanted)
  }
  return targets
}

function main() {
  var argv = (Context && Context.argv) ? Context.argv : []
  var firstArgument = argv[0]
  var options = (firstArgument && firstArgument.keywords) ? firstArgument : { keywords: argv }
  var keywords = []
  var rawKeywords = options.keywords ? options.keywords : []
  for (var keywordIndex = 0; keywordIndex - rawKeywords.length < 0; keywordIndex += 1) {
    var keywordText = toText(rawKeywords[keywordIndex])
    if (keywordText.length < MIN_KEYWORD_LENGTH) continue
    keywords.push(keywordText)
  }
  var maxRows = options.maxRows ? Number(options.maxRows) : DEFAULT_MAX_ROWS
  var targets = buildTargets(collectSheetNames(), options.sheets)

  var matches = []
  var details = []
  var scannedRows = 0
  for (var sheetIndex = 0; sheetIndex - targets.length < 0; sheetIndex += 1) {
    var result = { matches: [], scanned: 0 }
    try {
      result = scanSheet(targets[sheetIndex], keywords, maxRows)
    } catch (error) {
      var message = String(error && error.message ? error.message : error).slice(0, 120)
      details.push({ sheet: targets[sheetIndex], rows: 0, hits: 0, error: message })
      continue
    }
    details.push({ sheet: targets[sheetIndex], rows: result.scanned, hits: result.matches.length })
    scannedRows += result.scanned
    for (var matchIndex = 0; matchIndex - result.matches.length < 0; matchIndex += 1) {
      if (MAX_MATCHES - matches.length < 1) break
      matches.push(result.matches[matchIndex])
    }
    if (MAX_MATCHES - matches.length < 1) break
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
