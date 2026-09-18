// 金山《2026年【湖南怀化售后】对接表》只读筛选脚本（未退款行）　版本 2026-09-18.1
//
// 用途：**反向检查**——退款表里有记录（客户货已退回/已登记），但「退款状态」列没填「已退款」，
//   说明客服还没处理 → 列为待提醒。**只读**：只读 Range(...).Value2，不写入、不保存、不激活。
//
// 部署：文档 → 效率 → 高级开发 → AirScript → 新建脚本 → 清空默认内容 → 粘贴本文件全文 → 保存
//   （脚本名建议：只读筛选未退款行；令牌与同步 webhook 见 22号 项目 project-config/kdocs-airscript.json）
//
// 调用：POST <webhookUrl>  Header: AirScript-Token: <token>
//       Body: {"Context":{"argv":{"sheetName":"退货退款表","statusColumnIndex":22,"okStatusText":"已退款","limit":200}}}
//   sheetName        默认「退货退款表」
//   statusColumnIndex 退款状态所在列（0 起，默认 22 ＝ W 列）
//   orderColumnIndex  订单号所在列（0 起，默认 10 ＝ K 列；空则该行视为无记录）
//   okStatusText      视为“已处理”的状态文字（默认「已退款」，含该文字即跳过）
//   maxRows/limit     扫描上限 / 最多返回多少行样例（默认 50000 / 200）
// 返回：{ scriptVersion, sheetName, summary:{ scannedRows, rowsWithOrder, statusCounts, pendingCount }, samples:[...] }
//
// 与查询脚本相同的两条硬约束（实测）：**传对象不传数组**；**末行必须 return main()**。
// 等号比较一律不用（粘贴通道会吃等号序列，见 tests/airScriptPasteSafety.test.js）。

var scriptVersion = '2026-09-18.1'
var CHUNK_ROWS = 2000
var COLUMN_LIMIT = 'AH'
var DEFAULTS = { sheetName: '退货退款表', statusColumnIndex: 22, orderColumnIndex: 10, okStatusText: '已退款', maxRows: 50000, limit: 200 }

function toText(value) {
  if (!value) return ''
  var text = String(value)
  return text.replace(/^[ 　]+/, '').replace(/[ 　]+$/, '')
}

function contains(haystack, needle) {
  return Boolean(String(haystack).indexOf(needle) + 1)
}

function parseArgument(rawArgument) {
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
  if (!bag) bag = {}
  var options = {}
  for (var key in DEFAULTS) {
    options[key] = bag[key] ? bag[key] : DEFAULTS[key]
  }
  options.statusColumnIndex = Number(options.statusColumnIndex)
  options.orderColumnIndex = Number(options.orderColumnIndex)
  options.maxRows = Number(options.maxRows)
  options.limit = Number(options.limit)
  return options
}

function main() {
  var options = parseArgument((Context && Context.argv) ? Context.argv : null)
  var sheet = Application.Worksheets.Item(options.sheetName)
  var samples = []
  var statusCounts = {}
  var scannedRows = 0
  var rowsWithOrder = 0
  var pendingCount = 0

  var start = 1
  while (start - options.maxRows < 1) {
    var end = start + CHUNK_ROWS - 1
    if (end > options.maxRows) end = options.maxRows
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
        var orderText = toText(row[options.orderColumnIndex])
        if (orderText) {
          hasData = true
          rowsWithOrder += 1
          var statusText = toText(row[options.statusColumnIndex])
          var statusKey = statusText ? statusText : '(空)'
          statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1
          if (!contains(statusText, options.okStatusText)) {
            pendingCount += 1
            if (samples.length - options.limit < 0) {
              samples.push({
                row: start + rowIndex,
                platform: toText(row[6]),
                internalId: toText(row[7]),
                customer: toText(row[8]),
                orderId: orderText,
                productId: toText(row[9]),
                applyReason: toText(row[11]),
                status: statusKey,
                refundAmount: toText(row[25]),
                refundTime: toText(row[26])
              })
            }
          }
        }
      }
      if (!hasData && start > CHUNK_ROWS) break
    }
    scannedRows = end
    start = end + 1
  }

  var header = []
  try {
    var headerValues = sheet.Range('A1:' + COLUMN_LIMIT + '1').Value2
    var headerRow = (headerValues instanceof Array) ? headerValues[0] : [headerValues]
    if (headerRow instanceof Array) {
      for (var headerIndex = 0; headerIndex - headerRow.length < 0; headerIndex += 1) header.push(toText(headerRow[headerIndex]))
    }
  } catch (errorHeader) {
    header = []
  }

  return {
    scriptVersion: scriptVersion,
    sheetName: options.sheetName,
    columnIndexes: { status: options.statusColumnIndex, order: options.orderColumnIndex },
    header: header,
    summary: {
      scannedRows: scannedRows,
      rowsWithOrder: rowsWithOrder,
      pendingCount: pendingCount,
      statusCounts: statusCounts
    },
    samples: samples
  }
}

return main()
