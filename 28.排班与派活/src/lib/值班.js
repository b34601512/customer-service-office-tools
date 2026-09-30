// 值班判定（纯逻辑，无 IO，可单测）
// 口径：**值班看「单元格底色标记」，不看「早/晚」班次文字**（黎路遥 2026-09-29 纠正）。
// 颜色 → 分组 见 project-config 的 颜色分组（实测 #BDD7EE=售后、#E2F0D9=售前）。
// 规矩：分不清 / 读不到 ⇒ found=false，**由调用方停下来问人，不许猜、不许兜底**。

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

/**
 * 挑值班。
 * @param {Array<{姓名:string,底色:string,班次?:string,分组?:string}>} 有色人员 排班表 report 的「当日有色人员」
 * @param {string} 分组 售前 / 售后 / …
 * @param {object} 配置 排班值班配置（用 分组名单 / 颜色分组）
 * @returns {{found:boolean,姓名:(string|null),userId:(string|null),userName:(string|null),底色:(string|null),理由:string,候选?:string[]}}
 */
function 挑值班(有色人员, 分组, 配置) {
  const 名单 = 取名单(配置, 分组);
  const 名单名 = Object.keys(名单);
  const 全部人员 = Array.isArray(有色人员) ? 有色人员 : [];
  const 候选 = 全部人员.filter((人) =>
    算值班标记(人.底色, 配置) &&
    (名单名.some((名) => 姓名命中(人.姓名, 名)) || (人.分组 && String(人.分组) === String(分组)))
  );

  if (候选.length === 0) {
    const 现场 = 全部人员.map((人) => `${人.姓名}(${人.底色 || "无"})`).join("、") || "无";
    return { found: false, 姓名: null, userId: null, userName: null, 底色: null, 理由: `当日带底色的「${分组}」一个也没有；当日有色人员：${现场}` };
  }
  if (候选.length > 1) {
    return {
      found: false, 姓名: null, userId: null, userName: null, 底色: null,
      候选: 候选.map((人) => 人.姓名),
      理由: `「${分组}」当日有 ${候选.length} 人带底色（${候选.map((人) => 人.姓名).join("、")}），分不清该派谁 —— 请人工指定`,
    };
  }

  const 人 = 候选[0];
  const 匹配名 = 名单名.find((名) => 姓名命中(人.姓名, 名)) || 人.姓名;
  const 资料 = 名单[匹配名] || {};
  const 职工号 = typeof 资料 === "string" ? 资料 : 资料.userId || null;
  const 显示名 = (typeof 资料 === "object" && 资料.userName) || `${匹配名}（${分组}）`;
  if (!职工号) {
    return { found: false, 姓名: 匹配名, userId: null, userName: 显示名, 底色: 人.底色 || null, 理由: `「${匹配名}」在配置里没有 userid，先补上再派活（不猜）` };
  }
  const 色组 = ((配置 || {}).颜色分组 || {})[String(人.底色 || "").toUpperCase()];
  const 色注 = 色组 ? `（底色 ${人.底色} = ${色组}）` : `（底色 ${人.底色 || "无"}）`;
  return { found: true, 姓名: 匹配名, userId: 职工号, userName: 显示名, 底色: 人.底色 || null, 理由: `当日唯一带底色的「${分组}」${色注}` };
}

/** 直接从 report 里挑（report = 20号读表工具的 schedule-report.json） */
function 从报告挑值班(报告, 分组, 配置) {
  return 挑值班((报告 || {})["当日有色人员"], 分组, 配置);
}

module.exports = { 挑值班, 从报告挑值班, 取名单, 姓名命中, 算值班标记 };
