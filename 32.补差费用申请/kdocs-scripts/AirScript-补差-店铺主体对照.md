var scriptVersion = '2026-10-08.1'

// 《好评返现，返差价、运费汇总表【打印版】》子表「店铺-主体对照」维护脚本（**AirScript 2.0 Beta**）。
//
// 【干什么】只维护一张工作表：『店铺-主体对照』（不存在就新建）。
//   列（第 1 行表头，固定 5 列）：源表店铺名 | 目标表店铺名 | 主体 | 是否进主体子表 | 备注
//   - 目标表店铺名：没有改名规则时 = 源表名；有（如 抖音02店 → DY03店德达抖音旗舰店）写目标名；
//   - 是否进主体子表：是 / 否（无子表）/ 否（无主体）；
//   - 备注：冲突/存疑写「待确认」。
//
// 【动作】POST <本脚本同步 webhook>  Header: AirScript-Token: <token>   Body: {"Context":{"argv":{...}}}
//   探针（只读）  {"action":"探针"}    → 本表在不在、现有行数/表头/工作表清单
//   读对照（只读）{"action":"读对照"}  → 全表 5 列（表头 + 数据行）
//   刷对照（写）  {"action":"刷对照","行列表":"[[5列]…的JSON字符串]","allowWrite":true}
//     （行数组也接受原生/宿主数组：服务器 转净数组() 三种形态都兼容）
//
// 【安全守卫（顺序不能改）】
//   1) 只认工作表『店铺-主体对照』；本脚本从头到尾只出现这一个工作表名常量，不访问别的工作表；
//   2) 没有 allowWrite:true → 写动作一个字节都不写（探针/读对照永远只读）；
//   3) 写入行域 = 第 1 行表头 + 数据行 [2, 1+行数]：
//      - 表已存在：先校验表头（5 列逐字一致），不一致 → 停手一个字节不写；
//      - 旧数据比新数据长时，写前把多出来的行清掉，清了多少行/清到哪都在报告里；
//   4) 写完立刻逐格回读比对（written / 写入行数 / 回读差异数），写没写对不靠肉眼。
//
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、字符串相等用等长 indexOf、比大小用减法。别改回去。

var 对照表名 = '店铺-主体对照'
var 列数 = 5
var 表头 = ['源表店铺名', '目标表店铺名', '主体', '是否进主体子表', '备注']
var 扫描上限 = 1000
var 行数上限 = 800

// ———————— 基础工具 ————————

function 文本(值) {
  if (!值) return ''
  return String(值).replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '')
}

// 字符串相等（不用双等号：等长 + indexOf；不等长直接 false）
function 等(a, b) {
  var x = String(a), y = String(b)
  if (x.length - y.length) return false
  return x.indexOf(y) + 1 > 0
}

function 含(s, 子串) {
  return String(s).indexOf(子串) + 1 > 0
}

// 是不是数组：不用 instanceof（webhook 入站数组是宿主对象，instanceof 会误判），
// 用「有数字 length」鸭子判定；字符串有 length，先排除。
function 是数组(值) {
  if (!值) return false
  if (含(typeof 值, 'string')) return false
  var 数 = Number(值.length)
  if (!isFinite(数) || 数 < 0) return false
  return true
}

// 入站行数组 → 本脚本 realm 的原生二维数组。接受三种形态：
//   ① JSON 字符串（客户端这样传，最稳）；② 宿主数组（能下标、有 length，但 instanceof 为 false）；③ 原生数组。
// 返回 [] 表示拿不到有效行（调用方按“缺行”处理）。
function 转净数组(值) {
  var 出 = []
  if (!值) return 出
  if (含(typeof 值, 'string')) {
    try { 值 = JSON.parse(String(值)) } catch (错误解析) { return 出 }
  }
  if (!是数组(值)) return 出
  var 数 = Number(值.length)
  for (var i = 0; i < 数; i += 1) {
    var 行 = 值[i]
    var 列数 = NaN
    try { 列数 = Number(行.length) } catch (错误行) { 列数 = NaN }
    if (含(typeof 行, 'string') || !isFinite(列数) || 列数 < 0) { 出.push([行]); continue }
    var 净行 = []
    for (var j = 0; j < 列数; j += 1) 净行.push(行[j])
    出.push(净行)
  }
  return 出
}

// 入参形态（失败留现场用，写进返回报告）
function 入参形态(值) {
  var 形 = { 类型: String(typeof 值), 长度: '无' }
  try { 形.长度 = String(值.length) } catch (错误形) {}
  return 形
}

function 规整(值) {
  if (值 instanceof Array) {
    if (值.length && (值[0] instanceof Array)) return 值
    return [值]
  }
  return [[值]]
}

// 从规整二维里取第 行、列（1 基）的文本；行不是数组时按标量兜底
function 格(区, 行, 列) {
  var r = 区[行 - 1]
  if (!r) return ''
  if (r instanceof Array) return 文本(r[列 - 1])
  return 文本(r)
}

function 列名(n) { return String.fromCharCode(64 + n) }

function 取表(名) {
  var 表 = null
  try { 表 = Application.Worksheets.Item(名) } catch (错误) { 表 = null }
  if (表) return 表
  // 兜底：有些版本 Item 只收序号，遍历比对表名
  try {
    var 册 = Application.Worksheets, 数 = 册.Count
    for (var i = 1; i <= 数; i += 1) {
      var s = 册.Item(i)
      if (s && 等(s.Name, 名)) return s
    }
  } catch (错误2) {}
  return null
}

// 对照表在 A 列最后一个非空格的行号（数据从第 2 行起；第 1 行是表头；空表 = 0）
function 扫末行(表) {
  var 区 = 规整(表.Range('A1:A' + 扫描上限).Value2)
  var 末 = 0
  for (var i = 0; i < 区.length; i += 1) {
    if (格(区, i + 1, 1)) 末 = i + 1
  }
  return 末
}

function 读块(表, 起行, 列数, 行数) {
  var 区 = 规整(表.Range('A' + 起行 + ':' + 列名(列数) + (起行 + 行数 - 1)).Value2)
  var 出 = []
  for (var i = 1; i <= 行数; i += 1) {
    var 行 = []
    for (var c = 1; c <= 列数; c += 1) 行.push(格(区, i, c))
    出.push(行)
  }
  return 出
}

// 值对比：空白/大小写不管、'-' 和 '/' 归一、纯数字按数值比
function 同值(a, b) {
  var x = 文本(a).split('-').join('/'), y = 文本(b).split('-').join('/')
  if (x.length - y.length) {
    var nx = Number(x), ny = Number(y)
    if (isFinite(nx) && isFinite(ny)) return Math.abs(nx - ny) < 0.0000001
    return false
  }
  return x.indexOf(y) + 1 > 0
}

// 期望二维 vs 实际二维逐格比；返回差异列表（最多 12 条）
function 对比块(期望, 实际, 列数) {
  var 差异 = []
  for (var i = 0; i < 期望.length; i += 1) {
    var 实 = 实际[i] instanceof Array ? 实际[i] : [实际[i]]
    for (var c = 1; c <= 列数; c += 1) {
      var 期v = 期望[i][c - 1]
      var 实v = 实 ? 实[c - 1] : ''
      if (!同值(期v, 实v)) {
        差异.push({ 行: i + 1, 列: c, 期望: 文本(期v).slice(0, 40), 实际: 文本(实v).slice(0, 40) })
        if (差异.length > 11) return 差异
      }
    }
  }
  return 差异
}

// ———————— 建表 ————————

// 新建工作表『店铺-主体对照』。AirScript 版本差异大，三种形态依次试：
//   ① 2.0 文档形态 Sheets.Add(Before, After, Count, Type, Name)
//   ② 简写 Sheets.Add(null, After, 1)
//   ③ 1.0 文档形态 Worksheets.Add(Before, After, Count)
// 都失败返回 null（由调用方拒绝，不硬闯）。
function 建对照表() {
  var 新 = null
  var 参照名 = ''
  try {
    var 册 = Application.Worksheets
    if (册.Count > 0) 参照名 = String(册.Item(册.Count).Name)
  } catch (错误取末) { 参照名 = '' }
  try {
    var 枚 = null
    try { 枚 = Application.Enum.XlSheetType.xlWorksheet } catch (错误枚) { 枚 = null }
    if (枚) 新 = Application.Sheets.Add(null, 参照名, 1, 枚, 对照表名)
  } catch (错误1) { 新 = null }
  if (!新) {
    try { 新 = Application.Sheets.Add(null, 参照名, 1) } catch (错误2) { 新 = null }
  }
  if (!新) {
    try { 新 = Application.Worksheets.Add(参照名, null, 1) } catch (错误3) { 新 = null }
  }
  if (!新) return null
  // 名称兜底：有的版本 Add 的第 5 参不生效
  try { if (!等(文本(新.Name), 对照表名)) 新.Name = 对照表名 } catch (错误名) {}
  return 新
}

// ———————— 各动作 ————————

function 执行探针() {
  var 报告 = { scriptVersion: scriptVersion, 模式: '探针' }
  var 名 = []
  try {
    var 册 = Application.Worksheets, 数 = 册.Count
    for (var i = 1; i <= 数; i += 1) 名.push(String(册.Item(i).Name))
  } catch (错误) { 报告.工作表报错 = String(错误.message ? 错误.message : 错误) }
  报告.工作表 = 名
  var 表 = 取表(对照表名)
  if (!表) {
    报告.对照表 = { 存在: false, 说明: '工作表『' + 对照表名 + '』不存在；刷对照 会自动新建' }
    return 报告
  }
  var 末 = 扫末行(表)
  var 头 = 末 ? 读块(表, 1, 列数, 1)[0] : []
  var 差异 = []
  if (末) {
    for (var c = 0; c < 列数; c += 1) {
      if (!同值(表头[c], 头[c])) 差异.push('C' + (c + 1) + ' 期望[' + 表头[c] + '] 实际[' + 头[c] + ']')
    }
  }
  报告.对照表 = { 存在: true, 末行: 末, 数据行数: 末 > 1 ? 末 - 1 : 0, 表头: 头, 表头差异: 差异 }
  return 报告
}

function 执行读对照() {
  var 报告 = { scriptVersion: scriptVersion, 模式: '读对照' }
  var 表 = 取表(对照表名)
  if (!表) {
    报告.存在 = false
    报告.message = '工作表『' + 对照表名 + '』不存在（先 刷对照 初始化）'
    return 报告
  }
  var 末 = 扫末行(表)
  if (末 < 1) {
    报告.存在 = true
    报告.末行 = 0
    报告.数据行数 = 0
    报告.表头 = []
    报告.行列表 = []
    return 报告
  }
  var 区 = 读块(表, 1, 列数, 末)
  报告.存在 = true
  报告.末行 = 末
  报告.表头 = 区[0]
  报告.数据行数 = 末 - 1
  报告.行列表 = 区.slice(1)
  return 报告
}

function 执行刷对照(参数) {
  var 报告 = { scriptVersion: scriptVersion, 模式: '刷对照' }
  if (!参数.allowWrite) {
    报告.written = false
    报告.message = '没有 allowWrite:true，拒绝执行（写动作一个字节都不写）'
    return 报告
  }
  var 行 = 转净数组(参数.行列表)
  if (!行.length) {
    报告.written = false
    报告.message = '没有行列表（行列表 转净数组 后为空；客户端必须传 5 列行数组的 JSON 字符串）'
    报告.入参形态 = 入参形态(参数.行列表)
    return 报告
  }
  if (行.length > 行数上限) {
    报告.written = false
    报告.message = '行列表 ' + 行.length + ' 行，超过硬上限 ' + 行数上限 + '，停手'
    return 报告
  }
  var 表 = 取表(对照表名)
  var 新建 = false
  if (!表) {
    表 = 建对照表()
    新建 = true
  }
  if (!表) {
    报告.written = false
    报告.message = '建工作表『' + 对照表名 + '』失败（Sheets.Add / Worksheets.Add 都不可用）'
    return 报告
  }
  // 已存在的表：表头必须逐字一致（空白表除外）
  var 旧末 = 扫末行(表)
  var 旧头 = 旧末 ? 读块(表, 1, 列数, 1)[0] : []
  var 旧头空 = true
  for (var c = 0; c < 列数; c += 1) { if (文本(旧头[c])) 旧头空 = false }
  if (!旧头空) {
    var 头差 = []
    for (var c2 = 0; c2 < 列数; c2 += 1) {
      if (!同值(表头[c2], 旧头[c2])) 头差.push('C' + (c2 + 1) + ' 期望[' + 表头[c2] + '] 实际[' + 旧头[c2] + ']')
    }
    if (头差.length) {
      报告.written = false
      报告.message = '『' + 对照表名 + '』表头不对，停手（一个字节都不写）'
      报告.表头差异 = 头差
      return 报告
    }
  }
  // 规整每行为固定 5 列（多余列不写、缺列补空；非数组行算坏行跳过）
  var 净行 = []
  var 坏行 = 0
  var 列修正 = 0
  for (var i = 0; i < 行.length; i += 1) {
    if (!是数组(行[i])) { 坏行 += 1; continue }
    var 本 = []
    for (var j = 0; j < 列数; j += 1) 本.push(文本(行[i][j]))
    if (Number(行[i].length) - 列数) 列修正 += 1
    净行.push(本)
  }
  if (!净行.length) {
    报告.written = false
    报告.message = '行列表里没有有效行，停手'
    报告.坏行数 = 坏行
    return 报告
  }
  var 新末 = 净行.length + 1
  // 旧数据比新数据长 → 先把多出来的行清掉（只清 A~E，不动别的列/别的工作表）
  var 清理 = ''
  if (旧末 > 新末) {
    表.Range('A' + (新末 + 1) + ':E' + 旧末).ClearContents()
    清理 = 'A' + (新末 + 1) + ':E' + 旧末 + '（' + (旧末 - 新末) + ' 行）'
  }
  if (旧头空) 表.Range('A1:E1').Value2 = [表头]
  表.Range('A2:E' + 新末).Value2 = 净行
  // 回读逐格比对
  var 期望 = [表头]
  for (var k = 0; k < 净行.length; k += 1) 期望.push(净行[k])
  var 实 = 读块(表, 1, 列数, 新末)
  var 差异 = 对比块(期望, 实, 列数)
  报告.written = true
  报告.新建 = 新建
  报告.写前末行 = 旧末
  报告.清理 = 清理
  报告.写入行数 = 净行.length
  报告.数据末行 = 新末
  报告.坏行数 = 坏行
  报告.列数修正 = 列修正
  报告.回读行数 = 实.length
  报告.回读差异数 = 差异.length
  报告.差异样例 = 差异.slice(0, 5)
  报告.表头 = 读块(表, 1, 列数, 1)[0]
  return 报告
}

function 解析参数() {
  var 裸 = null
  try { if (Context) 裸 = Context.argv } catch (错误) { 裸 = null }
  if (!裸) 裸 = {}
  // 平台把 argv 传成 JSON 字符串 / 数组 / 对象都遇到过（22号 实测）；统一规范成对象
  if (含(typeof 裸, 'string')) {
    try { 裸 = JSON.parse(String(裸)) } catch (错误2) { 裸 = {} }
  }
  if (!裸.action && 裸[0]) 裸 = 裸[0]
  if (含(typeof 裸, 'string')) {
    try { 裸 = JSON.parse(String(裸)) } catch (错误3) { 裸 = {} }
  }
  if (!裸 || 含(typeof 裸, 'string')) 裸 = {}
  return 裸
}

function main() {
  var 参数 = 解析参数()
  var 动作 = 文本(参数.action)
  if (等(动作, '探针') || !动作) return 执行探针()
  if (等(动作, '读对照')) return 执行读对照()
  if (等(动作, '刷对照')) return 执行刷对照(参数)
  return { scriptVersion: scriptVersion, message: '不认识的 action：' + 动作 }
}

return main()
