// 金山《2026年【湖南怀化售后】对接表》只读·按单号查行带列号　版本 2026-09-27.3
//
// 只干一件事：在**指定工作表**里按单号找登记行，返回「行号 + 每列的列号与文字」。
//   给 25号 京东换货登记核查用（要精确知道「地址列空不空、三个选项列选的什么」）。
//   老脚本「只读查询订单号」保持不动（22号/24号 在用），那份只返回非空值、列位置会丢。
//
// 只读：只读 Range(...).Value2，不写入、不保存、不激活、不给任何属性赋值。
//
// 调用：POST <同步webhook>　Header: AirScript-Token: <令牌>
//   body: {"Context":{"argv":[{"keywords":["3603429015951515"],"sheet":"换货维修登记表"}]}}
//   可选：fromRow（从第几行开始）、maxRows（扫到第几行，默认 5 万）
//
// 粘贴坑（2026-09-18 实测，改之前先看）：金山编辑器会**吃掉等号序列** → 本脚本一个等号比较都不写；
//   不用箭头函数、不用模板字符串；末行必须是顶层 return main()（只写 main() 时金山返回 null）。
var scriptVersion = '2026-09-27.3'
var DEFAULT_SHEET = '换货维修登记表'
var COLUMN_LIMIT = 'AH'
var CHUNK_ROWS = 2000
var DEFAULT_MAX_ROWS = 50000
var MAX_MATCHES = 500
var MIN_KEYWORD_LENGTH = 6

function toText(value) {
  if (!value) return ''
  return String(value).replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '')
}

// 单号归一化：去引号/空白/零宽字符，全角转半角，各种横杠统一 —— 与调用方 orderNoMatch.js 同口径
function normalize(value) {
  var text = String(value ? value : '')
  text = text.replace(/['\u2018\u2019\u201c\u201d]/g, '')
  text = text.replace(/[\s\u3000\u00a0]+/g, '')
  text = text.replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
  text = text.replace(/[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 65248)
  })
  text = text.replace(/[\u2010-\u2015\u2212\uff0d~\uff5e]/g, '-')
  return text.toUpperCase()
}

function contains(text, part) {
  // 不用「大于等于 0」（要等号）：indexOf 加一是真值即命中（-1 加一是 0，假）
  return Boolean(String(text).indexOf(part) + 1)
}

function parseArgument(rawArgument) {
  var payload = rawArgument
  if (contains(typeof payload, 'string')) {
    try {
      payload = JSON.parse(String(payload))
    } catch (error) {
      payload = null
    }
  }
  var bag = payload
  if (bag instanceof Array) bag = bag[0]
  if (!bag) bag = {}
  var keywords = []
  var rawKeywords = bag.keywords ? bag.keywords : []
  if (contains(typeof rawKeywords, 'string')) rawKeywords = [rawKeywords]
  for (var index = 0; index - rawKeywords.length < 0; index += 1) {
    var text = normalize(toText(rawKeywords[index]))
    if (text.length < MIN_KEYWORD_LENGTH) continue
    keywords.push(text)
  }
  return {
    keywords: keywords,
    sheet: bag.sheet ? String(bag.sheet) : DEFAULT_SHEET,
    fromRow: bag.fromRow ? Number(bag.fromRow) : 1,
    maxRows: bag.maxRows ? Number(bag.maxRows) : DEFAULT_MAX_ROWS
  }
}

function scan(sheet, keywords, fromRow, maxRows) {
  var matches = []
  var scannedRows = 0
  var start = fromRow
  if (start - 1 < 0) start = 1
  while (start - maxRows < 1) {
    var end = start + CHUNK_ROWS - 1
    if (end > maxRows) end = maxRows
    var block = null
    try {
      block = sheet.Range('A' + start + ':' + COLUMN_LIMIT + end).Value2
    } catch (error) {
      block = null
    }
    if (block) {
      var rows = (block instanceof Array) ? block : [block]
      for (var rowIndex = 0; rowIndex - rows.length < 0; rowIndex += 1) {
        var row = (rows[rowIndex] instanceof Array) ? rows[rowIndex] : [rows[rowIndex]]
        var cells = []
        var shown = []
        var hit = false
        for (var columnIndex = 0; columnIndex - row.length < 0; columnIndex += 1) {
          var cellText = toText(row[columnIndex])
          if (!cellText) continue
          cells.push({ c: columnIndex, v: cellText })
          shown.push(cellText)
          if (!hit) {
            var normalizedCell = normalize(cellText)
            for (var keywordIndex = 0; keywordIndex - keywords.length < 0; keywordIndex += 1) {
              if (contains(normalizedCell, keywords[keywordIndex])) {
                hit = true
                break
              }
            }
          }
        }
        if (hit && matches.length - MAX_MATCHES < 0) {
          matches.push({ row: start + rowIndex, cells: cells, values: shown })
        }
      }
      scannedRows = end
    }
    start = end + 1
    if (MAX_MATCHES - matches.length < 1) break
    if (start - maxRows < 1) continue
    break
  }
  return { matches: matches, scannedRows: scannedRows }
}

function main() {
  var parsed = parseArgument((Context && Context.argv) ? Context.argv : null)
  var sheetObject = Application.Worksheets.Item(parsed.sheet)
  var result = scan(sheetObject, parsed.keywords, parsed.fromRow, parsed.maxRows)
  return {
    scriptVersion: scriptVersion,
    sheet: sheetObject.Name,
    keywords: parsed.keywords,
    fromRow: parsed.fromRow,
    maxRows: parsed.maxRows,
    scannedRows: result.scannedRows,
    matchCount: result.matches.length,
    matches: result.matches
  }
}

return main()
