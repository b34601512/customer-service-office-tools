// 该文件用于管理导入日期面板、单日选择和本月到今天选择。
function setImportMode(mode) {
  // 该函数用于切换单日导入和本月到今天，默认保持单日导入更安全。
  pageState.mode = mode;
  updateDateRangeHint();
}

function setSelectedDate(dateText, mode = "day") {
  // 该函数用于统一设置当前日期和导入范围，避免日期显示和真实值不一致。
  document.getElementById("targetDateInput").value = dateText;
  document.getElementById("dateDisplayInput").value = dateText.replace(/-/g, "/");
  pageState.calendarMonth = parseDateOnly(dateText);
  setImportMode(mode);
  renderCalendar();
  if (typeof updateWorkflowStateFromInputs === "function") updateWorkflowStateFromInputs();
  if (pageState.currentWorkflowStep === 3 && typeof completeWorkflowStep === "function") {
    completeWorkflowStep(3);
    if (typeof setWorkflowStep === "function") window.setTimeout(() => setWorkflowStep(4), 0);
  }
}

function openCalendarPopup(event) {
  // 该函数用于打开自定义日历弹层。
  if (event) event.stopPropagation();
  renderCalendar();
  document.getElementById("calendarPopup").classList.remove("hidden");
}

function closeCalendarPopup() {
  // 该函数用于关闭自定义日历弹层。
  document.getElementById("calendarPopup").classList.add("hidden");
}

function closeCalendarWhenClickOutside(event) {
  // 该函数用于点击日历外部时关闭弹层，避免遮挡主页面。
  const calendarField = document.querySelector(".calendar-field");
  if (calendarField && !calendarField.contains(event.target)) {
    closeCalendarPopup();
  }
}

function shiftCalendarMonth(offset) {
  // 该函数用于切换日历显示月份。
  const current = pageState.calendarMonth;
  pageState.calendarMonth = new Date(current.getFullYear(), current.getMonth() + offset, 1);
  renderCalendar();
}

function selectTodayInCalendar(event) {
  // 该函数用于在日历弹层内选择今天。
  if (event) event.stopPropagation();
  setSelectedDate(formatLocalDate(new Date()), "day");
  closeCalendarPopup();
}

function selectThisMonthInCalendar(event) {
  // 该函数用于选择本月1号到今天，满足整月补算但不算未来日期。
  if (event) event.stopPropagation();
  const today = formatLocalDate(new Date());
  setSelectedDate(today, "monthToToday");
  closeCalendarPopup();
}

function clearCalendarSelection(event) {
  // 该函数用于清空日期，让用户重新选择，运行前仍会强制校验日期。
  if (event) event.stopPropagation();
  document.getElementById("targetDateInput").value = "";
  document.getElementById("dateDisplayInput").value = "";
  setImportMode("day");
  if (typeof updateWorkflowStateFromInputs === "function") updateWorkflowStateFromInputs();
  closeCalendarPopup();
}

function renderCalendar() {
  // 该函数用于渲染自定义日历，日常点日期就是导入当天。
  const grid = document.getElementById("calendarGrid");
  const title = document.getElementById("calendarTitle");
  if (!grid || !title) return;
  const displayMonth = pageState.calendarMonth || new Date();
  const year = displayMonth.getFullYear();
  const month = displayMonth.getMonth();
  title.textContent = `${year}年${String(month + 1).padStart(2, "0")}月`;
  grid.textContent = "";

  const firstDay = new Date(year, month, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(year, month, 1 - mondayOffset);
  const selectedDate = document.getElementById("targetDateInput").value;
  const todayText = formatLocalDate(new Date());
  const range = getCurrentSelectedRange();

  for (let index = 0; index < 42; index += 1) {
    const day = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + index);
    const dayText = formatLocalDate(day);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.dataset.date = dayText;
    button.title = `选择 ${dayText}`;
    button.textContent = String(day.getDate());
    if (day.getMonth() !== month) button.classList.add("outside");
    if (dayText === todayText) button.classList.add("today");
    if (pageState.mode === "day" && dayText === selectedDate) button.classList.add("selected");
    if (range && dayText >= range.start && dayText <= range.end) {
      button.classList.add("in-range");
      if (dayText === range.start) button.classList.add("range-start");
      if (dayText === range.end) button.classList.add("range-end");
    }
    button.addEventListener("pointerup", (event) => confirmCalendarDaySelection(event, dayText));
    button.addEventListener("click", (event) => confirmCalendarDaySelection(event, dayText));
    grid.appendChild(button);
  }
}

function confirmCalendarDaySelection(event, dayText) {
  // 该函数用于把单点日期当成确认操作；延迟关闭一次是为了兼容部分浏览器点击后又触发打开事件。
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  setSelectedDate(dayText, "day");
  closeCalendarPopup();
  window.setTimeout(closeCalendarPopup, 0);
}

function getCurrentSelectedRange() {
  // 该函数用于返回“本月”选择范围，供日历高亮和导入范围共用。
  if (pageState.mode !== "monthToToday") return null;
  const endDate = document.getElementById("targetDateInput").value;
  if (!endDate) return null;
  return { start: `${endDate.slice(0, 8)}01`, end: endDate };
}

function updateDateRangeHint() {
  // 该函数用于告诉客服当前导入的是单日还是本月到今天。
  const hint = document.getElementById("dateRangeHint");
  if (!hint) return;
  const dateText = document.getElementById("targetDateInput").value;
  if (!dateText) {
    hint.textContent = "请选择导入日期";
    return;
  }
  const range = getCurrentSelectedRange();
  hint.textContent = range ? `本月：${range.start} 至 ${range.end}` : `导入：${dateText}`;
  renderCalendar();
}
