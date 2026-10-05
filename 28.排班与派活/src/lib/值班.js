// 值班判定（纯逻辑，无 IO，可单测）
// 口径（黎路遥，三个时点）：
//   2026-09-29「值班看单元格底色，不看早/晚文字」——底色=值班标记；
//   2026-10-01「你要看此时此刻的」——同组多人带底色时，按此刻处于自己班次时段的人挑；
//   2026-10-05「此时此刻不是邓某某上班吧」——单人带底色但不在其班次时段 ⇒ 也不算，停下问人。
// ⇒ 候选 = 带底色 ∩ 组名单 ∩ **此刻在班次时间窗口内**；窗口内没人 ⇒ found=false，由调用方停下问人，不许猜。
// 颜色 → 分组 见 project-config 的 颜色分组（实测 #BDD7EE=售后、#E2F0D9=售前）。

/** 班次时间窗口（HH:MM，左闭右开）：取值对齐 1号 值班转接口径 / 22号 旧规则「14:00 前后」；可被配置「班次时间」覆盖 */
const 班次时间默认 = {
  售后: { 早班: ["08:00", "16:00"], 晚班: ["14:00", "22:30"] },
  售前: { 早班: ["08:00", "16:00"], 晚班: ["15:45", "23:45"] },
};

/** 从配置里取某分组的名单：{姓名: {userId, userName}} */
function 取名单(配置, 分组) {
  return ((配置 || {}).分组名单 || {})[分组] || {};
}

/** 姓名命中：完全相等 或 互相包含（排班表里偶带空格/后缀） */
function 姓名命中(表里名字, 名单名字) {
  const a = String(表里名字 || "").trim();
  const b = String(名单名字 || "").trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

const 白底 = ["#FFFFFF", "#FFF", "", "NULL", "UNDEFINED"];

/** 这一格算不算「值班标记」：非白底，且（若配了颜色分组）颜色必须落在颜色分组里 */
function 算值班标记(底色, 配置) {
  const 色 = String(底色 || "").trim().toUpperCase();
  if (白底.includes(色)) return false;
  const 色组 = (配置 || {}).颜色分组 || {};
  const 已配 = Object.keys(色组).map((x) => x.toUpperCase());
  return 已配.length === 0 ? true : 已配.includes(色);
}

/** 取该分组的班次时间表：代码默认 ← 配置「班次时间」覆盖 */
function 取班次时间(配置, 分组) {
  const 覆盖 = ((配置 || {}).班次时间 || {})[分组] || {};
  const 默认 = 班次时间默认[分组] || 班次时间默认.售后;
  return { ...默认, ...覆盖 };
}

/** "HH:MM" → 分钟数；不合法返回 null */
function 分钟(文本) {
  const m = String(文本 || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 此刻（HH:MM）文本 */
function 时刻文本(现在) {
  return `${String(现在.getHours()).padStart(2, "0")}:${String(现在.getMinutes()).padStart(2, "0")}`;
}

/** 某人此刻是否在其班次时间窗口内（班次=「早班」「晚班」；休息/空/未知 ⇒ false，不猜） */
function 在班次内(人, 配置, 分组, 现在) {
  const 班次 = String((人 || {}).班次 || "").trim();
  const 窗 = 取班次时间(配置, 分组)[班次];
  if (!窗) return false;
  const 开 = 分钟(窗[0]);
  const 闭 = 分钟(窗[1]);
  if (开 === null || 闭 === null) return false;
  const 刻 = 现在.getHours() * 60 + 现在.getMinutes();
  return 刻 >= 开 && 刻 < 闭;
}

/**
 * 挑值班。
 * @param {Array<{姓名:string,底色:string,班次?:string,分组?:string}>} 有色人员 排班表 report 的「当日有色人员」
 * @param {string} 分组 售前 / 售后 / …
 * @param {object} 配置 排班值班配置（用 分组名单 / 颜色分组 / 班次时间）
 * @param {{当前时间?:Date}} [选项] 判定时刻（默认 new Date()；单测传入固定时刻）
 * @returns {{found:boolean,姓名:(string|null),userId:(string|null),userName:(string|null),底色:(string|null),理由:string,候选?:string[]}}
 */
function 挑值班(有色人员, 分组, 配置, 选项) {
  const 现在 = (选项 && 选项.当前时间) || new Date();
  const 名单 = 取名单(配置, 分组);
  const 名单名 = Object.keys(名单);
  const 全部人员 = Array.isArray(有色人员) ? 有色人员 : [];
  const 组内带色 = 全部人员.filter((人) =>
    算值班标记(人.底色, 配置) &&
    (名单名.some((名) => 姓名命中(人.姓名, 名)) || (人.分组 && String(人.分组) === String(分组)))
  );

  if (组内带色.length === 0) {
    const 现场 = 全部人员.map((人) => `${人.姓名}(${人.底色 || "无"})`).join("、") || "无";
    return { found: false, 姓名: null, userId: null, userName: null, 底色: null, 理由: `当日带底色的「${分组}」一个也没有；当日有色人员：${现场}` };
  }

  const 在岗 = 组内带色.filter((人) => 在班次内(人, 配置, 分组, 现在));
  if (在岗.length === 0) {
    const 窗表 = 取班次时间(配置, 分组);
    const 描述 = 组内带色
      .map((人) => {
        const 窗 = 窗表[String(人.班次 || "").trim()];
        return `${人.姓名}（${人.班次 || "班次不明"}${窗 ? ` ${窗[0]}-${窗[1]}` : ""}）`;
      })
      .join("、");
    return {
      found: false, 姓名: null, userId: null, userName: null, 底色: null,
      候选: 组内带色.map((人) => 人.姓名),
      理由: `「${分组}」带底色的有 ${描述}，但此刻（${时刻文本(现在)}）没有一人在其班次时段内 —— 请人工指定（不猜）`,
    };
  }
  if (在岗.length > 1) {
    return {
      found: false, 姓名: null, userId: null, userName: null, 底色: null,
      候选: 在岗.map((人) => 人.姓名),
      理由: `「${分组}」此刻有 ${在岗.length} 人带底色且在班（${在岗.map((人) => 人.姓名).join("、")}），分不清该派谁 —— 请人工指定`,
    };
  }

  const 人 = 在岗[0];
  const 匹配名 = 名单名.find((名) => 姓名命中(人.姓名, 名)) || 人.姓名;
  const 资料 = 名单[匹配名] || {};
  const 职工号 = typeof 资料 === "string" ? 资料 : 资料.userId || null;
  const 显示名 = (typeof 资料 === "object" && 资料.userName) || `${匹配名}（${分组}）`;
  if (!职工号) {
    return { found: false, 姓名: 匹配名, userId: null, userName: 显示名, 底色: 人.底色 || null, 理由: `「${匹配名}」在配置里没有 userid，先补上再派活（不猜）` };
  }
  const 色组 = ((配置 || {}).颜色分组 || {})[String(人.底色 || "").toUpperCase()];
  const 色注 = 色组 ? `（底色 ${人.底色} = ${色组}）` : `（底色 ${人.底色 || "无"}）`;
  const 窗 = 取班次时间(配置, 分组)[String(人.班次 || "").trim()];
  const 班注 = 窗 ? `、班次 ${人.班次}（${窗[0]}-${窗[1]}，此刻 ${时刻文本(现在)} 在岗）` : "";
  return { found: true, 姓名: 匹配名, userId: 职工号, userName: 显示名, 底色: 人.底色 || null, 理由: `当日唯一带底色的「${分组}」${色注}${班注}` };
}

/** 直接从 report 里挑（report = 20号读表工具的 schedule-report.json） */
function 从报告挑值班(报告, 分组, 配置, 选项) {
  return 挑值班((报告 || {})["当日有色人员"], 分组, 配置, 选项);
}

module.exports = { 挑值班, 从报告挑值班, 取名单, 姓名命中, 算值班标记, 在班次内, 取班次时间, 班次时间默认 };
