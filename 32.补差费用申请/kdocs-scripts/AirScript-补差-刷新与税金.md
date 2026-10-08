var scriptVersion = '2026-10-08.1'

// 《好评返现，返差价、运费汇总表【打印版】》「刷新与税金」脚本（**必须建 AirScript 2.0 Beta 脚本**：
//   刷新透视表只有 2.0 有 API；1.0 没有透视表对象）。
// 【从哪来】2026-10-08 从现役 v6《AirScript-补差-写入.md》拆出的大事件之一（另一个 = 写数据）。
//   刷新与税金逻辑**原样搬 v6**（8 月批次实测 10 个数全对的那版），未做「顺手优化」。
// 【干什么】只干两件事，且只动两个主体子表，其它格/其它工作表一律不碰：
//   ① 刷新每张主体子表里的透视表；
//   ② 重写「税金/收入」公式：税金 = ROUND(总计/1.13*0.13,2)（F 列）、收入 = 总计-税金（G 列）。
//
// 【动作】POST <本脚本同步 webhook>  Header: AirScript-Token: <token>  Body: {"Context":{"argv":{...}}}
//   探针（只读）  {"action":"探针"}
//   刷新与税金   {"action":"刷新与税金","allowWrite":true}
//   没有 allowWrite:true → 写动作一个字节都不写，只回当前状态。
//
// 【安全设计】
//   1) 没有 allowWrite 不写；探针永远只读；
//   2) 找不到透视锚点 / 没有 PivotTable 对象 → 本表跳过并回报问题，不做别的；
//   3) 只刷新本表透视 + 只写 F/G 两列（含清掉下面多余的旧税金/收入），其它列不碰；
//   4) 写完回读布局/公式留痕；失败不重试。
//
// 【粘贴方式】打开《好评返现，返差价、运费汇总表【打印版】》→ 效率 → 高级开发 → AirScript 脚本编辑器
//   → 左侧「+」旁边的下拉选 **AirScript 2.0 Beta（推荐）** → 新建脚本「补差-刷新与税金」→ 清空默认内容 → 粘全文
//   → 保存 → 脚本「更多」里复制「同步 webhook」→ 填进本机 32号 project-config/kdocs-airscript.local.json 的
//     scripts.刷新税金.webhookUrl（别动已有的 scripts.write_bucha）。
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列（两个等号会变形/消失），
//   所以本脚本一个等号比较都不用：判空用真值、字符串相等用等长 indexOf、比大小用减法。别改回去。

var 集团表名 = '深圳市德达医疗科技集团有限公司'
var 器械表名 = '深圳市德达医疗器械有限公司'

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

// 单格现状（探针用；取不到就留空，不抛错）
function 单格(表, 行, 列) {
  var 出 = { 行: 行, 列: 列, 值: '', 公式: '', 格式: '' }
  try { 出.值 = String(表.Cells(行, 列).Value2).slice(0, 30) } catch (错误1) {}
  try { 出.公式 = String(表.Cells(行, 列).Formula).slice(0, 70) } catch (错误2) {}
  try { 出.格式 = String(表.Cells(行, 列).NumberFormat).slice(0, 30) } catch (错误3) {}
  return 出
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

// 刷新透视 + 写税金/收入公式；返回报告（原样搬 v6，只动本表透视 + F/G）
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
    if (!表) return { 问题: '没有『' + 名2 + '』表' }
    var r = { 存在: true, 透视: null }
    var 找 = 找透视(表)
    if (找) {
      r.透视 = { 锚行: 找.锚行 }
      var p = 找.透视
      if (p) {
        try { r.透视.名称 = String(p.Name) } catch (错误1) {}
        try { r.透视.源 = String(p.SourceData) } catch (错误2) {}
        try { r.透视.位置 = String(p.Location) } catch (错误3) {}
        var 布局 = 透视布局(表, 找.锚行)
        if (布局) {
          r.布局 = 布局
          r.财务格 = []
          for (var k = 0; k < 3; k += 1) {
            var rk = 布局.数据起 + k
            r.财务格.push({ 行: rk, 税金: 单格(表, rk, 6), 收入: 单格(表, rk, 7) })
          }
        } else { r.布局问题 = '读不到透视布局' }
      } else { r.透视.问题 = '只有锚点没有 PivotTable 对象' }
    }
    return r
  }
  报告.集团 = 探(集团表名)
  报告.器械 = 探(器械表名)
  return 报告
}

function 执行刷新与税金() {
  var 报告 = { scriptVersion: scriptVersion, 模式: '刷新与税金' }
  var 集 = 取表(集团表名), 械 = 取表(器械表名)
  报告.集团 = 集 ? 刷新与税金表(集, 集团表名) : { 问题: '没有「' + 集团表名 + '」表' }
  报告.器械 = 械 ? 刷新与税金表(械, 器械表名) : { 问题: '没有「' + 器械表名 + '」表' }
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
  if (!参数.allowWrite) return { scriptVersion: scriptVersion, mode: 动作, written: false, message: '没有 allowWrite:true，拒绝执行（写动作一个字节都不写）' }
  if (等(动作, '刷新与税金')) return 执行刷新与税金()
  return { scriptVersion: scriptVersion, message: '不认识的 action：' + 动作 }
}

return main()
