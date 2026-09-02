// 企微配置页：编辑通知群（webhook）与成员目录（姓名/手机号/userid/行内@），保存到 wecom-robot.json。
const ansi = require("../ansi");
const { fit, padEnd, normalizeCellText } = require("../width");
const { formatBool } = require("../format");

function normalizeSectionItems(model) {
  const groups = Array.isArray(model?.notificationGroups)
    ? model.notificationGroups.map((group) => ({
      id: String(group.id || ""),
      name: String(group.name || ""),
      webhookUrl: String(group.webhookUrl || ""),
      enabled: group.enabled !== false
    }))
    : [];
  const staff = Array.isArray(model?.staffDirectory)
    ? model.staffDirectory.map((member) => ({
      id: String(member.id || ""),
      name: String(member.name || ""),
      mobile: String(member.mobile || ""),
      userId: String(member.userId || ""),
      inlineMentionEnabled: member.inlineMentionEnabled !== false
    }))
    : [];
  return { groups, staff };
}

function createWecomPage() {
  const page = {
    key: "5",
    title: "企微",
    state: {
      model: null,
      groups: [],
      staff: [],
      section: 0,
      selection: 0,
      editing: null,
      editBuffer: "",
      inputActive: false,
      message: ""
    },
    reload(app) {
      try {
        this.state.model = app.ctx.services.readWecom();
        const items = normalizeSectionItems(this.state.model);
        this.state.groups = items.groups;
        this.state.staff = items.staff;
        if (this.state.section === 0 && this.state.selection >= this.state.groups.length) {
          this.state.selection = 0;
        }
        if (this.state.section === 1 && this.state.selection >= this.state.staff.length) {
          this.state.selection = 0;
        }
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      }
    },
    onEnter(app) {
      this.state.inputActive = false;
      this.state.editing = null;
      this.reload(app);
    },
    currentItems() {
      return this.state.section === 0 ? this.state.groups : this.state.staff;
    },
    render(app) {
      const columns = app.columns;
      const contentHeight = app.contentHeight;
      const lines = [];
      const sectionTabs = [
        ` ${this.state.section === 0 ? "▶ " : ""}通知群(${this.state.groups.length}) `,
        ` ${this.state.section === 1 ? "▶ " : ""}成员目录(${this.state.staff.length}) `
      ];
      lines.push(ansi.colorize(fit(`${sectionTabs[0]}  ${sectionTabs[1]}   Tab切换分区  a新增 e编辑 d删除 s保存`, columns), "brightBlue"));

      if (this.state.section === 0) {
        lines.push(ansi.colorize(fit(`${padEnd("名称", 18)} ${fit("webhook 地址", 52)} ${padEnd("启用", 6)}`, columns), "brightCyan"));
        for (let index = 0; index < this.state.groups.length; index += 1) {
          if (lines.length >= contentHeight - 1) {
            break;
          }
          const group = this.state.groups[index];
          const selected = index === this.state.selection;
          const line = `${fit(normalizeCellText(group.name || "未命名群"), 18)} ${fit(normalizeCellText(group.webhookUrl || "（未填写）"), 52)} ${fit(normalizeCellText(formatBool(group.enabled)), 6)}`;
          lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
        }
      } else {
        lines.push(ansi.colorize(fit(`${padEnd("姓名", 12)} ${padEnd("手机号", 14)} ${fit("企微userid", 18)} ${padEnd("行内@", 6)}`, columns), "brightCyan"));
        for (let index = 0; index < this.state.staff.length; index += 1) {
          if (lines.length >= contentHeight - 1) {
            break;
          }
          const member = this.state.staff[index];
          const selected = index === this.state.selection;
          // 缺 userid 的成员只能走手机号底部@，且要求已在通知群内才会生效，这里显式标记方便排查。
          const userIdText = member.userId ? fit(member.userId, 18) : ansi.colorize(fit("⚠未填", 18), "yellow");
          const line = `${fit(normalizeCellText(member.name || "未命名"), 12)} ${fit(normalizeCellText(member.mobile || "-"), 14)} ${userIdText} ${fit(normalizeCellText(formatBool(member.inlineMentionEnabled)), 6)}`;
          lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
        }
      }

      if (this.state.inputActive) {
        lines.push("");
        const inputLabel = this.state.section === 0 ? this.editGroupLabel() : this.editMemberLabel();
        lines.push(ansi.colorize(fit(`${inputLabel}：${this.state.editBuffer}_`, columns), "brightCyan"));
        lines.push(ansi.colorize("回车确认 Esc取消", "gray"));
      }

      if (this.state.message) {
        lines.push("");
        lines.push(ansi.colorize(`提示：${this.state.message}`, "brightYellow"));
      }
      return lines;
    },
    editGroupLabel() {
      if (!this.state.editing) {
        return "新增通知群（名称|webhook|启用）";
      }
      return `编辑通知群 ${this.state.editing.index + 1}（名称|webhook|启用）`;
    },
    editMemberLabel() {
      if (!this.state.editing) {
        return "新增成员（姓名|手机号|userid|行内@）";
      }
      return `编辑成员 ${this.state.editing.index + 1}（姓名|手机号|userid|行内@）`;
    },
    footer() {
      if (this.state.inputActive) {
        return "输入内容，回车确认，Esc 取消";
      }
      return "Tab切换分区 ↑↓选择 a新增 e编辑 d删除 s保存 ←→切页 q返回总览  ⚠=缺userid只能手机号@";
    },
    handleKey(key, app) {
      if (this.state.inputActive) {
        if (key === "enter") {
          this.commitEdit(app);
          return true;
        }
        if (key === "esc") {
          this.state.inputActive = false;
          this.state.editing = null;
          return true;
        }
        if (key === "backspace") {
          this.state.editBuffer = this.state.editBuffer.slice(0, -1);
          return true;
        }
        if (typeof key === "string" && key.length === 1 && key !== "\x7f") {
          this.state.editBuffer += key;
          return true;
        }
        return true;
      }

      if (key === "tab" || key === "tab-back") {
        this.state.section = this.state.section === 0 ? 1 : 0;
        this.state.selection = 0;
        return true;
      }
      if (key === "up") {
        this.state.selection = Math.max(0, this.state.selection - 1);
        return true;
      }
      if (key === "down") {
        const count = this.currentItems().length;
        this.state.selection = Math.min(Math.max(0, count - 1), this.state.selection + 1);
        return true;
      }
      if (key === "a") {
        this.state.editing = null;
        this.state.editBuffer = "";
        this.state.inputActive = true;
        return true;
      }
      if (key === "e" || key === "enter") {
        const count = this.currentItems().length;
        if (count === 0) {
          return true;
        }
        const item = this.currentItems()[this.state.selection];
        this.state.editing = { index: this.state.selection };
        this.state.editBuffer = this.serializeItem(item);
        this.state.inputActive = true;
        return true;
      }
      if (key === "d") {
        if (this.state.section === 0) {
          this.state.groups.splice(this.state.selection, 1);
        } else {
          this.state.staff.splice(this.state.selection, 1);
        }
        const count = this.currentItems().length;
        if (this.state.selection >= count) {
          this.state.selection = Math.max(0, count - 1);
        }
        return true;
      }
      if (key === "s") {
        this.save(app);
        return true;
      }
      return false;
    },
    serializeItem(item) {
      if (this.state.section === 0) {
        return `${item.name}|${item.webhookUrl}|${item.enabled ? "是" : "否"}`;
      }
      return `${item.name}|${item.mobile}|${item.userId}|${item.inlineMentionEnabled ? "是" : "否"}`;
    },
    parseItem(rawText, existingItem) {
      const parts = String(rawText || "").split("|").map((part) => part.trim());
      if (this.state.section === 0) {
        return {
          id: existingItem?.id || `group_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
          name: parts[0] || "",
          webhookUrl: parts[1] || "",
          enabled: parts[2] !== "否"
        };
      }
      return {
        id: existingItem?.id || `staff_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        name: parts[0] || "",
        mobile: parts[1] || "",
        userId: parts[2] || "",
        inlineMentionEnabled: parts[3] !== "否"
      };
    },
    commitEdit(app) {
      const rawText = this.state.editBuffer.trim();
      if (!rawText) {
        this.state.message = "内容为空，未保存。";
        this.state.inputActive = false;
        this.state.editing = null;
        return;
      }

      const existingItem = this.state.editing
        ? this.currentItems()[this.state.editing.index]
        : null;
      const item = this.parseItem(rawText, existingItem);
      if (this.state.section === 0 && !item.webhookUrl) {
        this.state.message = "通知群必须填写 webhook 地址。";
        return;
      }
      if (this.state.section === 1 && !item.name) {
        this.state.message = "成员必须填写姓名。";
        return;
      }

      if (this.state.editing) {
        this.currentItems()[this.state.editing.index] = item;
      } else {
        this.currentItems().push(item);
      }
      this.state.inputActive = false;
      this.state.editing = null;
      this.state.message = "已暂存，按 s 保存到 wecom-robot.json。";
    },
    save(app) {
      try {
        app.ctx.services.saveWecom({
          notificationGroups: this.state.groups,
          staffDirectory: this.state.staff
        });
        this.state.message = "企微配置已保存并写入 wecom-robot.json。";
        this.reload(app);
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      }
    }
  };

  return page;
}

module.exports = {
  createWecomPage,
  normalizeSectionItems
};
