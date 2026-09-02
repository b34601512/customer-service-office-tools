// 该文件用于搜索成员并等待搜索结果稳定。
const appConfig = require("../../../config/appConfig");
const { waitForPageFunction } = require("../../../engine/pageWait");
const { waitForMemberRowDataReady } = require("./rowReady");

async function waitForMemberSearchResult(page, staffName) {
  // 这里动态等待成员搜索生效，避免输入后立即读取到旧表格结果。
  await page.evaluate(() => {
    delete window.__codexMemberSearchStableState;
  }).catch(() => {});
  await waitForPageFunction(
    page,
    (targetName) => {
      const rows = Array.from(document.querySelectorAll("tr.antd-v5-table-row"));
      const rowTexts = rows.map((row) => row.innerText.replace(/\s+/g, " ").trim()).filter(Boolean);
      const matched = rowTexts.some((text) => text.includes(targetName));
      const empty = Array.from(
        document.querySelectorAll(".antd-v5-empty-description, .ant-empty-description")
      ).some((element) => (element.innerText || "").replace(/\s+/g, "").includes("暂无数据"));
      const signature = `${matched ? 1 : 0}|${empty ? 1 : 0}|${rowTexts.join("|")}`;
      const state = window.__codexMemberSearchStableState || {
        signature: "",
        stableFrames: 0
      };

      if (signature === state.signature) {
        state.stableFrames += 1;
      } else {
        state.signature = signature;
        state.stableFrames = 0;
      }

      window.__codexMemberSearchStableState = state;
      return (matched || empty) && state.stableFrames >= 2;
    },
    staffName,
    { timeout: appConfig.pageReadyTimeout }
  );
}

async function searchMember(page, staffName) {
  // 这里统一通过页面搜索框定位成员，避免翻页或手工换每页条数带来的不稳定。
  const searchInput = page.getByPlaceholder("请输入成员名称");
  await searchInput.fill("");
  await searchInput.fill(staffName);
  await searchInput.press("Enter").catch(() => {});
  await waitForMemberSearchResult(page, staffName);
  await waitForMemberRowDataReady(page, staffName);
}

module.exports = {
  waitForMemberSearchResult,
  searchMember
};
