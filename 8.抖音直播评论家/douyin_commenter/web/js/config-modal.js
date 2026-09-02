// 该文件用于维护运行配置弹窗的打开、编辑和保存。
function openConfigModal() {
  // 该函数用于打开配置弹窗，并从最新配置生成可编辑草稿。
  const form = latestForm || {};
  activeRoomId = form.active_room_id || "";
  activeAccountId = form.active_account_id || "";
  roomDrafts = Array.isArray(form.live_rooms) ? form.live_rooms.map((item) => ({ ...item })) : [];
  accountDrafts = Array.isArray(form.account_profiles) ? form.account_profiles.map((item) => ({ ...item })) : [];
  totalTaskInput.value = form.work_task?.total_count ?? 500;
  randomCountdownInput.value = form.schedule?.random_countdown_seconds ?? 30;
  browserPathInput.value = form.browser?.executable_path || "";
  setConfigFeedback("");
  renderConfigDrafts();
  configModal.classList.remove("hidden");
  configModal.setAttribute("aria-hidden", "false");
  setBodyModalState();
}

function closeConfigModal() {
  // 该函数用于关闭配置弹窗。
  configModal.classList.add("hidden");
  configModal.setAttribute("aria-hidden", "true");
  setBodyModalState();
}

function renderConfigDrafts() {
  // 该函数用于刷新配置弹窗中的直播间和账号编辑列表。
  renderRoomDrafts();
  renderAccountDrafts();
}

function renderRoomDrafts() {
  // 该函数用于渲染直播间配置行。
  roomList.innerHTML = "";
  roomDrafts.forEach((room, index) => {
    const row = document.createElement("div");
    row.className = "edit-row room-row";
    row.innerHTML = `
      <input type="radio" name="activeRoom" ${room.id === activeRoomId ? "checked" : ""} />
      <input class="room-name" type="text" value="${escapeHtml(room.name || "")}" placeholder="直播间备注" />
      <input class="room-url" type="text" value="${escapeHtml(room.url || "")}" placeholder="直播间链接" />
      <button class="small-danger" type="button" ${roomDrafts.length <= 1 ? "disabled" : ""}>删除</button>
    `;
    row.querySelector('input[type="radio"]').addEventListener("change", () => {
      activeRoomId = room.id;
      renderRoomDrafts();
    });
    row.querySelector(".room-name").addEventListener("input", (event) => {
      roomDrafts[index].name = event.currentTarget.value;
    });
    row.querySelector(".room-url").addEventListener("input", (event) => {
      roomDrafts[index].url = event.currentTarget.value;
    });
    row.querySelector(".small-danger").addEventListener("click", () => {
      roomDrafts.splice(index, 1);
      activeRoomId = roomDrafts.some((item) => item.id === activeRoomId) ? activeRoomId : roomDrafts[0]?.id || "";
      renderRoomDrafts();
    });
    roomList.appendChild(row);
  });
}

function renderAccountDrafts() {
  // 该函数用于渲染账号档案配置行。
  accountList.innerHTML = "";
  accountDrafts.forEach((account, index) => {
    const row = document.createElement("div");
    row.className = "edit-row account-row";
    row.innerHTML = `
      <input type="radio" name="activeAccount" ${account.id === activeAccountId ? "checked" : ""} />
      <input class="account-name" type="text" value="${escapeHtml(account.name || "")}" placeholder="账号备注" />
      <input class="account-profile" type="text" value="${escapeHtml(account.profile_key || "")}" placeholder="资料目录标识" />
      <button class="small-danger" type="button" ${accountDrafts.length <= 1 ? "disabled" : ""}>删除</button>
    `;
    row.querySelector('input[type="radio"]').addEventListener("change", () => {
      activeAccountId = account.id;
      renderAccountDrafts();
    });
    row.querySelector(".account-name").addEventListener("input", (event) => {
      accountDrafts[index].name = event.currentTarget.value;
    });
    row.querySelector(".account-profile").addEventListener("input", (event) => {
      accountDrafts[index].profile_key = event.currentTarget.value;
    });
    row.querySelector(".small-danger").addEventListener("click", () => {
      accountDrafts.splice(index, 1);
      activeAccountId = accountDrafts.some((item) => item.id === activeAccountId) ? activeAccountId : accountDrafts[0]?.id || "";
      renderAccountDrafts();
    });
    accountList.appendChild(row);
  });
}

function addRoomDraft() {
  // 该函数用于新增直播间配置行。
  const id = uniqueId("room");
  roomDrafts.push({ id, name: `直播间${roomDrafts.length + 1}`, url: "" });
  activeRoomId = id;
  renderRoomDrafts();
}

function addAccountDraft() {
  // 该函数用于新增账号档案配置行。
  const id = uniqueId("account");
  accountDrafts.push({ id, name: `账号${accountDrafts.length + 1}`, profile_key: id });
  activeAccountId = id;
  renderAccountDrafts();
}

function currentCommentsForSave() {
  // 该函数用于保存运行配置时保留原评论库，避免两个弹窗互相覆盖。
  const comments = Array.isArray(latestForm?.comments) ? latestForm.comments : [];
  return comments.map((item) => ({ id: item.id, text: item.text, enabled: Boolean(item.enabled), sent_count: Math.max(0, Number(item.sent_count || 0)) }));
}

function collectConfigPayload() {
  // 该函数用于把运行配置弹窗草稿收集成后端配置对象。
  return {
    active_room_id: activeRoomId || roomDrafts[0]?.id || "",
    live_rooms: roomDrafts.map((item) => ({ id: item.id, name: item.name, url: item.url })),
    active_account_id: activeAccountId || accountDrafts[0]?.id || "",
    account_profiles: accountDrafts.map((item) => ({ id: item.id, name: item.name, profile_key: item.profile_key })),
    comments: currentCommentsForSave(),
    schedule: {
      random_countdown_seconds: Number(randomCountdownInput.value || 30),
    },
    work_task: {
      total_count: Number(totalTaskInput.value || 500),
    },
    browser: { executable_path: browserPathInput.value || "" },
  };
}

async function saveConfig() {
  // 该函数用于保存运行配置弹窗里的配置。
  try {
    const payload = await requestJson("/api/config/save", {
      method: "POST",
      body: JSON.stringify(collectConfigPayload()),
    });
    latestForm = payload.form;
    renderSummary(latestForm);
    setWorkflowStep(2);
    setFeedback(payload.message, "success");
    setConfigFeedback(payload.message, "success");
  } catch (error) {
    setFeedback(error.message, "error");
    setConfigFeedback(error.message, "error");
  }
}
