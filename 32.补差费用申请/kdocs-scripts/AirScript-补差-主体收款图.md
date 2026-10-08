var scriptVersion = '2026-10-08.1'

// 《好评返现，返差价、运费汇总表【打印版】》主体子表收款码图脚本
// （**必须建 AirScript 2.0 Beta 脚本**；和「补差-写入」是同一个目标文档里的另一个脚本，互不影响）。
//
// 【只干一件事】把收款码缩略图写进两个**主体子表**的「收款方式」列（B 列）：
//   探针（只读）  ：报两个主体表的数据末行 + B 列里现在是 =DISPIMG(…) 公式的行；
//   插图（写）    ：逐格 Range.InsertImage(dataURL)，只写 B 列；
//   写图引用（写）：把汇总表某行的现役图 ID 写成 =DISPIMG("ID_…",1) 到主体 B 格，
//                   用来验证「同一个文档里的图 ID 能不能跨表引用」（能的话以后就不用重复插图）。
//   **绝不碰**汇总表、C 列、非 DISPIMG 的格（账号/邮箱一律跳过并报出来）。
//
// 【动作】POST <本脚本同步 webhook>  Header: AirScript-Token: <token>  Body: {"Context":{"argv":{...}}}
//   探针（只读） {"action":"探针"}
//   插图         {"action":"插图","图":"[{\"表\":\"集团\",\"行\":5,\"图片\":\"data:image/…\"}]","预期":{"集团":13},"allowWrite":true}
//   写图引用     {"action":"写图引用","引用":"[{\"表\":\"集团\",\"行\":5,\"图片ID\":\"ID_…\"}]","预期":{"集团":13},"allowWrite":true}
//   —— 表 = 只认「集团」「器械」两个键；行 = 主体表 B 列行号（数据从第 4 行起）；一批最多 20 条、载荷合计不超 2M 字符。
//   没有 allowWrite:true → 写动作一个字节都不写。
//
// 【安全设计（顺序不能改）】
//   1) 表名白名单：只认 集团/器械，**绝不接受 汇总**（防手滑写到汇总表 C 列）；
//   2) 行域守卫：行必须落在 [4, live 数据末行]（主体末行() 扫到透视锚点前就停，不把透视区当数据）；
//   3) 只写 B 列；目标格当前必须是 =DISPIMG(…) 公式，不是就跳过并回报原始值（不盖人工内容）；
//   4) 写完逐格回读（readBack）；插入/写入失败只记报错原文，**不重试**；
//   5) 传了 预期（对象：{集团:13, 器械:6}）就必须等于 live 数据末行，不齐整批拒绝一个字节不写。
//
// 【粘贴方式】打开《好评返现，返差价、运费汇总表【打印版】》→ 效率 → 高级开发 → AirScript 脚本编辑器
//   → 「+」旁边的下拉选 **AirScript 2.0 Beta（推荐）** → 新建脚本「补差-主体收款图」→ 清空默认内容 → 粘全文
//   → 保存 → 脚本「更多」里复制「同步 webhook」→ 填进本机 32号 project-config/kdocs-airscript.local.json 的
//     scripts.write_bucha_subject.webhookUrl（别动已有的 scripts.write_bucha）。
//
// 【本版为什么长这样·务必保留】金山 AirScript 编辑器粘贴时会吃掉等号连写序列，
//   所以本脚本正文里不出现连续两个等号：判空用真值、字符串相等用等长 indexOf、比大小用减法。

var 集团键 = '集团'
var 器械键 = '器械'
var 集团表名 = '深圳市德达医疗科技集团有限公司'
var 器械表名 = '深圳市德达医疗器械有限公司'
var 单批上限 = 20
var 正文上限字符 = 2000000

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

// 是不是 0（预期末行比较；不用双等号）
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

// 入站列表（JSON 字符串 / 宿主数组 / 原生数组）→ 逐项放进本脚本 realm 的数组
function 解析数组(值) {
  var 出 = []
  if (!值) return 出
  if (含(typeof 值, 'string')) {
    try { 值 = JSON.parse(String(值)) } catch (错误) { return 出 }
  }
  if (!是数组(值)) return 出
  var 数 = Number(值.length)
  for (var i = 0; i < 数; i += 1) 出.push(值[i])
  return 出
}

// 入站对象 → 对象（字符串就先 JSON.parse）
function 转对象(值) {
  if (!值) return {}
  if (含(typeof 值, 'string')) {
    try { return JSON.parse(String(值)) } catch (错误2) { return {} }
  }
  return 值
}

// 入参形态（失败留现场用，写进返回报告）
function 入参形态(值) {
  var 形 = { 类型: String(typeof 值), 长度: '无' }
  try { 形.长度 = String(值.length) } catch (错误形) {}
  return 形
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

// 按表键取表：**白名单在这里**（只认 集团/器械；返回 null = 不认识的键，绝不兜底到汇总）
function 按表键取表(键) {
  var k = 文本(键)
  if (等(k, 集团键)) return { 键: 集团键, 名: 集团表名, 表: 取表(集团表名) }
  if (等(k, 器械键)) return { 键: 器械键, 名: 器械表名, 表: 取表(器械表名) }
  return null
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

// 在 A 列找到透视表的「求和项…」锚点（主体末行 要在这里前停住）
function 找透视(表) {
  var 区 = 规整(表.Range('A1:A200').Value2)
  for (var i = 0; i < 区.length; i += 1) {
    if (含(格(区, i + 1, 1), '求和项')) return { 锚行: i + 1 }
  }
  return null
}

// 主体子表：数据从第 4 行起，A 列连着数，最后一个非空行（允许中间最多 3 行空）。
// 透视表在数据区下面（「求和项/店铺/总计」也写在 A 列），扫描必须在透视锚点前停住，
// 否则会把透视区当数据末行（行域守卫会放错行、清除范围会误伤透视表）。
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

// B 列表头必须含「收款方式」（防写错表/错列）
function 收款列表头(表) {
  try { return 文本(表.Cells(3, 2).Value2) } catch (错误) { return '' }
}

// ———————— 入参解析 ————————

// 图条目 → {表, 行, 载荷(dataURL)}；坏项返回 null（不猜、不兜底）
function 解析图条(项) {
  if (!项) return null
  var 键 = 文本(项.表)
  var 行 = Number(项.行)
  var 图 = String(项.图片 ? 项.图片 : (项.dataURL ? 项.dataURL : ''))
  if (!键) return null
  if (!isFinite(行)) return null
  if (!含(图, 'data:image/')) return null
  return { 表: 键, 行: Math.round(行), 载荷: 图 }
}

// 引用条目 → {表, 行, 载荷(图片ID)}；坏项返回 null
function 解析引用条(项) {
  if (!项) return null
  var 键 = 文本(项.表)
  var 行 = Number(项.行)
  var id = 文本(项.图片ID ? 项.图片ID : (项.ID ? 项.ID : ''))
  if (!键) return null
  if (!isFinite(行)) return null
  if (!id) return null
  if (!等(id.slice(0, 3), 'ID_')) return null
  if (含(id, '"') || 含(id, '(') || 含(id, ')') || 含(id, '=') || 含(id, ' ')) return null
  return { 表: 键, 行: Math.round(行), 载荷: id }
}

// ———————— 写批核心（插图 / 写图引用 共用） ————————

function 建表cache(键) {
  var 找 = 按表键取表(键)
  if (!找) return { 坏: '不认识的表键「' + 文本(键) + '」（只认 集团/器械，绝不写 汇总）' }
  if (!找.表) return { 坏: '文档里没有「' + 找.名 + '」表' }
  return { 表: 找.表, 名: 找.名, 末: 主体末行(找.表), 表头: 收款列表头(找.表) }
}

function 读回清单(逐行) {
  var 出 = []
  for (var i = 0; i < 逐行.length; i += 1) {
    出.push({ 表: 逐行[i].表, 行: 逐行[i].行, 新公式: 逐行[i].新公式 ? 逐行[i].新公式 : '' })
  }
  return 出
}

// 规格 = { 动作名, 原始数组, 解析一条, 空说明, 成功键, 回读关键词, 入参, 写(表,行,载荷) }
function 执行写批(参数, 规格) {
  var 报告 = { scriptVersion: scriptVersion, 模式: 规格.动作名 }
  var 列表 = []
  var 原始 = 规格.原始
  for (var i = 0; i < 原始.length; i += 1) {
    var 项 = 规格.解析(原始[i])
    if (项) 列表.push(项)
  }
  if (!列表.length) {
    报告.written = false
    报告.message = 规格.空说明
    报告.入参形态 = 入参形态(规格.入参)
    return 报告
  }
  if (列表.length > 单批上限) {
    报告.written = false
    报告.message = '一批最多 ' + 单批上限 + ' 条（收到 ' + 列表.length + ' 条），整批拒绝'
    return 报告
  }
  var 总字符 = 0
  for (var i2 = 0; i2 < 列表.length; i2 += 1) 总字符 += String(列表[i2].载荷).length
  if (总字符 > 正文上限字符) {
    报告.written = false
    报告.message = '载荷合计 ' + 总字符 + ' 字符，超 2M 上限，整批拒绝'
    return 报告
  }
  // 表缓存（白名单 + 末行 + 表头）
  var 表cache = {}
  for (var i3 = 0; i3 < 列表.length; i3 += 1) {
    var 键 = 列表[i3].表
    if (!表cache[键]) 表cache[键] = 建表cache(键)
  }
  // 预期末行守卫：参数里给了的每个键都必须对齐 live 数据末行
  var 预期 = 转对象(参数.预期)
  var 键们 = [集团键, 器械键]
  for (var j = 0; j < 键们.length; j += 1) {
    var 预末 = Number(预期[键们[j]])
    if (!isFinite(预末)) continue
    var 找预 = 按表键取表(键们[j])
    if (!找预 || !找预.表) continue
    var 实末 = 主体末行(找预.表)
    if (!是零(预末 - 实末)) {
      报告.written = false
      报告.message = 找预.键 + '表 live 数据末行 ' + 实末 + ' 不等于预期 ' + 预末 + '，整批停手（一个字节都不写）'
      return 报告
    }
  }
  var 逐行 = [], 跳过 = []
  var 成功 = 0, 失败 = 0, 回读不符 = 0
  for (var i4 = 0; i4 < 列表.length; i4 += 1) {
    var 项2 = 列表[i4]
    var 条 = { 表: 项2.表, 行: 项2.行 }
    var c = 表cache[项2.表]
    if (!c || c.坏) { 条.跳过原因 = c ? c.坏 : '表缓存没建起来'; 跳过.push(条); continue }
    if (!含(c.表头, '收款方式')) { 条.跳过原因 = 'B 列表头不是「收款方式」：' + c.表头.slice(0, 30); 跳过.push(条); continue }
    if (项2.行 < 4 || c.末 < 项2.行) { 条.跳过原因 = '行号 ' + 项2.行 + ' 不在数据区 [4,' + c.末 + '] 内（防写头部/透视区/表外）'; 跳过.push(条); continue }
    var 旧公式 = ''
    try { 旧公式 = String(c.表.Cells(项2.行, 2).Formula) } catch (错误旧) { 旧公式 = '' }
    if (!含(旧公式, 'DISPIMG')) { 条.跳过原因 = '该格当前不是 DISPIMG 公式（防误写人工内容）：' + 旧公式.slice(0, 50); 跳过.push(条); continue }
    条.旧公式 = 旧公式.slice(0, 90)
    var 写错误 = ''
    try { 规格.写(c.表, 项2.行, 项2.载荷) } catch (错误写) { 写错误 = String(错误写.message ? 错误写.message : 错误写) }
    if (写错误) { 条.写错误 = 写错误.slice(0, 300); 失败 += 1; 逐行.push(条); continue }
    条[规格.成功键] = '成功'
    成功 += 1
    try { 条.新公式 = String(c.表.Cells(项2.行, 2).Formula).slice(0, 120) } catch (错误读) { 条.新公式 = '' }
    var 要含 = 规格.回读关键词 ? 规格.回读关键词 : 项2.载荷
    if (!含(条.新公式, 要含)) 回读不符 += 1
    逐行.push(条)
  }
  报告.written = 成功 > 0
  报告.writtenColumns = ['B']
  报告.请求数 = 列表.length
  报告.成功数 = 成功
  报告.失败数 = 失败
  报告.回读不符数 = 回读不符
  报告.逐行 = 逐行
  报告.跳过 = 跳过
  报告.readBack = 读回清单(逐行)
  return 报告
}

// 写动作：给主体表 B 列补图（如集团表 5/6/7/8/10/12/13 行）。
// 只改「当前是 DISPIMG 公式」的 B 格；逐格写、逐格回读；失败不重试，报错原文回传。
function 执行插图(参数) {
  var 原始 = 解析数组(参数.图 ? 参数.图 : 参数.图列表)
  return 执行写批(参数, {
    动作名: '插图',
    原始: 原始,
    解析: 解析图条,
    入参: 参数.图 ? 参数.图 : 参数.图列表,
    空说明: '没有可用的图（图/图列表解析后为空；每项要有 表 + 行 + 图片(data:image/…)）',
    成功键: '插入',
    回读关键词: 'DISPIMG',
    写: function(表, 行, dataURL) { 表.Range('B' + 行).InsertImage(dataURL) }
  })
}

// 写动作：把汇总表的现役图 ID 写成 =DISPIMG("ID_…",1) 到主体 B 格（跨表引用验证用）。
// 同样只改「当前是 DISPIMG 公式」的 B 格；逐格写、逐格回读；失败不重试。
function 执行写图引用(参数) {
  var 原始 = 解析数组(参数.引用 ? 参数.引用 : 参数.引用列表)
  return 执行写批(参数, {
    动作名: '写图引用',
    原始: 原始,
    解析: 解析引用条,
    入参: 参数.引用 ? 参数.引用 : 参数.引用列表,
    空说明: '没有可用的引用（引用/引用列表解析后为空；每项要有 表 + 行 + 图片ID(ID_…)）',
    成功键: '写入',
    回读关键词: '',
    写: function(表, 行, 图片ID) { 表.Range('B' + 行).Formula = '=DISPIMG("' + 图片ID + '",1)' }
  })
}

// ———————— 探针（只读） ————————

function 执行探针() {
  var 报告 = { scriptVersion: scriptVersion, 模式: '探针' }
  var 名 = []
  try {
    var 册 = Application.Worksheets, 数 = 册.Count
    for (var i = 1; i <= 数; i += 1) 名.push(String(册.Item(i).Name))
  } catch (错误) { 报告.工作表报错 = String(错误.message ? 错误.message : 错误).slice(0, 200) }
  报告.工作表 = 名

  function 探主体(键) {
    var 找 = 按表键取表(键)
    if (!找 || !找.表) return { 问题: '没有「' + 键 + '」对应的表' }
    var 表 = 找.表
    var 末 = 主体末行(表)
    var 图行 = [], 无图行 = []
    for (var r = 4; r <= 末; r += 1) {
      var 值 = ''
      try { 值 = String(表.Cells(r, 2).Formula) } catch (错误1) { 值 = '' }
      var 姓名 = ''
      try { 姓名 = 文本(表.Cells(r, 1).Value2) } catch (错误2) { 姓名 = '' }
      if (含(值, 'DISPIMG')) 图行.push({ 行: r, 姓名: 姓名, 公式: 值.slice(0, 90) })
      else 无图行.push({ 行: r, 姓名: 姓名, 值: 文本(值).slice(0, 40) })
    }
    return { 表名: 找.名, B列表头: 收款列表头(表), 数据起行: 4, 数据末行: 末, 图行数: 图行.length, 图行: 图行, 无图行: 无图行 }
  }
  报告[集团键] = 探主体(集团键)
  报告[器械键] = 探主体(器械键)
  return 报告
}

// ———————— 入口 ————————

function 解析参数() {
  var 裸 = null
  try { if (Context) 裸 = Context.argv } catch (错误) { 裸 = null }
  if (!裸) 裸 = {}
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
  if (等(动作, '插图')) return 执行插图(参数)
  if (等(动作, '写图引用')) return 执行写图引用(参数)
  return { scriptVersion: scriptVersion, message: '不认识的 action：' + 动作 }
}

return main()
