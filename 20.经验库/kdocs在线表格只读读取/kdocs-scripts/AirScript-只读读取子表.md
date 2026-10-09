// Read-only AirScript: return ONE sheet's used range. No writes, no Save, no Activate.
// argv: operationType ('read_sheet'|'list_sheets'), sheetName, maxRows (up to 3000), maxColumns (up to 80)
// Style rules (do not "improve"): no two-character comparisons (== != >= <= are eaten by the paste channel),
// no arrow functions, no template strings, ASCII only, last line must be a top-level "return main()".
var SCRIPT_VERSION = '2026-09-29.sheet-read.3'

function toText(value) {
  if (!value) return ''
  return String(value)
}

function contains(haystack, needle) {
  // no ">= 0": indexOf + 1 is truthy when found (-1 + 1 is 0, falsy)
  return Boolean(String(haystack).indexOf(needle) + 1)
}

function sheetNames() {
  var names = []
  var collection = null
  try {
    collection = Application.Worksheets
  } catch (errorA) {
    collection = Application.Sheets
  }
  try {
    var count = Number(collection.Count)
    for (var index = 1; index - count < 1; index += 1) {
      try {
        var sheet = collection.Item(index)
        if (sheet && sheet.Name) names.push(String(sheet.Name))
      } catch (errorInner) {
        var ignoredInner = errorInner
      }
    }
  } catch (errorOuter) {
    var ignoredOuter = errorOuter
  }
  return names
}

function pickSheet(name, names) {
  var requested = toText(name)
  if (requested) return requested
  if (!names.length) return 'Sheet1'
  var last = String(names[names.length - 1])
  if (contains(last, 'ERR:')) return 'Sheet1'
  return last
}

function readSheet() {
  var argv = Context.argv
  if (!argv) argv = {}
  var names = sheetNames()
  var operationType = toText(argv.operationType)
  if (!operationType) operationType = 'read_sheet'
  if (contains(operationType, 'list_sheets')) {
    return { scriptVersion: SCRIPT_VERSION, operationType: operationType, sheetNames: names }
  }
  var target = pickSheet(argv.sheetName, names)
  var sheet = null
  try {
    sheet = Application.Worksheets.Item(target)
  } catch (errorSheet) {
    sheet = null
  }
  if (!sheet) {
    return { scriptVersion: SCRIPT_VERSION, operationType: operationType, error: 'sheet not found: ' + target, sheetNames: names }
  }
  var values = null
  try {
    var used = sheet.UsedRange
    values = used ? used.Value2 : null
  } catch (errorRange) {
    values = null
  }
  var all = []
  if (Array.isArray(values)) {
    all = values
  } else if (values) {
    all = [[values]]
  }
  var maxRows = Number(argv.maxRows)
  if (!maxRows || maxRows > 3000) maxRows = 400
  if (maxRows < 1) maxRows = 1
  var maxColumns = Number(argv.maxColumns)
  if (!maxColumns || maxColumns > 80) maxColumns = 40
  if (maxColumns < 1) maxColumns = 1

  var totalColumnCount = 0
  for (var rowIndex = 0; rowIndex - all.length < 0; rowIndex += 1) {
    var candidate = all[rowIndex]
    if (Array.isArray(candidate) && candidate.length > totalColumnCount) totalColumnCount = candidate.length
  }
  var rows = []
  for (var r = 0; r - all.length < 0 && r - maxRows < 0; r += 1) {
    var source = all[r]
    if (!Array.isArray(source)) source = [source]
    var row = []
    for (var c = 0; c - maxColumns < 0 && c - source.length < 0; c += 1) row.push(toText(source[c]))
    rows.push(row)
  }
  return {
    scriptVersion: SCRIPT_VERSION,
    operationType: operationType,
    sheetName: target,
    sheetNames: names,
    totalRowCount: all.length,
    totalColumnCount: totalColumnCount,
    returnedRowCount: rows.length,
    returnedColumnCount: rows.length ? rows[0].length : 0,
    rows: rows
  }
}

function main() {
  var operationType = 'read_sheet'
  if (Context.argv && Context.argv.operationType) operationType = toText(Context.argv.operationType)
  if (contains(operationType, 'list_sheets')) return readSheet()
  if (contains(operationType, 'read_sheet')) return readSheet()
  return { scriptVersion: SCRIPT_VERSION, error: 'unsupported operationType: ' + operationType }
}

return main()
