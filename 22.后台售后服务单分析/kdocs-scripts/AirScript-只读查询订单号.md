// 金山《2026年【湖南怀化售后】对接表》只读查询脚本　版本 2026-09-18.1
//
// 用途：给 AI（22号 后台售后服务单分析）查订单号 / 关键字用——在整份文档的**所有工作表**里查找，
//       只返回命中行。**只读**：只调用 Range(...).Value2 读取，不调用 Save / Add / ClearContents / Activate，
//       也不给任何属性赋值。
//
// 为什么需要它：网页版表格的运行时只把「当前窗口」的数据加载进内存（实测 退货退款表 真实 46503 行，
// 匿名读只拿到 29412 行），所以直接在浏览器里读会漏行；AirScript 在云端读整表，不受这个限制。
//
// 部署（用户做一次，约 2 分钟）：
//   1) 打开 https://www.kdocs.cn/l/ccj1mhG3wLy6 → 顶部「效率」→「高级开发」→「AirScript」（或「自动化流程/AirScript」入口）
//   2) 新建脚本，把本文件**全部内容**粘进去，保存（脚本名建议：只读查询订单号）
//   3) 生成/查看该脚本的「脚本 Token」与「同步 webhook 地址」，把这两个值给 AI（写进 22号 的 project-config，不进 git）
//
// 调用：POST <webhookUrl>   Header: AirScript-Token: <token>
//       Body: {"Context":{"argv":[{"keywords":["5127667812586099609"],"maxRows":50000}]}}
//       可选：{"sheets":["退货退款表","异常件"]} 只查指定表（快）；默认全部工作表。
// 返回：{ scriptVersion, keywords, checkedSheets, scannedRows, sheetDetails[], matchCount, matches[] }
//
// 注意：keywords 建议至少 6 位（订单号/售后单号），避免短词命中噪音。

const scriptVersion = '2026-09-18.1'
const MAX_MATCHES = 40
const COLUMN_LIMIT = 'AH'   // 读到第 34 列，与「退货退款表」最大列对齐
const CHUNK_ROWS = 2000

function toText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  return String(value).trim()
}

function sheetNames() {
  const names = []
  const count = Application.Worksheets.Count
  for (let index = 1; index <= count; index += 1) {
    try { names.push(Application.Worksheets.Item(index).Name) } catch (_error) { /* 跳过读不到的表 */ }
  }
  return names
}

function scanSheet(name, keywords, maxRows) {
  const sheet = Application.Worksheets.Item(name)
  const matches = []
  let scanned = 0
  for (let start = 1; start <= maxRows; start += CHUNK_ROWS) {
    const end = Math.min(start + CHUNK_ROWS - 1, maxRows)
    let values = null
    try { values = sheet.Range('A' + start + ':' + COLUMN_LIMIT + end).Value2 } catch (_error) { values = null }
    if (!values) continue
    const rows = Array.isArray(values) ? values : [values]
    let chunkHasData = false
    for (let r = 0; r < rows.length; r += 1) {
      const row = Array.isArray(rows[r]) ? rows[r] : [rows[r]]
      let hit = false
      for (let c = 0; c < row.length; c += 1) {
        const text = toText(row[c])
        if (!text) continue
        chunkHasData = true
        for (let k = 0; k < keywords.length; k += 1) {
          if (text.indexOf(keywords[k]) >= 0) { hit = true; break }
        }
        if (hit) break
      }
      if (hit) {
        matches.push({
          sheet: name,
          row: start + r,
          values: row.map(toText).filter(function (text) { return text })
        })
      }
    }
    scanned = end
    if (!chunkHasData && start > CHUNK_ROWS) break   // 连续空块：提前收尾，避免空跑
  }
  return { matches: matches, scanned: scanned }
}

function main() {
  const argv = (Context && Context.argv) || []
  const options = (argv[0] && typeof argv[0] === 'object') ? argv[0] : { keywords: argv }
  const keywords = (options.keywords || [])
    .map(toText)
    .filter(function (text) { return text.length >= 6 })
  const maxRows = Number(options.maxRows || 50000)
  const allNames = sheetNames()
  const targets = (options.sheets && options.sheets.length)
    ? options.sheets.filter(function (name) { return allNames.indexOf(name) >= 0 })
    : allNames

  const matches = []
  const details = []
  for (let s = 0; s < targets.length; s += 1) {
    const result = scanSheet(targets[s], keywords, maxRows)
    details.push({ sheet: targets[s], rows: result.scanned, hits: result.matches.length })
    for (let m = 0; m < result.matches.length && matches.length < MAX_MATCHES; m += 1) {
      matches.push(result.matches[m])
    }
    if (matches.length >= MAX_MATCHES) break
  }

  let scannedRows = 0
  for (let d = 0; d < details.length; d += 1) scannedRows += details[d].rows

  return {
    scriptVersion: scriptVersion,
    keywords: keywords,
    checkedSheets: targets.length,
    scannedRows: scannedRows,
    sheetDetails: details,
    matchCount: matches.length,
    matches: matches
  }
}

main()
