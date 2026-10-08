#!/usr/bin/env node
// 32号《补差-清怀化登记》回归测试（2026-10-08 怀化工厂登记 M~P 红线）：
//   ① AirScript 正文按 Node 函数加载，用内存假表（带「越权清空即抛错」的硬保护）验证：
//      探针只读（两张主体表 M~P 现状：哪几行非空、内容摘要）；清怀化登记 happy：
//      **只对 M~P 调 ClearContents**、清前带快照（原文进返回值）、清后回读报「清多少/还剩多少」；
//   ② 守卫：无 allowWrite / 确认文本不对 / 表名不在白名单 / 行域错（起点<4、止<起、超 200 行、
//      越界到透视区、格式不对）→ 一律拒绝且零 ClearContents；
//   ③ 反向断言：清理只准动 M~P——假表对 A~L 的 ClearContents 直接抛错 + A~L 原值仍在；
//      只回 status:'已写入' 没有 written:true 必判失败；没带清前快照必判失败；清空完成=false 必判失败；
//   ④ 本地客户端：载荷形状、--预演 零请求、快照先落盘（2-清前快照.json）、失败不重试。
// 跑：node tests/补差-清怀化登记.test.cjs
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const 项目根 = path.resolve(__dirname, "..");
const 脚本路径 = path.join(项目根, "kdocs-scripts", "AirScript-补差-清怀化登记.md");
const 写数据脚本路径 = path.join(项目根, "kdocs-scripts", "AirScript-补差-写数据.md");
const 客户端 = require(path.join(项目根, "scripts", "补差-清怀化登记.cjs"));

let 通过 = 0;
let 失败 = 0;
function 断言(条件, 说明, 实测 = "") {
  if (条件) { 通过 += 1; console.log(`  ✓ ${说明}`); }
  else { 失败 += 1; console.log(`  ✗ ${说明}${实测 ? `｜实测：${实测}` : ""}`); }
}
function 深等于(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const 集团名 = "深圳市德达医疗科技集团有限公司";
const 器械名 = "深圳市德达医疗器械有限公司";

function 列号(字母) {
  let n = 0;
  for (const ch of 字母) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}
function 列名(n) { return String.fromCharCode(64 + n); }

// 内存假表：Range/Cells 的 Value2/Formula/NumberFormat(含 Local)/ClearContents/PivotTable(null)。
// 默认开「越权清空即抛错」硬保护：对 A~L（或任何非 M~P 列）调 ClearContents → 直接抛错。
function 造假表(名, 选项 = {}) {
  const 值 = new Map();
  const 公式 = new Map();
  const 格式 = new Map();
  const 记录 = { 值写入: [], 格式事件: [], 清空: [] };
  const 键 = (r, c) => r + "," + c;
  for (const [地址, v] of Object.entries(选项.初始 || {})) {
    const m = /^([A-Z]+)(\d+)$/.exec(地址);
    if (m) 值.set(键(Number(m[2]), 列号(m[1])), v);
  }
  function 解析地址(地址) {
    let m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(地址);
    if (m) return { r1: Number(m[2]), c1: 列号(m[1]), r2: Number(m[4]), c2: 列号(m[3]) };
    m = /^([A-Z]+)(\d+)$/.exec(地址);
    if (m) return { r1: Number(m[2]), c1: 列号(m[1]), r2: Number(m[2]), c2: 列号(m[1]) };
    throw new Error("假表不认识的地址：" + 地址);
  }
  function 建单格(r, c) {
    return {
      get Value2() { return 值.get(键(r, c)) === undefined ? "" : 值.get(键(r, c)); },
      set Value2(v) { 值.set(键(r, c), v); },
      get Formula() { return 公式.get(键(r, c)) || ""; },
      set Formula(f) { 公式.set(键(r, c), String(f)); },
      get NumberFormat() { return 格式.get(键(r, c)) || ""; },
      set NumberFormat(f) { 格式.set(键(r, c), String(f)); 记录.格式事件.push({ 地址: 列名(c) + r, 格式: String(f) }); },
      set NumberFormatLocal(f) { 格式.set(键(r, c), String(f)); 记录.格式事件.push({ 地址: 列名(c) + r, 格式: String(f) }); },
      get PivotTable() { return null; }
    };
  }
  const 表 = {
    Name: 名,
    Cells: (r, c) => 建单格(r, c),
    Range(地址) {
      const a = 解析地址(地址);
      return {
        get Value2() {
          const 出 = [];
          for (let r = a.r1; r <= a.r2; r += 1) {
            const 行 = [];
            for (let c = a.c1; c <= a.c2; c += 1) 行.push(值.get(键(r, c)) === undefined ? "" : 值.get(键(r, c)));
            出.push(行);
          }
          return 出;
        },
        set Value2(v) { 记录.值写入.push({ 地址, 值: v }); },
        get Formula() { return 建单格(a.r1, a.c1).Formula; },
        set Formula(f) { 建单格(a.r1, a.c1).Formula = f; },
        get NumberFormat() { return 建单格(a.r1, a.c1).NumberFormat; },
        set NumberFormat(f) {
          for (let r = a.r1; r <= a.r2; r += 1) for (let c = a.c1; c <= a.c2; c += 1) {
            格式.set(键(r, c), String(f));
            记录.格式事件.push({ 地址: 列名(c) + r, 格式: String(f) });
          }
        },
        set NumberFormatLocal(f) {
          for (let r = a.r1; r <= a.r2; r += 1) for (let c = a.c1; c <= a.c2; c += 1) {
            格式.set(键(r, c), String(f));
            记录.格式事件.push({ 地址: 列名(c) + r, 格式: String(f) });
          }
        },
        ClearContents() {
          if (选项.严格M_P !== false && (a.c1 < 13 || a.c2 > 16)) {
            throw new Error("假表保护：越权清空（只允许 M~P）：" + 地址);
          }
          记录.清空.push(地址);
          if (选项.清空无效) return;
          for (let r = a.r1; r <= a.r2; r += 1) for (let c = a.c1; c <= a.c2; c += 1) { 值.delete(键(r, c)); 公式.delete(键(r, c)); }
        },
        get PivotTable() { return null; }
      };
    }
  };
  return { 表, 记录, 值, 公式, 格式 };
}

// 假 Application：Worksheets.Item(名/序号)/Count
function 造应用(表们) {
  return {
    Worksheets: {
      get Count() { return 表们.length; },
      Item(键) {
        if (typeof 键 === "number") {
          if (!表们[键 - 1]) throw new Error("假表：没有第 " + 键 + " 个表");
          return 表们[键 - 1];
        }
        const 找 = 表们.find((t) => t.Name === 键);
        if (!找) throw new Error("假表：没有「" + 键 + "」");
        return 找;
      }
    }
  };
}

// 标准两表：A 列数据到第 6 行；M~P 人工登记在 4/5/6 行；第 8 行 M 是「超出数据末行」的尾巴
function 造两表(选项 = {}) {
  const 集团 = 造假表(集团名, {
    初始: {
      A4: "甲", A5: "乙", A6: "丙", A20: "求和项:金额",
      B4: "不能动B", L5: "不能动L",
      M4: "怀化M4", N4: "怀化N4", O5: "怀化O5", P6: "怀化P6", M8: "尾巴M8",
      ...(选项.集团初始 || {})
    },
    ...选项.集团选项
  });
  const 器械 = 造假表(器械名, {
    初始: { A4: "丁", A5: "戊", M5: "器械M5", ...(选项.器械初始 || {}) },
    ...选项.器械选项
  });
  return { 集团, 器械, app: 造应用([集团.表, 器械.表]) };
}

// AirScript 正文当 Node 函数加载（末尾 return main() 换成导出内部函数）
function 实例化(宿主 = {}) {
  let 源码 = fs.readFileSync(脚本路径, "utf8");
  const 尾 = 源码.lastIndexOf("return main()");
  if (尾 < 0) throw new Error("脚本末尾没有 return main()，加载失败");
  源码 = 源码.slice(0, 尾);
  const 工厂 = new Function(
    "Context", "Application",
    源码 + "\nreturn { scriptVersion, 集团表名, 器械表名, 确认文本, 起列, 止列, 白名单, 文本, 等, 列号, 列名, 扫描上界, 主体末行, 解析行域, 守卫动范围, 扫四列, 读四列, 执行探针, 执行清怀化登记, 解析参数, 主函数: main };"
  );
  return 工厂(宿主.Context, 宿主.Application);
}

async function 该抛错(fn) {
  try { await fn(); return { 抛了: false, 消息: "" }; }
  catch (e) { return { 抛了: true, 消息: String((e && e.message) || e) }; }
}

// ———————— 客户端用夹具 ————————

function 好组(名, 行域 = "4:6", 清前非空 = 2, 总格 = 12) {
  const [起, 止] = 行域.split(":");
  return {
    名称: 名, written: true, 行域, 清范围: `M${起}:P${止}`,
    清前快照: { 行域, 非空格数: 清前非空, 非空行数: 1, 明细: [{ 行: 4, 格: [{ 列: "M", 值: "怀化M4", 公式: "", 值长: 4 }] }] },
    清后回读: { 总格数: 总格, 清后非空格数: 0, 清后非空行数: 0 },
    清掉非空格数: 清前非空, 清空完成: true
  };
}
function 好结果(表 = "全部") {
  const 出 = { scriptVersion: "2026-10-08.1", 模式: "清怀化登记", written: true, 列守卫: { 通过: true, 动过地址: ["M4:P6"] } };
  if (表 === "集团" || 表 === "全部") 出.集团 = 好组(集团名);
  if (表 === "器械" || 表 === "全部") 出.器械 = 好组(器械名);
  return 出;
}
function 临时目录(前缀) { return fs.mkdtempSync(path.join(os.tmpdir(), 前缀)); }

async function 主() {
  console.log("\n  32号《补差-清怀化登记》回归测试（怀化工厂登记 M~P 红线）\n");

  // ── 1) 脚本版本 + 粘贴安全 + ①写数据已不碰 M~P ───────────────────────────
  {
    const s = 实例化({ Application: 造应用([]) });
    const 源码 = fs.readFileSync(脚本路径, "utf8");
    断言(s.scriptVersion === "2026-10-08.1", "脚本版本 2026-10-08.1", s.scriptVersion);
    断言(!源码.includes("=="), "源码里没有连续两个等号（粘贴安全）");
    断言(源码.trimEnd().endsWith("return main()"), "末行是顶层 return main()");
    断言(s.确认文本 === "清空怀化工厂登记", "确认文本 = 「清空怀化工厂登记」", s.确认文本);
    断言(s.起列 === 13 && s.止列 === 16, "只允许动 M~P（列 13~16）", JSON.stringify({ 起: s.起列, 止: s.止列 }));
    断言(!源码.includes("A4:P") && 源码.includes("allowWrite"), "新脚本绝不构造 A4:P 地址，且有 allowWrite 守卫");
    const 写数据源码 = fs.readFileSync(写数据脚本路径, "utf8");
    断言(写数据源码.includes("Range('A4:L'") && !写数据源码.includes("Range('A4:P'"), "①写数据脚本：清理已改 Range('A4:L')，没有 Range('A4:P')");
    断言(写数据源码.includes("不碰 M~P"), "①写数据脚本：文件头/正文注明「不碰 M~P」");
  }

  // ── 2) 探针：只读回报两张主体表 M~P 现状 ─────────────────────────────────
  {
    const 表组 = 造两表();
    const s = 实例化({ Application: 表组.app });
    const 报 = s.执行探针();
    断言(报.模式 === "探针" && 报.集团.数据末行 === 6 && 报.集团.透视锚行 === 20, "探针：集团数据末行 6 / 透视锚 20", JSON.stringify(报.集团).slice(0, 200));
    断言(报.集团.扫描行域 === "4:19" && 报.集团.行域建议 === "4:6", "探针：扫描到透视前 19、建议清 4:6");
    断言(报.集团.非空格数 === 5 && 报.集团.非空行数 === 4, "探针：集团 M~P 有 5 格非空 / 4 行非空", JSON.stringify({ 格: 报.集团.非空格数, 行: 报.集团.非空行数 }));
    断言(报.集团.非空行[0].行 === 4 && 报.集团.非空行[0].格[0].列 === "M" && 报.集团.非空行[0].格[0].值 === "怀化M4", "探针：第 4 行 M 原文回报");
    断言(报.集团.数据末行后的非空行数 === 1, "探针：数据末行之后的 M~P 非空行（第 8 行尾巴）也报出来", String(报.集团.数据末行后的非空行数));
    断言(报.器械.非空格数 === 1 && 报.器械.非空行[0].行 === 5, "探针：器械 M~P 现况");
    断言(表组.集团.记录.清空.length === 0 && 表组.集团.记录.值写入.length === 0 && 表组.集团.记录.格式事件.length === 0, "探针：集团零写入（只读）");
    // 数字 0 也是内容：清点/快照不能当空格漏掉
    const 零表 = 造假表(集团名, { 初始: { A4: "甲", M4: 0 } });
    const 探零 = 实例化({ Application: 造应用([零表.表]) }).执行探针();
    断言(探零.集团.非空格数 === 1 && 探零.集团.非空行[0].格[0].值 === "0", "探针：数字 0 也算非空（值='0'）", JSON.stringify(探零.集团.非空行).slice(0, 160));
    断言(表组.器械.记录.清空.length === 0, "探针：器械零写入（只读）");
    const s2 = 实例化({ Context: { argv: JSON.stringify({ action: "探针" }) }, Application: 表组.app });
    断言(s2.主函数().模式 === "探针", "main：argv 传 JSON 字符串也走探针");
  }

  // ── 3) 守卫：无 allowWrite / 确认不对 / 表名不在白名单 → 拒绝且零清空 ────
  {
    const 表组 = 造两表();
    const s = 实例化({ Context: { argv: { action: "清怀化登记", 表: "集团", 确认: "清空怀化工厂登记" } }, Application: 表组.app });
    const 无 = s.主函数();
    断言(无.written === false && String(无.message).includes("allowWrite"), "无 allowWrite:true → 拒绝", JSON.stringify(无).slice(0, 160));
    断言(表组.集团.记录.清空.length === 0 && 表组.器械.记录.清空.length === 0, "无 allowWrite：一个 ClearContents 都没有");
    // 探针不受 allowWrite 限制（main 先判动作）
    const 表组2 = 造两表();
    const 探 = 实例化({ Context: { argv: { action: "探针" } }, Application: 表组2.app }).主函数();
    断言(探.模式 === "探针", "探针不需要 allowWrite（仍只读）");

    const s2 = 实例化({ Application: 造两表().app });
    for (const 确认 of ["", "清空", "清空怀化工厂登记 ", "clear"]) {
      const 报 = s2.执行清怀化登记({ 表: "集团", 确认, allowWrite: true });
      断言(报.written === false && /确认/.test(String(报.message)), `确认文本 ${JSON.stringify(确认)} → 拒绝`, JSON.stringify(报).slice(0, 160));
    }
    for (const 表 of ["", "汇总", "集团表", "全部x", "All"]) {
      const 报 = s2.执行清怀化登记({ 表, 确认: "清空怀化工厂登记", allowWrite: true });
      断言(报.written === false && /白名单|没给/.test(String(报.message)), `表名 ${JSON.stringify(表)} → 拒绝`, JSON.stringify(报).slice(0, 160));
    }
  }

  // ── 4) 行域守卫：起点<4 / 止<起 / 格式错 / 超 200 行 / 越界透视区 → 拒绝 ─
  {
    const 表组 = 造两表();
    const s = 实例化({ Application: 表组.app });
    const 坏行域 = ["3:6", "0:5", "6:4", "4-6", "abc", "4:250", "4:999", "4:19:20"];
    for (const 行域 of 坏行域) {
      const 报 = s.执行清怀化登记({ 表: "集团", 确认: "清空怀化工厂登记", 行域, allowWrite: true });
      断言(报.written === false && String(报.集团.message).length > 0, `行域 ${JSON.stringify(行域)} → 拒绝`, JSON.stringify(报.集团 || {}).slice(0, 160));
    }
    断言(表组.集团.记录.清空.length === 0 && 表组.器械.记录.清空.length === 0, "行域全错：一个 ClearContents 都没有");
    // 解析行域单元：合法的收下、上界正确
    const 域 = s.解析行域("4:9", 表组.集团.表);
    断言(域.起 === 4 && 域.止 === 9 && 域.上界 === 19, "解析行域：4:9 通过且上界=透视前 19", JSON.stringify(域));
    // 无透视表：上界 120
    const 单表 = 造假表(集团名, { 初始: { A4: "甲", M4: "怀化M4" } });
    const 域2 = s.解析行域("", 单表.表);
    断言(域2.起 === 4 && 域2.止 === 4 && 域2.上界 === 120, "解析行域：无透视时缺省 4~数据末行、上界 120", JSON.stringify(域2));
  }

  // ── 5) 列守卫函数：只放行 M~P，A~L/其它列直接判失败 ───────────────────────
  {
    const s = 实例化({ Application: 造应用([]) });
    const 守卫 = { 通过: true, 动过地址: [] };
    断言(s.守卫动范围("M4:P6", 守卫) === true && 守卫.通过 === true, "列守卫：M4:P6 放行");
    断言(s.守卫动范围("A4:L6", 守卫) === false && 守卫.通过 === false && String(守卫.问题).includes("超出 M~P"), "列守卫：A4:L6 拦住（其它列一个都不许碰）");
    断言(s.守卫动范围("M4:Q6", 守卫) === false, "列守卫：M4:Q6（越过 P）也拦住");
    断言(深等于(守卫.动过地址, ["M4:P6", "A4:L6", "M4:Q6"]), "列守卫：动过地址全部留痕");
  }

  // ── 6) 清空 happy：只清 M~P、快照原文、回读报数、A~L 原样 ────────────────
  {
    const 表组 = 造两表();
    const s = 实例化({ Application: 表组.app });
    const 报 = s.执行清怀化登记({ 表: "集团", 确认: "清空怀化工厂登记", allowWrite: true });
    断言(报.written === true && 报.集团.written === true && 报.集团.清空完成 === true, "清空(集团)：written + 清空完成", JSON.stringify(报).slice(0, 240));
    断言(报.集团.行域 === "4:6" && 报.集团.清范围 === "M4:P6", "清空(集团)：缺省行域 4:6 → 清 M4:P6", JSON.stringify({ 行域: 报.集团.行域, 清范围: 报.集团.清范围 }));
    断言(报.集团.清前快照.非空格数 === 4 && 报.集团.清前快照.非空行数 === 3, "快照：清前 4 格非空 / 3 行非空", JSON.stringify(报.集团.清前快照).slice(0, 200));
    断言(报.集团.清前快照.明细[0].行 === 4 && 报.集团.清前快照.明细[0].格[0].值 === "怀化M4" && 报.集团.清前快照.明细[0].格[1].值 === "怀化N4", "快照：第 4 行 M/N 原文进了返回值（抹前快照）");
    断言(报.集团.清后回读.总格数 === 12 && 报.集团.清后回读.清后非空格数 === 0 && 报.集团.清掉非空格数 === 4, "回读：共 12 格、清后 0 格非空、清掉 4 格", JSON.stringify(报.集团.清后回读));
    断言(深等于(表组.集团.记录.清空, ["M4:P6"]), "假表记录：只调了一次 ClearContents，地址 M4:P6", JSON.stringify(表组.集团.记录.清空));
    断言(表组.集团.记录.清空.every((a) => /^M\d+:P\d+$/.test(a)), "反向断言：清空地址全部落在 M~P");
    断言(表组.集团.记录.值写入.length === 0 && 表组.集团.记录.格式事件.length === 0, "只 ClearContents：没写过值、没改过格式");
    断言(表组.集团.值.get("4,2") === "不能动B" && 表组.集团.值.get("5,12") === "不能动L", "反向断言：A~L 的格子原值仍在（B4/L5 抽查）");
    断言(表组.集团.值.get("4,13") === undefined && 表组.集团.值.get("5,15") === undefined && 表组.集团.值.get("6,16") === undefined, "M~P（4~6 行）已清空");
    断言(表组.集团.值.get("8,13") === "尾巴M8", "行域外的第 8 行 M 没被动");
    断言(报.列守卫.通过 === true && 深等于(报.列守卫.动过地址, ["M4:P6"]), "列守卫：动过地址只有 M4:P6");
    断言(报.器械 === undefined && 表组.器械.记录.清空.length === 0, "只清集团：没顺手动器械");
  }

  // ── 7) 指定行域 / 全部 / 清到尾巴 / 无透视表 ─────────────────────────────
  {
    const 表组 = 造两表();
    const s = 实例化({ Application: 表组.app });
    const 报 = s.执行清怀化登记({ 表: "集团", 确认: "清空怀化工厂登记", 行域: "4:5", allowWrite: true });
    断言(报.集团.清范围 === "M4:P5" && 表组.集团.值.get("6,16") === "怀化P6", "指定行域 4:5：只清到第 5 行，第 6 行 P 还在");
    const 报全部 = s.执行清怀化登记({ 表: "全部", 确认: "清空怀化工厂登记", allowWrite: true });
    断言(报全部.written === true && 报全部.集团.written === true && 报全部.器械.written === true, "清空(全部)：两表都清成");
    断言(深等于(表组.集团.记录.清空, ["M4:P5", "M4:P6"]) && 深等于(表组.器械.记录.清空, ["M4:P5"]), "清空(全部)：各表记录独立、地址都 M~P", JSON.stringify({ 集团: 表组.集团.记录.清空, 器械: 表组.器械.记录.清空 }));

    const 表组2 = 造两表();
    const s2 = 实例化({ Application: 表组2.app });
    const 报2 = s2.执行清怀化登记({ 表: "集团", 确认: "清空怀化工厂登记", 行域: "4:8", allowWrite: true });
    断言(报2.集团.清后回读.清后非空格数 === 0 && 表组2.集团.值.get("8,13") === undefined, "行域 4:8：连数据末行后的尾巴（M8）也清掉");

    const 单表 = 造假表(集团名, { 初始: { A4: "甲", M4: "怀化M4" } });
    const s3 = 实例化({ Application: 造应用([单表.表]) });
    const 报3 = s3.执行清怀化登记({ 表: "集团", 确认: "清空怀化工厂登记", 行域: "4:30", allowWrite: true });
    断言(报3.集团.清范围 === "M4:P30" && 报3.集团.清后回读.清后非空格数 === 0, "无透视表：行域可到 4:30（上界 120 内）");
    const 报4 = s3.执行清怀化登记({ 表: "集团", 确认: "清空怀化工厂登记", 行域: "4:130", allowWrite: true });
    断言(报4.written === false && String(报4.集团.message).includes("越界"), "无透视表：4:130 超过 120 上界 → 拒绝");
  }

  // ── 8) 清不干净：回读报数 + 顶层 written=false ───────────────────────────
  {
    const 表组 = 造两表({ 集团选项: { 清空无效: true } });
    const s = 实例化({ Application: 表组.app });
    const 报 = s.执行清怀化登记({ 表: "集团", 确认: "清空怀化工厂登记", allowWrite: true });
    断言(报.集团.written === true && 报.集团.清空完成 === false, "清空无效表：ClearContents 调了但回读仍有非空 → 清空完成 false");
    断言(报.written === false && String(报.message).includes("没清干净"), "顶层：有表没清干净 → written=false", JSON.stringify(报.message));
    断言(报.集团.清后回读.清后非空格数 === 4 && 报.集团.清掉非空格数 === 0 && 报.集团.清后剩余.length === 3, "回读报数：还剩 4 格非空 / 3 行（明细进清后剩余）");
  }

  // ── 9) 客户端：参数解析 + 载荷形状 + 白名单/确认先拦 ─────────────────────
  {
    断言(深等于(客户端.解析参数([]), { 模式: "探针", 表: "全部", 行域: "", 确认: "", 预演: false }), "解析参数：缺省值");
    const p = 客户端.解析参数(["--模式", "清空", "--表", "集团", "--行域", "4:5", "--确认", "清空怀化工厂登记", "--预演"]);
    断言(p.模式 === "清空" && p.表 === "集团" && p.行域 === "4:5" && p.确认 === "清空怀化工厂登记" && p.预演 === true, "解析参数：各开关");
    const 载荷 = 客户端.造清空载荷(p);
    断言(深等于(载荷, { action: "清怀化登记", 表: "集团", 确认: "清空怀化工厂登记", allowWrite: true, 行域: "4:5" }), "载荷：action/表/确认/allowWrite + 行域", JSON.stringify(载荷));
    const 无行域 = 客户端.造清空载荷({ 表: "全部", 确认: "清空怀化工厂登记" });
    断言(!("行域" in 无行域) && 无行域.表 === "全部", "载荷：不给 --行域 就不带行域键（服务端按数据区）");
    const 坏表 = await 该抛错(() => 客户端.造清空载荷({ 表: "汇总", 确认: "清空怀化工厂登记" }));
    断言(坏表.抛了 && 坏表.消息.includes("只认"), "客户端先拦：--表 不在白名单 → 抛错", 坏表.消息);
    const 坏确认 = await 该抛错(() => 客户端.造清空载荷({ 表: "集团", 确认: "清空" }));
    断言(坏确认.抛了 && 坏确认.消息.includes("清空怀化工厂登记"), "客户端先拦：--确认 不一字不差 → 抛错", 坏确认.消息);
  }

  // ── 10) 客户端：成功判定反向断言 ─────────────────────────────────────────
  {
    断言(客户端.校验清空结果(好结果("全部"), "全部").集团.written === true, "正例：完整结果 → 通过");
    断言(客户端.校验清空结果(好结果("集团"), "集团").器械 === undefined, "正例：--表 集团 时只看集团（器械可以没有）");
    const 坏1 = await 该抛错(() => 客户端.校验清空结果({ status: "已写入" }));
    断言(坏1.抛了 && 坏1.消息.includes("written:true"), "反向断言：只回 status:'已写入' → 必判失败", 坏1.消息);
    const 坏2 = await 该抛错(() => 客户端.校验清空结果({ ...好结果(), 列守卫: undefined }));
    断言(坏2.抛了 && 坏2.消息.includes("列守卫"), "反向断言：没列守卫 → 判失败", 坏2.消息);
    const 坏3 = await 该抛错(() => 客户端.校验清空结果({ ...好结果("全部"), 集团: undefined }, "全部"));
    断言(坏3.抛了 && 坏3.消息.includes("集团"), "反向断言：缺集团结果 → 判失败", 坏3.消息);
    const 坏4 = await 该抛错(() => 客户端.校验清空结果({ ...好结果(), 集团: { ...好组(集团名), 清前快照: undefined } }, "全部"));
    断言(坏4.抛了 && 坏4.消息.includes("快照"), "反向断言：没带清前快照 → 判失败（快照必带）", 坏4.消息);
    const 坏5 = await 该抛错(() => 客户端.校验清空结果({ ...好结果(), 集团: { ...好组(集团名), 清空完成: false, 清后剩余: [{ 行: 6 }] } }, "全部"));
    断言(坏5.抛了 && 坏5.消息.includes("非空"), "反向断言：清空完成=false（还有非空）→ 判失败", 坏5.消息);
    const 坏6 = await 该抛错(() => 客户端.校验清空结果({ ...好结果(), written: "true" }, "全部"));
    断言(坏6.抛了, "反向断言：written 只是字符串 'true' → 判失败（必须真布尔）");
  }

  // ── 11) 客户端：探针 / --预演 零请求 / 清空 happy（快照先落盘）/ 失败不重试 ─
  {
    {
      const 证据目录 = path.join(临时目录("32-qinghuai-"), "证据");
      const 调用 = [];
      const 出 = await 客户端.跑({ 模式: "探针" }, { 调脚本: async (argv) => { 调用.push(argv); return { 模式: "探针", 集团: {}, 器械: {} }; }, 证据目录 });
      断言(调用.length === 1 && 调用[0].action === "探针", "跑(探针)：发 action=探针");
      断言(fs.existsSync(path.join(证据目录, "1-探针.json")), "跑(探针)：证据 1-探针.json 落盘");
      断言(出.结果.集团 !== undefined, "跑(探针)：返回结果");
    }
    {
      const 证据目录 = path.join(临时目录("32-qinghuai-"), "证据");
      let 调用次数 = 0;
      const 出 = await 客户端.跑({ 模式: "清空", 表: "全部", 确认: "清空怀化工厂登记", 预演: true }, { 调脚本: async () => { 调用次数 += 1; return {}; }, 证据目录 });
      断言(调用次数 === 0, "--预演：零请求（一次 webhook 都没发）");
      断言(出.载荷.action === "清怀化登记" && 出.预演 === true && 出.载荷.确认 === "清空怀化工厂登记" && fs.existsSync(path.join(证据目录, "0-预演.json")), "--预演：载荷 + 0-预演.json 落盘");
    }
    {
      const 证据目录 = path.join(临时目录("32-qinghuai-"), "证据");
      const 调用 = [];
      const 出 = await 客户端.跑({ 模式: "清空", 表: "全部", 确认: "清空怀化工厂登记" }, { 调脚本: async (argv) => { 调用.push(argv); return 好结果("全部"); }, 证据目录 });
      断言(调用.length === 1 && 调用[0].action === "清怀化登记" && 调用[0].allowWrite === true && 调用[0].确认 === "清空怀化工厂登记", "跑(清空)：载荷正确");
      断言(fs.existsSync(path.join(证据目录, "2-清前快照.json")) && fs.existsSync(path.join(证据目录, "3-清怀化登记.json")), "跑(清空)：快照 + 结果都落盘");
      const 快照文件 = JSON.parse(fs.readFileSync(path.join(证据目录, "2-清前快照.json"), "utf8"));
      断言(快照文件.快照.集团.明细[0].格[0].值 === "怀化M4" && 快照文件.快照.器械.非空格数 === 2, "快照文件内容 = 服务端返回值里的清前原文", JSON.stringify(快照文件.快照).slice(0, 160));
      断言(出.结果.written === true, "跑(清空)：返回结果");
    }
    {
      const 证据目录 = path.join(临时目录("32-qinghuai-"), "证据");
      const 调用 = [];
      const 坏 = await 该抛错(() => 客户端.跑({ 模式: "清空", 表: "集团", 确认: "清空怀化工厂登记" }, { 调脚本: async (argv) => { 调用.push(argv); throw new Error("HTTP 500"); }, 证据目录 }));
      断言(坏.抛了 && 调用.length === 1, "跑(清空)：请求失败 → 立即停手，不重试（只发 1 次）", 坏.消息);
    }
    {
      const 证据目录 = path.join(临时目录("32-qinghuai-"), "证据");
      const 调用 = [];
      const 坏 = await 该抛错(() => 客户端.跑({ 模式: "清空", 表: "集团", 确认: "清空怀化工厂登记" }, { 调脚本: async (argv) => { 调用.push(argv); return { status: "已写入" }; }, 证据目录 }));
      断言(坏.抛了 && 调用.length === 1 && 坏.消息.includes("written:true"), "跑(清空)：只回 status → 判失败（反向断言）", 坏.消息);
    }
    {
      const 证据目录 = path.join(临时目录("32-qinghuai-"), "证据");
      let 调用次数 = 0;
      const 坏 = await 该抛错(() => 客户端.跑({ 模式: "清空", 表: "集团", 确认: "" }, { 调脚本: async () => { 调用次数 += 1; return 好结果("集团"); }, 证据目录 }));
      断言(坏.抛了 && 调用次数 === 0 && 坏.消息.includes("确认"), "跑(清空)：缺 --确认 → 客户端先拦，零请求", 坏.消息);
    }
    {
      const 证据目录 = path.join(临时目录("32-qinghuai-"), "证据");
      const 调用 = [];
      const 出 = await 客户端.跑({ 模式: "清空", 表: "器械", 确认: "清空怀化工厂登记" }, { 调脚本: async (argv) => { 调用.push(argv); return 好结果("器械"); }, 证据目录 });
      断言(调用[0].表 === "器械" && 出.结果.集团 === undefined, "跑(清空 --表 器械)：只发器械、只校验器械");
    }
  }

  console.log(`\n  结果：通过 ${通过} / 失败 ${失败}\n`);
  if (失败) process.exitCode = 1;
}

console.log("");

主().catch((错误) => {
  console.error(`\n  测试自己炸了：${错误 && 错误.stack ? 错误.stack : 错误}\n`);
  process.exitCode = 1;
});
