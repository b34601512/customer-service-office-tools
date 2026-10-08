var scriptVersion = '2026-10-08.6'

// 《好评返现，返差价、运费汇总表【打印版】》写入脚本（**必须建 AirScript 2.0 Beta 脚本**：
//   刷新透视表只有 2.0 有 API；1.0 没有透视表对象）。
//
// 【干什么】32号 补差费用申请 月度批处理（黎路遥 2026-10-08 立项）：
//   把《2026年【补差】登记总表》里「付款时间=上月」的行：
//   ① 追加到本文件『汇总』表尾（汇总行 18 列：购买日期…申请日期+4 列留给怀化工厂登记）；
//   ② 覆盖写入对应的主体子表（A4 起 12 列：姓名…责任人），并清掉多出来的旧行 + 清掉右侧
//      「怀化工厂登记（M~P 列）」的历史信息（黎路遥授权，抹前已快照）；
//   ③ 刷新每张主体子表里的透视表，并重写「税金/收入」公式（税金=ROUND(总计/1.13*0.13,2)、收入=总计-税金，
//      口径由 8 月批次实测数字反推，10 个数全对）。
//
// 【动作】POST <本脚本同步 webhook>  Header: AirScript-Token: <token>   Body: {"Context":{"argv":{...}}}
//   探针（只读）   {"action":"探针"}
//   预演（只读）   {"action":"预演","汇总预期末行":1672,"集团预期末行":19,"器械预期末行":12}
//   写汇总         {"action":"写汇总","汇总行":"[[18列]…的JSON字符串]","预期末行":1672,"allowWrite":true}
//   写主体         {"action":"写主体","集团行":"[[12列]…]","器械行":"[[12列]…]","预期":{"集团":19,"器械":12},"allowWrite":true}
//   （行数组也接受原生/宿主数组：服务器 转净数组() 三种形态都兼容）
//   刷新与税金     {"action":"刷新与税金","allowWrite":true}
//   自检图片API（只读）{"action":"自检图片API"} —— 探测本运行时 Range.InsertImage / Shapes.GetActiveShapeImg 存不存在
//   插图           {"action":"插图","图":"[{\"行\":1674,\"dataURL\":\"data:image/…\"}]","预期起":1673,"预期止":1685,"预期末行":1685,"allowWrite":true}
//     行号 = **目标表**行号（C 列）；硬行域守卫：无论调用方传什么，行必须落在 live 末行的窗口 [末行-50, 末行] 内；
//     传了 预期末行 必须等于 live 末行，否则整批拒绝一个字节不写。
//   写公式         {"action":"写公式","公式行":"[{\"行\":454,\"新公式\":\"=DISPIMG(…)\",\"当前公式\":\"=DISPIMG(…)\"}]" ,"allowWrite":true}
//     逐格先精确比对当前公式，一致才写、写完回读；行域守卫 = 既有数据行 [2, live末行]（不套插图的 ±50 窗口，
//     专门用来修老行/还原被写错的格）；不符/越界跳过并回原文，失败不重试。
// 没有 allowWrite:true → 写动作一个字节都不写，只回当前状态。
//
// 【安全设计（顺序不能改）】
//   1) 没有 allowWrite 不写；探针/预演永远只读；
//   2) 写前查表头 + 末行对不对（防并行改表/重复导入），不一致就拒绝；
//   3) 订单号/账号/转账单号这些长数字列先设文本格式（'@'），防丢精度；日期列按上一行格式抄；
//   4) 写完立刻回读逐格比对（mismatched/firstMismatch），写没写对不靠肉眼；
//   5) 透视刷新只动本表透视和 F/G 税金收入列，其它格不碰。
//
// 【2026-10-08.2 修复（探针实测发现，需重贴）】
//   ① 主体末行() 把数据区下面的透视表（锚点/店铺/总计也写在 A 列）算成了数据末行：
//      预演守卫过不了，且清除范围会误伤透视表 → 改为扫到透视锚点前就停；
//   ② 汇总表头「客户反馈/品质工程师」两列实际单元格是换行不是空格 → 期望串对齐（换行）。
// 【2026-10-08.3 修复（v2 实测发现：写汇总/写主体都回“没有行”，一个字节没写）】
//   平台把 webhook argv 里的数组传成**宿主数组**：能下标、有 length、能序列化，
//   但 `instanceof Array` 为 false（跨 realm），v2 的行数组守卫全部误判成“没有行”。
//   修法：入站行数组一律先过 转净数组() 重建成本脚本 realm 的原生数组；客户端把行数组
//   改成 JSON 字符串传（字符串实测原样到达，服务器 JSON.parse 结果必为原生数组）→ 双保险。
// 【2026-10-08.4 修复（轮2 实测发现：写汇总成功、但回读比对假报 12 条差异被拦停）】
//   日期格式列（如汇总表 A 列，历史行都是序列号）写入 "2023/2/28" 这类日期串后，服务端 Value2
//   回读回来是序列号 "44985"；旧 同值() 长度不同 → Number("2023/2/28")=NaN → 判不等（假差异）。
//   修法：新增 日期序()（日期串 ↔ 序列号 都归一到「距 1899-12-30 的天数」），同值() 先走日期比对。
//   只影响比对、不改写入；老行/新行本来就都是序列号，数据无差异。
// 【2026-10-08.5 新增（9月批 7 格收款码图只有公式、图没搬进目标表 → 补图准备，黎路遥拍板要保留截图）】
//   ① 自检图片API（只读）：查 Range.InsertImage / Shapes.GetActiveShapeImg 存不存在；并在临时格
//      T2000 试插一张 1x1 PNG（写完 ClearContents + 记录清空后状态）；C1670（8月批图正常那格）试 GetActiveShapeImg。
//   ② 插图（写动作）：只改「当前是 DISPIMG 公式」的 C 列格（防写错行/列）；逐格 InsertImage(dataURL) → 写后回读公式；
//      插入失败的格记录报错原文，**不重试**。base64 尾部 padding 用 String.fromCharCode(61) 拼出来，
//      源码里不出现连续两个等号（粘贴安全）。
// 【2026-10-08.6 新增（10-08 14:44 插图写错行事故的根治；重贴后先还原再补图）】
//   事故：客户端把数据文件里的**源表行号**（451…462）当目标行号传进来，v5 又没有硬行域守卫
//   （预期起/止 都等于该行本身，自等值恒真）→ 目标表 C454/C456/C460 三格 2022 年老记录被盖。
//   ① 插图：新增 live 末行硬窗 [末行-50, 末行]，行不在窗口内一律 skip+报原因（与调用方参数无关）；
//      调用方若传 预期末行，必须等于 live 末行，否则整批拒绝（一个字节都不写）；
//      客户端（写入在线表.cjs）同步改成：数据文件必须带目标行（或给 --批次 现场映射），
//      并以批次行域（预期起/止）调用——不再传自等值的单行域。
//   ② 新动作「写公式」：还原被写错的格（写回旧公式）等场景；入参 [{行, 新公式, 当前公式}]，
//      逐格先精确比对当前公式（DISPIMG ID 唯一，比错格必然不符）→ 一致才写 → 写后回读；
//      行域 = 既有数据行 [2, live末行]；不符/越界跳过并回原文；失败不重试。
//      为什么「写公式」不套插图的 ±50 硬窗口：还原 C454/C456/C460 这类老行正是它的用途，
//      套硬窗口会把自己要修的行拦掉；它的安全性由「当前公式精确一致」保证。
// 【粘贴方式】打开《好评返现，返差价、运费汇总表【打印版】》→ 效率 → 高级开发 → AirScript 脚本编辑器
//   → 左侧「+」旁边的下拉选 **AirScript 2.0 Beta（推荐）** → 新建脚本「补差-写入」→ 清空默认内容 → 粘全文
//   → 保存 → 脚本「更多」里复制「同步 webhook」→ 填进本机 32号 project-config/kdocs-airscript.local.json。
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、字符串相等用等长 indexOf、比大小用减法。别改回去。

var 汇总表名 = '汇总'
var 集团表名 = '深圳市德达医疗科技集团有限公司'
var 器械表名 = '深圳市德达医疗器械有限公司'
var 汇总列数 = 18
var 主体列数 = 12

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

// 入站图列表 → [{行, dataURL}]。接受 JSON 字符串/原生数组/宿主数组（和行数组一样跨 realm）；
// 坏项直接丢掉（行号不是 ≥2 的数、dataURL 不以 data:image/ 开头），不猜、不兜底。
function 解析图列表(值) {
  var 出 = []
  if (!值) return 出
  if (含(typeof 值, 'string')) {
    try { 值 = JSON.parse(String(值)) } catch (错误图) { return 出 }
  }
  if (!是数组(值)) return 出
  var 数 = Number(值.length)
  for (var i = 0; i < 数; i += 1) {
    var 项 = 值[i]
    if (!项) continue
    var 行 = Number(项.行)
    var 图 = String(项.dataURL ? 项.dataURL : '')
    if (!isFinite(行) || 行 < 2) continue
    if (!含(图, 'data:image/')) continue
    出.push({ 行: Math.round(行), dataURL: 图 })
    if (出.length > 60) break
  }
  return 出
}

// 入站公式列表 → [{行, 新公式, 当前公式}]。接受 JSON 字符串/原生数组/宿主数组（同 解析图列表）。
// 坏项丢掉：行号不是 ≥2 的数、新公式不是公式（不以等号开头）。当前公式可以是空串（只当护栏用）。
function 解析公式列表(值) {
  var 出 = []
  if (!值) return 出
  if (含(typeof 值, 'string')) {
    try { 值 = JSON.parse(String(值)) } catch (错误公式) { return 出 }
  }
  if (!是数组(值)) return 出
  var 数 = Number(值.length)
  for (var i = 0; i < 数; i += 1) {
    var 项 = 值[i]
    if (!项) continue
    var 行 = Number(项.行)
    if (!isFinite(行) || 行 < 2) continue
    var 新 = String(项.新公式 ? 项.新公式 : '')
    if (!是公式(新)) continue
    出.push({ 行: Math.round(行), 新公式: 新, 当前公式: String(项.当前公式 ? 项.当前公式 : '') })
    if (出.length > 60) break
  }
  return 出
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
// v2 修复：透视表在数据区下面（「求和项/店铺/总计」也写在 A 列），扫描必须在透视锚点前停住，
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

// 刷新后读布局：头行(店铺/类型/总计那行)、数据起、数据止(总计行)、总计列号
function 透视布局(表, 锚行) {
  var 行数 = 80, 列数 = 8
  var 区 = 规整(表.Range('A' + 锚行 + ':' + 列名(列数) + (锚行 + 行数 - 1)).Value2)
  var 头 = 0
  for (var i = 1; i <= 行数; i += 1) {
    if (含(格(区, i, 1), '店铺')) { 头 = i; break }
  }
  if (!头) return null
  var 总列 = 0
  for (var c = 1; c <= 列数; c += 1) {
    if (含(格(区, 头, c), '总计')) { 总列 = c; break }
  }
  var 起 = 头 + 1, 止 = 0
  for (var i = 起; i <= 行数; i += 1) {
    if (!格(区, i, 1)) break
    止 = i
    if (含(格(区, i, 1), '总计')) break
  }
  if (!止) return null
  return { 头行: 锚行 + 头 - 1, 数据起: 锚行 + 起 - 1, 数据止: 锚行 + 止 - 1, 总计列: 总列 }
}

// 刷新透视 + 写税金/收入公式；返回报告
function 刷新与税金表(表, 报告名) {
  var 报告 = { 名称: 报告名 }
  var 找 = 找透视(表)
  if (!找) { 报告.问题 = 'A 列 200 行内没找到「求和项」锚点，没动'; return 报告 }
  var p = 找.透视
  if (!p) { 报告.问题 = '找到锚点但没有 PivotTable 对象（可能不是真透视表），没动'; return 报告 }
  报告.锚行 = 找.锚行
  try { 报告.透视名 = String(p.Name) } catch (错误) {}
  try { 报告.源范围 = String(p.SourceData) } catch (错误) {}
  try { 报告.位置 = String(p.Location) } catch (错误) {}
  try { 报告.表范围 = String(p.TableRange1.Address) } catch (错误) {}
  报告.刷新方式 = ''
  try { p.RefreshTable(); 报告.刷新方式 = 'RefreshTable' } catch (错误1) {
    try { p.Refresh(); 报告.刷新方式 = 'Refresh' } catch (错误2) { 报告.刷新方式 = '失败：' + String(错误2.message || 错误2) }
  }
  var 布局 = 透视布局(表, 找.锚行)
  if (!布局) { 报告.问题 = '刷新后读不到透视布局'; return 报告 }
  报告.头行 = 布局.头行
  报告.数据起 = 布局.数据起
  报告.数据止 = 布局.数据止
  报告.总计列 = 布局.总计列
  var 总列名 = 列名(布局.总计列)
  var 写了几行 = 0
  for (var r = 布局.数据起; r <= 布局.数据止; r += 1) {
    try {
      表.Range('F' + r).Formula = '=ROUND(' + 总列名 + r + '/1.13*0.13,2)'
      表.Range('G' + r).Formula = '=' + 总列名 + r + '-F' + r
      写了几行 += 1
    } catch (错误3) { 报告.公式报错 = String(错误3.message || 错误3) }
  }
  报告.写公式行数 = 写了几行
  try {
    表.Range('F' + 布局.数据起 + ':G' + 布局.数据止).NumberFormat = '0.00_ '
  } catch (错误4) {}
  // 清掉下面多余的旧税金/收入（上次行数更多时留下的）
  try { 表.Range('F' + (布局.数据止 + 1) + ':G' + (找.锚行 + 80)).ClearContents() } catch (错误5) {}
  // 回读总览
  var 回读 = 读块(表, 布局.头行, 7, 布局.数据止 - 布局.头行 + 1)
  报告.回读 = 回读
  return 报告
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
    报告.汇总 = { 末行: 末, 表头: 读块(汇, 1, 汇总列数, 1)[0], 末行各列: 行 }
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
    var r = { 数据末行: 末, 表头: 读块(表, 3, 主体列数, 1)[0] }
    var 找 = 找透视(表)
    r.透视 = null
    if (找) {
      r.透视 = { 锚行: 找.锚行 }
      var p = 找.透视
      if (p) {
        try { r.透视.名称 = String(p.Name) } catch (错误1) {}
        try { r.透视.源 = String(p.SourceData) } catch (错误2) {}
        try { r.透视.位置 = String(p.Location) } catch (错误3) {}
        try { r.透视.表范围 = String(p.TableRange1.Address) } catch (错误4) {}
        try { r.透视.数据范围 = String(p.DataBodyRange.Address) } catch (错误5) {}
        try { r.透视.刷新方法 = typeof p.RefreshTable } catch (错误6) {}
      } else { r.透视.问题 = '只有锚点没有 PivotTable 对象' }
    }
    // 税金/收入格现状（含公式，判断历史是公式还是值）
    var 起 = 找 ? 找.锚行 + 1 : 22
    r.财务格 = []
    for (var k = 1; k <= 3; k += 1) {
      var rk = 起 + k
      var f = { 行: rk }
      try { f.F值 = String(表.Cells(rk, 6).Value2).slice(0, 20) } catch (错误7) {}
      try { f.F公式 = String(表.Cells(rk, 6).Formula).slice(0, 60) } catch (错误8) {}
      try { f.F格式 = String(表.Cells(rk, 6).NumberFormat).slice(0, 20) } catch (错误9) {}
      r.财务格.push(f)
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
  报告.汇总 = { 末行: 汇末, 预期: 参数.汇总预期末行, 通过: 是零(汇末 - 参数.汇总预期末行), 表头差异: 表头检查(汇, 1, 汇总列数, ['购买日期', '姓名', '支付宝/微信账号', '店铺', '订单编号', '产品', '费用类型', '金额', '处理时间', '转账单号', '原因', '费用责任部门', '主体', '申请日期', '客户反馈\n故障现象', '品质工程师\n确认结果', '维修内容及更换配件', '责任归属']) }
  报告.集团 = { 末行: 集末, 预期: 参数.集团预期末行, 通过: 是零(集末 - 参数.集团预期末行), 表头差异: 表头检查(集, 3, 主体列数, ['姓名', '收款方式', '店铺', '订单编号', '型号', '类型', '金额', '处理时间', '转账单号', '原因简述', '责任部门', '责任人']) }
  报告.器械 = { 末行: 械末, 预期: 参数.器械预期末行, 通过: 是零(械末 - 参数.器械预期末行), 表头差异: 表头检查(械, 3, 主体列数, ['姓名', '收款方式', '店铺', '订单编号', '型号', '类型', '金额', '处理时间', '转账单号', '原因简述', '责任部门', '责任人']) }
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
  var 表头差异 = 表头检查(汇, 1, 汇总列数, ['购买日期', '姓名', '支付宝/微信账号', '店铺', '订单编号', '产品', '费用类型', '金额', '处理时间', '转账单号', '原因', '费用责任部门', '主体', '申请日期', '客户反馈\n故障现象', '品质工程师\n确认结果', '维修内容及更换配件', '责任归属'])
  if (表头差异.length) return { written: false, message: '汇总表头不对：' + 表头差异.join('；') }
  var 末 = 汇总末行(汇)
  var 预期 = 参数.预期末行
  if (!是零(末 - 预期)) return { written: false, message: '汇总末行是 ' + 末 + '，预期 ' + 预期 + '（有人改过表？停手）' }
  var 起 = 末 + 1, 数 = 行.length
  var 文本列 = [3, 5, 10, 14]
  抄格式并设文本(汇, 末, 起, 数, 文本列)
  写块(汇, 起, 行, 汇总列数)
  var 实 = 读块(汇, 起, 汇总列数, 数)
  var 差异 = 对比块(行, 实, 汇总列数)
  return {
    scriptVersion: scriptVersion, 模式: '写汇总', written: true,
    写前末行: 末, 写入行数: 数, 首行: 起, 末行: 起 + 数 - 1,
    回读差异数: 差异.length, 差异样例: 差异.slice(0, 5)
  }
}

function 执行写主体(参数) {
  var 集行 = 转净数组(参数.集团行), 械行 = 转净数组(参数.器械行)
  if (!集行.length || !械行.length) return { written: false, message: '缺 集团行/器械行', 入参形态: { 集团: 入参形态(参数.集团行), 器械: 入参形态(参数.器械行) } }
  var 报告 = { scriptVersion: scriptVersion, 模式: '写主体' }
  var 预期 = 转对象(参数.预期)
  function 写一个(表名, 行, 预期末行, 键) {
    var 表 = 取表(表名)
    if (!表) return { written: false, message: '没有「' + 表名 + '」表' }
    var 表头差异 = 表头检查(表, 3, 主体列数, ['姓名', '收款方式', '店铺', '订单编号', '型号', '类型', '金额', '处理时间', '转账单号', '原因简述', '责任部门', '责任人'])
    if (表头差异.length) return { written: false, message: 表名 + ' 表头不对：' + 表头差异.join('；') }
    var 末 = 主体末行(表)
    if (!是零(末 - 预期末行)) return { written: false, message: 表名 + ' 数据末行是 ' + 末 + '，预期 ' + 预期末行 + '（有人改过表？停手）' }
    // 先清掉旧数据 + 怀化工厂登记历史（M~P），保留表头与格式
    表.Range('A4:P' + 末).ClearContents()
    var 数 = 行.length
    if (数) {
      抄格式并设文本(表, 4, 4, 数, [2, 4, 9])
      写块(表, 4, 行, 主体列数)
    }
    var 实 = 数 ? 读块(表, 4, 主体列数, 数) : []
    var 差异 = 对比块(行, 实, 主体列数)
    return { written: true, 写前末行: 末, 清除到: 末, 写入行数: 数, 回读差异数: 差异.length, 差异样例: 差异.slice(0, 5) }
  }
  报告.集团 = 写一个(集团表名, 集行, 预期.集团, '集团')
  报告.器械 = 写一个(器械表名, 械行, 预期.器械, '器械')
  return 报告
}

function 执行刷新与税金() {
  var 报告 = { scriptVersion: scriptVersion, 模式: '刷新与税金' }
  var 集 = 取表(集团表名), 械 = 取表(器械表名)
  报告.集团 = 集 ? 刷新与税金表(集, 集团表名) : { 问题: '没有「' + 集团表名 + '」表' }
  报告.器械 = 械 ? 刷新与税金表(械, 器械表名) : { 问题: '没有「' + 器械表名 + '」表' }
  return 报告
}

// 只读自检：本运行时有没有 Range.InsertImage / Shapes.GetActiveShapeImg。
// 会在临时格 T2000 试插一张 1x1 PNG（不是空白就浪费一格，写后 ClearContents + 记录清空后状态）。
function 执行自检图片API() {
  var 报告 = { scriptVersion: scriptVersion, 模式: '自检图片API' }
  var 汇 = 取表(汇总表名)
  if (!汇) { 报告.问题 = '没有『' + 汇总表名 + '』表'; return 报告 }
  var 测试行 = 2000, 测试列 = 20
  var 测试格 = 'T' + 测试行
  报告.测试格 = 测试格
  var 区 = null
  try { 区 = 汇.Range(测试格) } catch (错误0) { 区 = null }
  报告.InsertImage类型 = 区 ? typeof 区.InsertImage : '取不到测试格'
  try { 报告.Shapes类型 = typeof 汇.Shapes } catch (错误1) { 报告.Shapes类型 = '报错：' + String(错误1.message ? 错误1.message : 错误1).slice(0, 200) }
  try { 报告.GetActiveShapeImg类型 = 汇.Shapes ? typeof 汇.Shapes.GetActiveShapeImg : '没有 Shapes' } catch (错误2) { 报告.GetActiveShapeImg类型 = '报错：' + String(错误2.message ? 错误2.message : 错误2).slice(0, 200) }
  if (区 && 含(报告.InsertImage类型, 'function')) {
    try { 报告.插前公式 = String(汇.Cells(测试行, 测试列).Formula).slice(0, 80) } catch (错误3) {}
    var 等号 = String.fromCharCode(61)
    var 小图 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg' + 等号 + 等号
    try { 区.InsertImage(小图); 报告.试插 = '成功' } catch (错误4) { 报告.试插报错 = String(错误4.message ? 错误4.message : 错误4).slice(0, 400) }
    try { 报告.插后公式 = String(汇.Cells(测试行, 测试列).Formula).slice(0, 80) } catch (错误5) {}
    try { 汇.Range(测试格).ClearContents(); 报告.清空 = '已执行 ClearContents' } catch (错误6) { 报告.清空报错 = String(错误6.message ? 错误6.message : 错误6).slice(0, 300) }
    try { 报告.清空后公式 = String(汇.Cells(测试行, 测试列).Formula).slice(0, 80) } catch (错误7) {}
  }
  try {
    汇.Activate()
    Application.Range('C1670').Select()
    var 图 = null
    try { 图 = Application.ActiveSheet.Shapes.GetActiveShapeImg() } catch (错误8) { 报告.C1670报错 = String(错误8.message ? 错误8.message : 错误8).slice(0, 300) }
    报告.C1670图片 = 图 ? String(图).slice(0, 200) : '取不到（undefined/空）'
  } catch (错误9) { 报告.C1670报错 = String(错误9.message ? 错误9.message : 错误9).slice(0, 300) }
  return 报告
}

// 写动作：给一批 C 列格补图上身（如 9 月批 7 张收款码）。
// 只改「当前是 DISPIMG 公式」的格（防写错行/列）；逐格写、逐格回读；失败不重试，报错原文回传。
function 执行插图(参数) {
  var 图列表 = 解析图列表(参数.图 ? 参数.图 : 参数.图列表)
  var 报告 = { scriptVersion: scriptVersion, 模式: '插图' }
  if (!图列表.length) {
    报告.written = false
    报告.message = '没有图（图/图列表解析后为空；dataURL 必须以 data:image/ 开头）'
    报告.入参形态 = 入参形态(参数.图)
    return 报告
  }
  var 汇 = 取表(汇总表名)
  if (!汇) { 报告.written = false; 报告.message = '没有『' + 汇总表名 + '』表'; return 报告 }
  // 硬行域守卫（2026-10-08.6）：不管调用方传什么，行必须落在 live 末行的近域窗口内。
  var live末 = 汇总末行(汇)
  var 硬窗起 = live末 - 50
  if (硬窗起 < 2) 硬窗起 = 2
  报告.live末行 = live末
  报告.硬窗口 = '[' + 硬窗起 + ',' + live末 + ']'
  var 预期末 = Number(参数.预期末行)
  if (isFinite(预期末) && !是零(预期末 - live末)) {
    报告.written = false
    报告.message = '预期末行 ' + 预期末 + ' 不等于 live 末行 ' + live末 + '，停手（一个字节都不写）'
    return 报告
  }
  var 起 = Number(参数.预期起); if (!isFinite(起)) 起 = 0
  var 止 = Number(参数.预期止); if (!isFinite(止)) 止 = 0
  if (起 > 0 && 止 > 0 && 起 > 止) { 报告.written = false; 报告.message = '预期起 > 预期止，停手'; return 报告 }
  var 逐行 = []
  var 跳过 = []
  var 成功 = 0, 插入失败 = 0, 回读不符 = 0
  for (var i = 0; i < 图列表.length; i += 1) {
    var 项 = 图列表[i], 行 = 项.行
    var 条 = { 行: 行 }
    if (行 < 硬窗起 || live末 < 行) {
      条.跳过原因 = '行号 ' + 行 + ' 不在 live 末行硬窗口 [' + 硬窗起 + ',' + live末 + '] 内（防写错行）'
      跳过.push(条); continue
    }
    if (起 > 0 && 行 < 起) { 条.跳过原因 = '行号小于预期起 ' + 起; 跳过.push(条); continue }
    if (止 > 0 && 行 > 止) { 条.跳过原因 = '行号大于预期止 ' + 止; 跳过.push(条); continue }
    var 旧公式 = ''
    try { 旧公式 = String(汇.Cells(行, 3).Formula) } catch (错误旧) { 旧公式 = '' }
    if (!含(旧公式, 'DISPIMG')) {
      条.跳过原因 = '该格当前不是 DISPIMG 公式（防误写）：' + 旧公式.slice(0, 50)
      跳过.push(条); continue
    }
    条.旧公式 = 旧公式.slice(0, 90)
    try {
      汇.Range('C' + 行).InsertImage(项.dataURL)
      条.插入 = '成功'
      成功 += 1
    } catch (错误插) {
      条.插入报错 = String(错误插.message ? 错误插.message : 错误插).slice(0, 300)
      插入失败 += 1
    }
    if (条.插入) {
      try { 条.新公式 = String(汇.Cells(行, 3).Formula).slice(0, 90) } catch (错误读) { 条.新公式 = '' }
      if (!含(条.新公式, 'DISPIMG')) 回读不符 += 1
    }
    逐行.push(条)
  }
  报告.written = 成功 > 0
  报告.请求数 = 图列表.length
  报告.成功数 = 成功
  报告.插入失败数 = 插入失败
  报告.回读不符数 = 回读不符
  报告.逐行 = 逐行
  报告.跳过 = 跳过
  return 报告
}

// 写动作：把指定格的公式改掉（还原/修补用）。逐格先精确比对「当前公式」，一致才写；写后回读；
// 行域守卫 = 既有数据行 [2, live末行]（不套插图的 ±50 硬窗；理由见 v6 注释）。不符/越界跳过并回原文，失败不重试。
function 执行写公式(参数) {
  var 列表 = 解析公式列表(参数.公式行 ? 参数.公式行 : 参数.公式列表)
  var 报告 = { scriptVersion: scriptVersion, 模式: '写公式' }
  if (!列表.length) {
    报告.written = false
    报告.message = '没有公式行（公式行/公式列表解析后为空；新公式必须以等号开头）'
    报告.入参形态 = 入参形态(参数.公式行)
    return 报告
  }
  var 汇 = 取表(汇总表名)
  if (!汇) { 报告.written = false; 报告.message = '没有『' + 汇总表名 + '』表'; return 报告 }
  var live末 = 汇总末行(汇)
  报告.live末行 = live末
  报告.行域 = '[2,' + live末 + ']（既有数据行）'
  var 预期末 = Number(参数.预期末行)
  if (isFinite(预期末) && !是零(预期末 - live末)) {
    报告.written = false
    报告.message = '预期末行 ' + 预期末 + ' 不等于 live 末行 ' + live末 + '，停手（一个字节都不写）'
    return 报告
  }
  var 起 = Number(参数.预期起); if (!isFinite(起) || 起 < 1) 起 = 0
  var 止 = Number(参数.预期止); if (!isFinite(止) || 止 < 1) 止 = 0
  if (起 > 0 && 止 > 0 && 起 > 止) { 报告.written = false; 报告.message = '预期起 > 预期止，停手'; return 报告 }
  var 逐行 = []
  var 跳过 = []
  var 成功 = 0, 写入失败 = 0, 回读不符 = 0
  for (var i = 0; i < 列表.length; i += 1) {
    var 项 = 列表[i], 行 = 项.行
    var 条 = { 行: 行 }
    if (行 < 2 || live末 < 行) {
      条.跳过原因 = '行号 ' + 行 + ' 不在既有数据行域 [2,' + live末 + '] 内（防写到表外）'
      跳过.push(条); continue
    }
    if (起 > 0 && 行 < 起) { 条.跳过原因 = '行号小于预期起 ' + 起; 跳过.push(条); continue }
    if (止 > 0 && 行 > 止) { 条.跳过原因 = '行号大于预期止 ' + 止; 跳过.push(条); continue }
    var 现公式 = ''
    try { 现公式 = String(汇.Cells(行, 3).Formula) } catch (错误取) { 现公式 = '' }
    条.当前实际公式 = 现公式.slice(0, 120)
    if (!等(文本(现公式), 文本(项.当前公式))) {
      条.跳过原因 = '当前公式与预期不符（防误写）；实际：' + 现公式.slice(0, 90)
      跳过.push(条); continue
    }
    try {
      汇.Range('C' + 行).Formula = 项.新公式
      条.写入 = '成功'
      成功 += 1
    } catch (错误写) {
      条.写入报错 = String(错误写.message ? 错误写.message : 错误写).slice(0, 300)
      写入失败 += 1
    }
    if (条.写入) {
      try { 条.写后公式 = String(汇.Cells(行, 3).Formula).slice(0, 120) } catch (错误读2) { 条.写后公式 = '' }
      if (!等(文本(条.写后公式), 文本(项.新公式))) 回读不符 += 1
    }
    逐行.push(条)
  }
  报告.written = 成功 > 0
  报告.请求数 = 列表.length
  报告.成功数 = 成功
  报告.写入失败数 = 写入失败
  报告.回读不符数 = 回读不符
  报告.逐行 = 逐行
  报告.跳过 = 跳过
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
  if (等(动作, '自检图片API')) return 执行自检图片API()
  if (!参数.allowWrite) return { scriptVersion: scriptVersion, mode: 动作, written: false, message: '没有 allowWrite:true，拒绝执行（写动作一个字节都不写）' }
  if (等(动作, '写汇总')) return 执行写汇总(参数)
  if (等(动作, '写主体')) return 执行写主体(参数)
  if (等(动作, '刷新与税金')) return 执行刷新与税金(参数)
  if (等(动作, '插图')) return 执行插图(参数)
  if (等(动作, '写公式')) return 执行写公式(参数)
  return { scriptVersion: scriptVersion, message: '不认识的 action：' + 动作 }
}

return main()
