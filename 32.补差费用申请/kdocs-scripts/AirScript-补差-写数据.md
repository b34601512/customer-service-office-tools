var scriptVersion = '2026-10-08.1'

// 《好评返现，返差价、运费汇总表【打印版】》「写数据」脚本（**必须建 AirScript 2.0 Beta 脚本**）。
// 【从哪来】2026-10-08 从现役 v6《AirScript-补差-写入.md》拆出的两个大事件之一（另一个 = 刷新与税金）。
//   拆分目的：以后维护只改对应脚本，单个脚本改动不牵动全部内容。v6 在线上继续跑，直到本脚本验证通过。
// 【干什么】把《2026年【补差】登记总表》里「付款时间=上月」的行：
//   ① 追加到本文件『汇总』表尾（汇总行 18 列：购买日期…申请日期+4 列留给怀化工厂登记）；
//   ② 覆盖写入对应的主体子表（A4 起 12 列：姓名…责任人），并清掉多出来的旧行 + 清掉右侧
//      「怀化工厂登记（M~P 列）」的历史信息（黎路遥授权，抹前已快照）。
//
// 【动作】POST <本脚本同步 webhook>  Header: AirScript-Token: <token>   Body: {"Context":{"argv":{...}}}
//   探针（只读）   {"action":"探针"}
//   预演（只读）   {"action":"预演","汇总预期末行":1672,"集团预期末行":19,"器械预期末行":12}
//   写汇总         {"action":"写汇总","汇总行":"[[18列]…的JSON字符串]","预期末行":1672,"allowWrite":true}
//   写主体         {"action":"写主体","集团行":"[[12列]…]","器械行":"[[12列]…]","预期":{"集团":19,"器械":12},"allowWrite":true}
//   （行数组也接受原生/宿主数组：服务器 转净数组() 三种形态都兼容）
//   没有 allowWrite:true → 写动作一个字节都不写，只回当前状态。
//
// 【安全设计（顺序不能改）】
//   1) 没有 allowWrite 不写；探针/预演永远只读；
//   2) 写前查表头 + 末行对不对（防并行改表/重复导入），不一致就拒绝；
//   3) 订单号/账号/转账单号这些长数字列先设文本格式（'@'），防丢精度；
//   4) 【2026-10-08 新修·黎路遥发现的「申请日期未识别为日期」】日期列（汇总 A 购买日期/N 申请日期；
//      主体 H 处理时间）不设 '@'，写**日期数值（序列号）** + **显式设日期格式 yyyy/m/d**
//      （NumberFormat 与 NumberFormatLocal 都设），不再只靠「抄上一行格式」：
//      v6 把 N(申请日期) 当文本列设 '@'、写字符串 "2026/10/8" → WPS 标「未识别为日期」；
//      现在入参日期串先过 日期序() 归一成序列号再写，写完逐格回读比对（同值() 认日期串与序列号同值）。
//   5) 写完立刻回读逐格比对，写没写对不靠肉眼。
//
// 【粘贴方式】打开《好评返现，返差价、运费汇总表【打印版】》→ 效率 → 高级开发 → AirScript 脚本编辑器
//   → 左侧「+」旁边的下拉选 **AirScript 2.0 Beta（推荐）** → 新建脚本「补差-写数据」→ 清空默认内容 → 粘全文
//   → 保存 → 脚本「更多」里复制「同步 webhook」→ 填进本机 32号 project-config/kdocs-airscript.local.json 的
//     scripts.写数据.webhookUrl（别动已有的 scripts.write_bucha）。
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、字符串相等用等长 indexOf、比大小用减法。别改回去。

var 汇总表名 = '汇总'
var 集团表名 = '深圳市德达医疗科技集团有限公司'
var 器械表名 = '深圳市德达医疗器械有限公司'
var 汇总列数 = 18
var 主体列数 = 12
// 长数字列（先设 '@' 文本格式防丢精度）：汇总 = 支付宝/微信账号、订单编号、转账单号；主体 = 收款方式、订单编号、转账单号
var 汇总文本列 = [3, 5, 10]
var 主体文本列 = [2, 4, 9]
// 日期列（写序列号 + 显式日期格式）：汇总 A 购买日期(1)、N 申请日期(14)；主体 H 处理时间(8)
//   （主体 H 现在多是「交易成功/退货」状态文本：日期序() 认不出的文本原样保留，不受影响）
var 汇总日期列 = [1, 14]
var 主体日期列 = [8]
var 日期格式 = 'yyyy/m/d'
var 汇总表头 = ['购买日期', '姓名', '支付宝/微信账号', '店铺', '订单编号', '产品', '费用类型', '金额', '处理时间', '转账单号', '原因', '费用责任部门', '主体', '申请日期', '客户反馈\n故障现象', '品质工程师\n确认结果', '维修内容及更换配件', '责任归属']
var 主体表头 = ['姓名', '收款方式', '店铺', '订单编号', '型号', '类型', '金额', '处理时间', '转账单号', '原因简述', '责任部门', '责任人']

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

// 是不是公式（以等号开头）——不用双等号，用字符 indexOf
function 是公式(值) {
  var s = 值 ? String(值) : ''
  if (!s.length) return false
  return s.slice(0, 1).indexOf('=') + 1 > 0
}

// 是不是 0（预演/守卫比较用；不用双等号）
function 是零(x) { return Math.abs(Number(x)) < 0.0000001 }

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
//   ① JSON 字符串（客户端现在这样传，最稳）；② 宿主数组（能下标、有 length，但 instanceof 为 false）；③ 原生数组。
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

// 入站对象 → 对象（字符串就先 JSON.parse）
function 转对象(值) {
  if (!值) return {}
  if (含(typeof 值, 'string')) {
    try { return JSON.parse(String(值)) } catch (错误解析2) { return {} }
  }
  return 值
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

// 汇总表：A 列最后一个非空格的行号（数据从第 2 行起；第 1 行是表头）
function 汇总末行(表) {
  var 区 = 规整(表.Range('A1:A8000').Value2)
  var 末 = 0
  for (var i = 0; i < 区.length; i += 1) {
    if (格(区, i + 1, 1)) 末 = i + 1
  }
  return 末
}

// 主体子表：数据从第 4 行起，A 列连着数，最后一个非空行（允许中间最多 3 行空）。
// 透视表在数据区下面（「求和项/店铺/总计」也写在 A 列），扫描必须在透视锚点前停住，
//   否则会把透视区当数据末行（预演守卫不过、清除范围会误伤透视表）。
function 主体末行(表) {
  var 止 = 120
  var 找 = 找透视(表)
  if (找 && 找.锚行 > 5) 止 = 找.锚行 - 1
  var 区 = 规整(表.Range('A4:A' + 止).Value2)
  var 末 = 3
  var 空计数 = 0
  for (var i = 0; i < 区.length; i += 1) {
    if (格(区, i + 1, 1)) { 末 = i + 4; 空计数 = 0 } else { 空计数 += 1; if (空计数 > 3) break }
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

// 日期归一：'2023/2/28' 与序列号 '44985' 都 →「距 1899-12-30 的天数」；不是日期返回 NaN。
// （2026-10-08.4：日期格式列写日期串、Value2 回读是序列号，两者必须视作同值）
function 日期序(值) {
  var 字 = 文本(值).split('-').join('/')
  var 段 = 字.split('/')
  if (段.length - 3) {
    if (字.length > 0 && 字.length < 7 && isFinite(Number(字))) {
      var 数 = Number(字)
      if (数 > 20000 && 数 < 80000) return Math.round(数)
    }
    return NaN
  }
  var 年 = Number(段[0]), 月 = Number(段[1]), 日 = Number(段[2])
  if (isFinite(年) && isFinite(月) && isFinite(日) && 年 > 1899 && 月 > 0 && 月 < 13 && 日 > 0 && 日 < 32) {
    return Math.round((Date.UTC(年, 月 - 1, 日) - Date.UTC(1899, 11, 30)) / 86400000)
  }
  return NaN
}

// 值对比：空白/大小写不管、'-' 和 '/' 归一、数字按数值比、日期串与序列号视作同值
function 同值(a, b) {
  var 甲 = 日期序(a), 乙 = 日期序(b)
  if (isFinite(甲) && isFinite(乙)) return 是零(甲 - 乙)
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

// 按上一行逐列抄格式；文本列强设 '@'（防长数字丢精度/被解析）
function 抄格式并设文本(表, 上1行, 起行, 行数, 文本列) {
  var 止行 = 起行 + 行数 - 1
  for (var c = 1; c <= 40; c += 1) {
    var 格式 = ''
    try { 格式 = String(表.Cells(上1行, c).NumberFormat) } catch (错误) { 格式 = '' }
    if (!格式) continue
    try { 表.Range(列名(c) + 起行 + ':' + 列名(c) + 止行).NumberFormat = 格式 } catch (错误2) {}
  }
  for (var k = 0; k < 文本列.length; k += 1) {
    var c = 文本列[k]
    try { 表.Range(列名(c) + 起行 + ':' + 列名(c) + 止行).NumberFormat = '@' } catch (错误3) {}
    try { 表.Range(列名(c) + 起行 + ':' + 列名(c) + 止行).NumberFormatLocal = '@' } catch (错误4) {}
  }
}

// 【2026-10-08 新修】日期列显式设日期格式（不靠抄上一行格式）：
//   本地格式与显示格式都设，写完 Value2 回读才是「数值」而不是「未识别为日期的文本」。
function 设日期格式(表, 起行, 止行, 日期列) {
  for (var k = 0; k < 日期列.length; k += 1) {
    var c = 日期列[k]
    try { 表.Range(列名(c) + 起行 + ':' + 列名(c) + 止行).NumberFormat = 日期格式 } catch (错误1) {}
    try { 表.Range(列名(c) + 起行 + ':' + 列名(c) + 止行).NumberFormatLocal = 日期格式 } catch (错误2) {}
  }
}

// 日期列的值归一：日期串/序列号串 → 序列号数字；认不出的（如「交易成功」）原样返回。
function 装日期值(值) {
  var 序 = 日期序(值)
  if (isFinite(序)) return 序
  return 值
}

// 行数组里的日期列逐格归一（不改其它列、不改空值）。
function 归一日期列(行数组, 日期列) {
  var 出 = []
  for (var i = 0; i < 行数组.length; i += 1) {
    var 行 = 行数组[i]
    var 新行 = []
    for (var c = 0; c < 行.length; c += 1) {
      var 列号 = c + 1
      var 要归一 = false
      for (var k = 0; k < 日期列.length; k += 1) { if (是零(列号 - 日期列[k])) 要归一 = true }
      var v = 行[c]
      if (要归一 && v) v = 装日期值(v)
      新行.push(v)
    }
    出.push(新行)
  }
  return 出
}

// 写一块：先整块 Value2，再对「=…」公式格单独写 Formula（DISPIMG 图片）
function 写块(表, 起行, 行数组, 列数) {
  var 止行 = 起行 + 行数组.length - 1
  表.Range('A' + 起行 + ':' + 列名(列数) + 止行).Value2 = 行数组
  for (var i = 0; i < 行数组.length; i += 1) {
    var 行 = 行数组[i] instanceof Array ? 行数组[i] : [行数组[i]]
    for (var c = 0; c < 行.length; c += 1) {
      if (是公式(行[c])) {
        try { 表.Cells(起行 + i, c + 1).Formula = String(行[c]) } catch (错误) {}
      }
    }
  }
}

// ———————— 透视表 ————————

// 在 A 列找到透视表的「求和项…」锚点，再拿该格的 PivotTable 对象
function 找透视(表) {
  var 区 = 规整(表.Range('A1:A200').Value2)
  for (var i = 0; i < 区.length; i += 1) {
    if (含(格(区, i + 1, 1), '求和项')) {
      var 行 = i + 1
      var p = null
      try { p = 表.Cells(行, 1).PivotTable } catch (错误) { p = null }
      if (!p) { try { p = 表.Range('A' + 行).PivotTable } catch (错误2) { p = null } }
      if (p) return { 透视: p, 锚行: 行 }
      return { 透视: null, 锚行: 行 }
    }
  }
  return null
}

// ———————— 各动作 ————————

function 表头检查(表, 行号, 列数, 期望) {
  var 实际 = 读块(表, 行号, 列数, 1)[0]
  var 差异 = []
  for (var c = 0; c < 期望.length; c += 1) {
    if (!同值(期望[c], 实际[c])) 差异.push('C' + (c + 1) + ' 期望[' + 期望[c] + '] 实际[' + 实际[c] + ']')
  }
  return 差异
}

function 执行探针() {
  var 报告 = { scriptVersion: scriptVersion, 模式: '探针' }
  var 名 = []
  try {
    var 册 = Application.Worksheets, 数 = 册.Count
    for (var i = 1; i <= 数; i += 1) 名.push(String(册.Item(i).Name))
  } catch (错误) { 报告.工作表报错 = String(错误.message || 错误) }
  报告.工作表 = 名

  var 汇 = 取表(汇总表名)
  if (!汇) { 报告.汇总 = { 问题: '没有『' + 汇总表名 + '』表' } } else {
    var 末 = 汇总末行(汇)
    var 行 = []
    for (var c = 1; c <= 汇总列数; c += 1) {
      var 项 = { 列: c, 格式: '' }
      try { 项.格式 = String(汇.Cells(末, c).NumberFormat) } catch (错误1) {}
      try { 项.类型 = typeof 汇.Cells(末, c).Value2 } catch (错误2) {}
      try { 项.值 = String(汇.Cells(末, c).Value2).slice(0, 40) } catch (错误3) {}
      try { 项.公式 = String(汇.Cells(末, c).Formula).slice(0, 70) } catch (错误4) {}
      行.push(项)
    }
    报告.汇总 = { 末行: 末, 表头: 读块(汇, 1, 汇总列数, 1)[0], 末行各列: 行, 日期列: 汇总日期列, 日期格式: 日期格式 }
    var 下 = []
    for (var c2 = 1; c2 <= 汇总列数; c2 += 1) {
      try { 下.push(String(汇.Cells(末 + 1, c2).NumberFormat)) } catch (错误5) { 下.push('') }
    }
    报告.汇总.下一行格式 = 下
  }

  function 探主体(名2) {
    var 表 = 取表(名2)
    if (!表) return { 问题: '没有『' + 名2 + '』表' }
    var 末 = 主体末行(表)
    var r = { 数据末行: 末, 表头: 读块(表, 3, 主体列数, 1)[0], 日期列: 主体日期列 }
    var 找 = 找透视(表)
    r.透视 = null
    if (找) {
      r.透视 = { 锚行: 找.锚行 }
      var p = 找.透视
      if (p) {
        try { r.透视.名称 = String(p.Name) } catch (错误1) {}
        try { r.透视.源 = String(p.SourceData) } catch (错误2) {}
        try { r.透视.位置 = String(p.Location) } catch (错误3) {}
      } else { r.透视.问题 = '只有锚点没有 PivotTable 对象' }
    }
    return r
  }
  报告.集团 = 探主体(集团表名)
  报告.器械 = 探主体(器械表名)
  return 报告
}

function 执行预演(参数) {
  var 报告 = { scriptVersion: scriptVersion, 模式: '预演' }
  var 汇 = 取表(汇总表名), 集 = 取表(集团表名), 械 = 取表(器械表名)
  if (!汇 || !集 || !械) return { 问题: '有表找不到：汇总/集团/器械' }
  var 汇末 = 汇总末行(汇), 集末 = 主体末行(集), 械末 = 主体末行(械)
  报告.汇总 = { 末行: 汇末, 预期: 参数.汇总预期末行, 通过: 是零(汇末 - 参数.汇总预期末行), 表头差异: 表头检查(汇, 1, 汇总列数, 汇总表头) }
  报告.集团 = { 末行: 集末, 预期: 参数.集团预期末行, 通过: 是零(集末 - 参数.集团预期末行), 表头差异: 表头检查(集, 3, 主体列数, 主体表头) }
  报告.器械 = { 末行: 械末, 预期: 参数.器械预期末行, 通过: 是零(械末 - 参数.器械预期末行), 表头差异: 表头检查(械, 3, 主体列数, 主体表头) }
  // 供核对：当前透视锚点
  var 找集 = 找透视(集), 找械 = 找透视(械)
  报告.透视锚 = { 集团: 找集 ? 找集.锚行 : 0, 器械: 找械 ? 找械.锚行 : 0 }
  return 报告
}

function 执行写汇总(参数) {
  var 行 = 转净数组(参数.汇总行)
  if (!行.length) return { scriptVersion: scriptVersion, 模式: '写汇总', written: false, message: '没有汇总行', 入参形态: 入参形态(参数.汇总行) }
  var 汇 = 取表(汇总表名)
  if (!汇) return { written: false, message: '没有『汇总』表' }
  var 表头差异 = 表头检查(汇, 1, 汇总列数, 汇总表头)
  if (表头差异.length) return { written: false, message: '汇总表头不对：' + 表头差异.join('；') }
  var 末 = 汇总末行(汇)
  var 预期 = 参数.预期末行
  if (!是零(末 - 预期)) return { written: false, message: '汇总末行是 ' + 末 + '，预期 ' + 预期 + '（有人改过表？停手）' }
  var 起 = 末 + 1, 数 = 行.length
  行 = 归一日期列(行, 汇总日期列)
  抄格式并设文本(汇, 末, 起, 数, 汇总文本列)
  设日期格式(汇, 起, 起 + 数 - 1, 汇总日期列)
  写块(汇, 起, 行, 汇总列数)
  var 实 = 读块(汇, 起, 汇总列数, 数)
  var 差异 = 对比块(行, 实, 汇总列数)
  return {
    scriptVersion: scriptVersion, 模式: '写汇总', written: true,
    写前末行: 末, 写入行数: 数, 首行: 起, 末行: 起 + 数 - 1,
    日期列: 汇总日期列, 日期格式: 日期格式,
    回读差异数: 差异.length, 差异样例: 差异.slice(0, 5)
  }
}

function 执行写主体(参数) {
  var 集行 = 转净数组(参数.集团行), 械行 = 转净数组(参数.器械行)
  if (!集行.length || !械行.length) return { written: false, message: '缺 集团行/器械行', 入参形态: { 集团: 入参形态(参数.集团行), 器械: 入参形态(参数.器械行) } }
  var 报告 = { scriptVersion: scriptVersion, 模式: '写主体' }
  var 预期 = 转对象(参数.预期)
  function 写一个(表名, 行, 预期末行) {
    var 表 = 取表(表名)
    if (!表) return { written: false, message: '没有「' + 表名 + '」表' }
    var 表头差异 = 表头检查(表, 3, 主体列数, 主体表头)
    if (表头差异.length) return { written: false, message: 表名 + ' 表头不对：' + 表头差异.join('；') }
    var 末 = 主体末行(表)
    if (!是零(末 - 预期末行)) return { written: false, message: 表名 + ' 数据末行是 ' + 末 + '，预期 ' + 预期末行 + '（有人改过表？停手）' }
    // 先清掉旧数据 + 怀化工厂登记历史（M~P），保留表头与格式
    表.Range('A4:P' + 末).ClearContents()
    var 数 = 行.length
    if (数) {
      行 = 归一日期列(行, 主体日期列)
      抄格式并设文本(表, 4, 4, 数, 主体文本列)
      设日期格式(表, 4, 3 + 数, 主体日期列)
      写块(表, 4, 行, 主体列数)
    }
    var 实 = 数 ? 读块(表, 4, 主体列数, 数) : []
    var 差异 = 对比块(行, 实, 主体列数)
    return { written: true, 写前末行: 末, 清除到: 末, 写入行数: 数, 日期列: 主体日期列, 日期格式: 日期格式, 回读差异数: 差异.length, 差异样例: 差异.slice(0, 5) }
  }
  报告.集团 = 写一个(集团表名, 集行, 预期.集团)
  报告.器械 = 写一个(器械表名, 械行, 预期.器械)
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
  if (等(动作, '预演')) return 执行预演(参数)
  if (!参数.allowWrite) return { scriptVersion: scriptVersion, mode: 动作, written: false, message: '没有 allowWrite:true，拒绝执行（写动作一个字节都不写）' }
  if (等(动作, '写汇总')) return 执行写汇总(参数)
  if (等(动作, '写主体')) return 执行写主体(参数)
  return { scriptVersion: scriptVersion, message: '不认识的 action：' + 动作 }
}

return main()
