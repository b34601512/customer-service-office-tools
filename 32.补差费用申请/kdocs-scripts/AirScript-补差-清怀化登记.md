var scriptVersion = '2026-10-08.1'

// 《好评返现，返差价、运费汇总表【打印版】》「清怀化登记」脚本（**必须建 AirScript 2.0 Beta 脚本**）。
// 【红线·为什么单独一个脚本】两个主体子表的 M~P 列 =「怀化工厂登记」，是**黎路遥人工填写**的
//   （2026-10-08 17:17 原话：怀化工厂登记子表这里清空你也要拆分成一个脚本，然后不要再刷，
//    因为我已经填入新的数据了，避免冲掉我写的）：
//   - 日常「写数据」绝不许碰 M~P（写数据已改成只清 A4:L，M~P 原样保留）；
//   - 清空 M~P **只在这个脚本里、只在他点名时跑**，跑前必须先快照（本脚本清前把原文读回返回值）。
// 【干什么】只清指定主体子表的 M~P 四列（缺省 = M4:P{数据末行}），其它列/其它工作表一律不碰：
//   清前把原文读回来放进返回值（快照）→ 清后回读报「清了多少格 / 还剩多少非空」。
//
// 【动作】POST <本脚本同步 webhook>  Header: AirScript-Token: <token>   Body: {"Context":{"argv":{...}}}
//   探针（只读）  {"action":"探针"}
//      → 报两张主体表 M~P 现状：数据末行、哪几行非空、每格内容摘要（只读，零写入）
//   清怀化登记   {"action":"清怀化登记","表":"集团"|"器械"|"全部","行域":"4:13","确认":"清空怀化工厂登记","allowWrite":true}
//      「行域」可省：缺省 = 数据区（第 4 行 ~ 主体末行，停在透视锚点前）；例 "4:13"。
//      没有 allowWrite:true / 确认文本不是「清空怀化工厂登记」→ 一个字节都不清，只回报状态。
//
// 【安全设计（顺序不能改）】
//   1) 没有 allowWrite:true 不写；探针永远只读；
//   2) 表名白名单：只认两张主体子表（集团/器械/全部）；其它表名（含『汇总』）一律拒绝；
//   3) 只允许动 M~P 四列：本脚本只会对 M~P 构造 Range；每个会改表的地址都过 守卫动范围()，
//      不在 M~P 内就判失败、一个格都不清；清后回读「非空数」确认清干净；
//   4) 确认文本必须与「清空怀化工厂登记」完全一致，否则拒绝；
//   5) 行域守卫：必须落在 4 ~ 透视锚点前（无透视时最多 120 行），不许碰表头/透视区/超范围；
//   6) 清前快照（原文进返回值，客户端落盘证据）→ 清后回读报数；失败不重试。
//
// 【粘贴方式】打开《好评返现，返差价、运费汇总表【打印版】》→ 效率 → 高级开发 → AirScript 脚本编辑器
//   → 左侧「+」旁边的下拉选 **AirScript 2.0 Beta（推荐）** → 新建脚本「补差-清怀化登记」→ 清空默认内容 → 粘全文
//   → 保存 → 脚本「更多」里复制「同步 webhook」→ 填进本机 32号 project-config/kdocs-airscript.local.json 的
//     scripts.清怀化登记.webhookUrl（别动已有的 scripts.write_bucha / scripts.写数据 / scripts.刷新税金）。
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、字符串相等用等长 indexOf、比大小用减法。别改回去。

var 集团表名 = '深圳市德达医疗科技集团有限公司'
var 器械表名 = '深圳市德达医疗器械有限公司'
var 确认文本 = '清空怀化工厂登记'
var 白名单 = '集团 / 器械 / 全部'
// 怀化工厂登记 = M~P 四列（M=13，P=16）；本脚本只肯动这一段
var 起列 = 13
var 止列 = 16
var 行上限 = 200

// ———————— 基础工具 ————————

function 文本(值) {
  var 字 = String(值)
  if (!字.length) return ''
  // 数字 0 也是内容（下面 判空 会把它当空）：怀化登记清点/快照不能漏掉 0，先原样放行
  if (等(字, '0')) return 字
  if (!值) return ''
  return 字.replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '')
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

// 列名 → 列号（只认 A~Z…；地址里带数字先由 纯字母() 剥掉）
function 列号(字母) {
  var n = 0
  var 字 = String(字母)
  for (var i = 0; i < 字.length; i += 1) n = n * 26 + 字.charCodeAt(i) - 64
  return n
}

function 纯字母(串) { return 文本(串).replace(/[^A-Za-z]/g, '') }

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

// ———————— 主体子表结构（照《补差-写数据》复用） ————————

// 在 A 列找到透视表的「求和项…」锚点，再拿该格的 PivotTable 对象（拿不到也返回锚行）
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

// 主体子表：数据从第 4 行起，A 列连着数，最后一个非空行（允许中间最多 3 行空）。
// 透视表在数据区下面，扫描必须在透视锚点前停住（别把透视区当数据）。
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

// M~P 扫描上界：有透视 → 锚点前一行；没有 → 120（与 主体末行 的扫描上界一致）
function 扫描上界(表) {
  var 找 = 找透视(表)
  if (找 && 找.锚行 > 5) return 找.锚行 - 1
  return 120
}

// ———————— M~P 专用读取与快照 ————————

// 读 M~P 一段（起止行含两端）；返回每行 4 个文本值
function 读四列(表, 起行, 止行) {
  var 出 = []
  if (止行 < 起行) return 出
  var 区 = 规整(表.Range('M' + 起行 + ':P' + 止行).Value2)
  for (var i = 0; i < 区.length; i += 1) {
    var 行 = []
    for (var c = 1; c <= 4; c += 1) 行.push(格(区, i + 1, c))
    出.push(行)
  }
  return 出
}

// 单格快照（清前原文）：值与公式都留；值超 300 字截断并记原长
function 格快照(表, 行, 列) {
  var 出 = { 列: 列名(列), 值: '', 公式: '', 值长: 0 }
  var v = ''
  try { v = 文本(表.Cells(行, 列).Value2) } catch (错误1) {}
  try { 出.公式 = 文本(表.Cells(行, 列).Formula).slice(0, 300) } catch (错误2) {}
  出.值长 = v.length
  出.值 = v.slice(0, 300)
  if (等(出.公式, 出.值)) 出.公式 = ''
  return 出
}

// 扫一段 M~P：数非空格数/非空行数；明细只列非空行、每行只列非空格（带快照）
function 扫四列(表, 起行, 止行) {
  var 区 = 读四列(表, 起行, 止行)
  var 明细 = [], 非空格数 = 0
  for (var i = 0; i < 区.length; i += 1) {
    var 行 = 区[i]
    var 格们 = []
    for (var c = 1; c <= 4; c += 1) {
      if (行[c - 1]) {
        非空格数 += 1
        格们.push(格快照(表, 起行 + i, 12 + c))
      }
    }
    if (格们.length) 明细.push({ 行: 起行 + i, 格: 格们 })
  }
  return { 非空格数: 非空格数, 非空行数: 明细.length, 明细: 明细 }
}

// ———————— 守卫 ————————

// 列守卫：本脚本只肯动 M~P；每个要改表的地址都过这里，不在范围内就判失败（一个格都不清）。
function 守卫动范围(地址, 守卫) {
  守卫.动过地址.push(地址)
  var 段 = String(地址).split(':')
  var 甲 = 列号(纯字母(段[0]))
  var 乙 = 段.length - 1 ? 列号(纯字母(段[1])) : 甲
  if (甲 < 起列 || 乙 > 止列 || 甲 > 乙) {
    守卫.通过 = false
    守卫.问题 = '要动的范围超出 M~P（只允许动这四列）：' + 地址
    return false
  }
  return true
}

// 行域解析：缺省 = 4~数据末行；给了就要形如 "4:13" 且落在 4~扫描上界内、不超过 200 行
function 解析行域(串, 表) {
  var 上界 = 扫描上界(表)
  var 末 = 主体末行(表)
  var 起 = 4, 止 = 末
  var 字 = 文本(串)
  if (!字 && 末 < 4) return { 问题: '数据区为空（第 4 行起没有数据），没有可清的怀化登记' }
  if (字) {
    var 段 = 字.split(':')
    if (段.length - 2) return { 问题: '行域格式要像 4:13（收到：' + 字 + '）' }
    var a = Number(段[0]), b = Number(段[1])
    if (!isFinite(a) || !isFinite(b)) return { 问题: '行域不是数字：' + 字 }
    起 = Math.round(a); 止 = Math.round(b)
  }
  if (起 < 4) return { 问题: '行域起点不能小于 4（第 3 行是表头）：' + 起 }
  if (止 < 起) return { 问题: '行域终点小于起点：' + 起 + ':' + 止 }
  if (止 - 起 + 1 > 行上限) return { 问题: '行域超过 ' + 行上限 + ' 行（防手滑）：' + 起 + ':' + 止 }
  if (止 > 上界) return { 问题: '行域越界（本表可清到第 ' + 上界 + ' 行，透视区不许碰）：' + 起 + ':' + 止 }
  return { 起: 起, 止: 止, 上界: 上界, 数据末行: 末 }
}

// ———————— 各动作 ————————

// 探针：只读报两张主体表的 M~P 现状
function 执行探针() {
  var 报告 = { scriptVersion: scriptVersion, 模式: '探针' }
  var 名 = []
  try {
    var 册 = Application.Worksheets, 数 = 册.Count
    for (var i = 1; i <= 数; i += 1) 名.push(String(册.Item(i).Name))
  } catch (错误) { 报告.工作表报错 = String(错误.message || 错误) }
  报告.工作表 = 名

  function 探(名2) {
    var 表 = 取表(名2)
    if (!表) return { 名称: 名2, 问题: '没有这张表' }
    var 末 = 主体末行(表)
    var 找 = 找透视(表)
    var 上界 = 扫描上界(表)
    var r = { 名称: 名2, 数据末行: 末, 透视锚行: 找 ? 找.锚行 : 0, M_P表头: 读四列(表, 3, 3)[0] }
    r.扫描行域 = '4:' + 上界
    if (末 < 4) { r.问题 = '数据区为空（第 4 行起没有数据）'; return r }
    var 扫 = 扫四列(表, 4, 上界)
    r.非空格数 = 扫.非空格数
    r.非空行数 = 扫.非空行数
    r.非空行 = 扫.明细
    if (r.非空行.length > 80) { r.非空行截断 = true; r.非空行 = r.非空行.slice(0, 80) }
    var 超 = 0
    for (var i = 0; i < 扫.明细.length; i += 1) { if (扫.明细[i].行 > 末) 超 += 1 }
    r.数据末行后的非空行数 = 超
    r.行域建议 = '4:' + 末
    return r
  }
  报告.集团 = 探(集团表名)
  报告.器械 = 探(器械表名)
  return 报告
}

// 清一张主体子表：快照 → 列守卫 → 清 → 回读报数（只碰 M~P；失败不重试）
function 清一表(表名, 行域串, 守卫) {
  var 组 = { 名称: 表名, written: false }
  var 表 = 取表(表名)
  if (!表) { 组.message = '没有「' + 表名 + '」表'; return 组 }
  var 域 = 解析行域(行域串, 表)
  if (域.问题) { 组.message = 域.问题; return 组 }
  组.行域 = 域.起 + ':' + 域.止
  组.清范围 = 'M' + 域.起 + ':P' + 域.止
  // 1) 清前快照（原文进返回值，客户端先落盘再报结果）
  var 清前 = 扫四列(表, 域.起, 域.止)
  组.清前快照 = { 行域: 组.行域, 非空格数: 清前.非空格数, 非空行数: 清前.非空行数, 明细: 清前.明细 }
  if (清前.明细.length > 200) {
    组.清前快照.明细截断 = true
    组.清前快照.明细 = 清前.明细.slice(0, 200)
  }
  // 2) 列守卫 + 清（只碰 M~P）
  if (!守卫动范围(组.清范围, 守卫)) { 组.message = 守卫.问题; return 组 }
  var 清错 = ''
  try { 表.Range(组.清范围).ClearContents() } catch (错误清) { 清错 = String(错误清.message || 错误清) }
  if (清错) { 组.message = '清的时候报错：' + 清错; return 组 }
  组.written = true
  // 3) 清后回读：清了多少格 / 还剩多少非空
  var 清后 = 扫四列(表, 域.起, 域.止)
  var 总格 = (域.止 - 域.起 + 1) * 4
  组.清后回读 = { 总格数: 总格, 清后非空格数: 清后.非空格数, 清后非空行数: 清后.非空行数 }
  组.清掉非空格数 = 清前.非空格数 - 清后.非空格数
  组.清空完成 = 清后.非空格数 < 1
  if (!组.清空完成) {
    组.清后剩余 = 清后.明细
    组.message = '清完回读还有 ' + 清后.非空格数 + ' 格非空（没清干净，停手）'
  }
  return 组
}

function 执行清怀化登记(参数) {
  var 守卫 = { 通过: true, 动过地址: [] }
  var 报告 = { scriptVersion: scriptVersion, 模式: '清怀化登记', written: false }
  var 要 = 文本(参数.表)
  if (!要) { 报告.message = '没给「表」：只认 ' + 白名单; 报告.列守卫 = 守卫; return 报告 }
  if (!(等(要, '集团') || 等(要, '器械') || 等(要, '全部'))) { 报告.message = '表名不在白名单（只认 ' + 白名单 + '）：' + 要; 报告.列守卫 = 守卫; return 报告 }
  if (!等(String(参数.确认), 确认文本)) { 报告.message = '确认文本不对（必须完全等于「' + 确认文本 + '」）：' + String(参数.确认); 报告.列守卫 = 守卫; return 报告 }
  var 行域串 = 参数.行域 ? 文本(参数.行域) : ''
  if (等(要, '集团') || 等(要, '全部')) 报告.集团 = 清一表(集团表名, 行域串, 守卫)
  if (等(要, '器械') || 等(要, '全部')) 报告.器械 = 清一表(器械表名, 行域串, 守卫)
  报告.列守卫 = 守卫
  var 组们 = []
  if (报告.集团) 组们.push(报告.集团)
  if (报告.器械) 组们.push(报告.器械)
  var 完成 = 组们.length > 0
  for (var i = 0; i < 组们.length; i += 1) {
    if (!组们[i].written || !组们[i].清空完成) 完成 = false
  }
  if (!守卫.通过) 完成 = false
  报告.written = 完成
  if (!完成 && !报告.message) 报告.message = '有表没清成/没清干净，看各表报告'
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
  if (!参数.allowWrite) return { scriptVersion: scriptVersion, mode: 动作, written: false, message: '没有 allowWrite:true，拒绝执行（一个格都不清）' }
  if (等(动作, '清怀化登记')) return 执行清怀化登记(参数)
  return { scriptVersion: scriptVersion, message: '不认识的 action：' + 动作 }
}

return main()
