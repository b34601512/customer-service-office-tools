// 店铺页：平台 → 店铺 → 店铺详情动作 四级导航。配置读写全部走 services。
const ansi = require("../ansi");
const { fit } = require("../width");
const { titleBanner } = require("../gameUi");
const {
  PLATFORM_SCOPE_DEFINITIONS,
  getPlatformScopeDefinition
} = require("../../../shared/storeCollectionScope");

function findStore(config, platformKey, storeKey) {
  return (config?.[platformKey]?.stores || []).find((store) => store.key === storeKey);
}

function createStoresPage() {
  const page = {
    key: "3",
    title: "店铺",
    state: {
      mode: "platforms",
      platformKey: "",
      storeKey: "",
      selection: 0,
      storeSelection: 0,
      message: ""
    },

    getStoreActions(app) {
      const services = app.ctx.services;
      const store = findStore(services.readConfig(), this.state.platformKey, this.state.storeKey);
      if (!store) return [];
      const platformKey = this.state.platformKey;
      const page = this;
      return [
        {
          label: "修改店铺名称",
          run: async (app) => {
            const name = await app.requestInput({ title: `新店铺名称（回车保留“${store.displayName}”）` });
            if (name) {
              try {
                services.saveStorePatch(platformKey, { key: store.key, displayName: name });
                page.state.message = "店铺名称已保存。";
              } catch (error) {
                page.state.message = `保存失败：${String(error?.message || error)}`;
              }
            }
            app.requestRender();
          }
        },
        {
          label: "修改登录凭证",
          run: async (app) => {
            const username = await app.requestInput({ title: `登录账号（回车保留“${store.username || "未配置"}”）` });
            if (username === null) return;
            const password = await app.requestInput({ title: "登录密码（回车保留原密码）", secret: true });
            if (password === null) return;
            const storePatch = { key: store.key };
            if (username) storePatch.username = username;
            if (password) storePatch.password = password;
            if (Object.keys(storePatch).length > 1) {
              try {
                services.saveStorePatch(platformKey, storePatch);
                page.state.message = "登录凭证已保存。";
              } catch (error) {
                page.state.message = `保存失败：${String(error?.message || error)}`;
              }
            }
            app.requestRender();
          }
        },
        {
          label: "修改店铺编号",
          run: async (app) => {
            const rawKey = await app.requestInput({ title: `新店铺编号（可填数字，如 6；回车保留“${store.key}”）` });
            if (!rawKey) return;
            const nextStoreKey = services.normalizeStoreKeyInput(platformKey, rawKey);
            if (nextStoreKey === store.key) return;
            try {
              services.saveStorePatch(platformKey, { key: store.key, newKey: nextStoreKey });
              page.state.storeKey = nextStoreKey;
              page.state.message = `店铺编号已改为 ${nextStoreKey}。`;
            } catch (error) {
              page.state.message = `保存失败：${String(error?.message || error)}`;
            }
            app.requestRender();
          }
        },
        {
          label: store.enabled !== false ? "停用这家店" : "启用这家店",
          run: async (app) => {
            const ok = await app.requestConfirm(
              store.enabled !== false
                ? `确认停用店铺“${store.displayName}”？`
                : `确认启用店铺“${store.displayName}”？`
            );
            if (!ok) return;
            try {
              services.saveStorePatch(platformKey, { key: store.key, enabled: store.enabled === false });
              page.state.message = store.enabled === false ? "店铺已启用。" : "店铺已停用。";
            } catch (error) {
              page.state.message = `保存失败：${String(error?.message || error)}`;
            }
            app.requestRender();
          }
        }
      ];
    },

    async addStore(app) {
      const requestedKey = await app.requestInput({
        title: "新增店铺编号（可填数字，如 6；回车自动用最小可用编号）"
      });
      try {
        const result = app.ctx.services.addStoreConfig(this.state.platformKey, requestedKey);
        this.state.mode = "store";
        this.state.storeKey = result.newStore.key;
        this.state.selection = 0;
        this.state.message = `已新增店铺：${result.newStore.displayName}`;
      } catch (error) {
        this.state.message = `新增失败：${String(error?.message || error)}`;
      }
      app.requestRender();
    },

    render(app) {
      const services = app.ctx.services;
      const config = services.readConfig();
      const columns = app.columns;
      const lines = [];
      const state = this.state;

      if (state.mode === "platforms") {
        lines.push(...titleBanner("◆ 店铺管理 ◆", columns - 2));
        PLATFORM_SCOPE_DEFINITIONS.forEach((definition, index) => {
          const stores = config?.[definition.platformKey]?.stores || [];
          const enabledCount = stores.filter((store) => store.enabled !== false).length;
          const row = ` ${index === state.selection ? "▶" : " "} ${definition.platformName}  ${enabledCount}/${stores.length} 家启用`;
          lines.push(index === state.selection ? ansi.colorize(fit(row, columns), "reverse") : row);
        });
      } else if (state.mode === "stores") {
        const definition = getPlatformScopeDefinition(state.platformKey);
        const platformName = definition?.platformName || state.platformKey;
        lines.push(...titleBanner(`◆ ${platformName}店铺管理 ◆`, columns - 2));
        const stores = config?.[state.platformKey]?.stores || [];
        stores.forEach((store, index) => {
          const enabledText = store.enabled !== false
            ? ansi.colorize("启用", "brightGreen")
            : ansi.colorize("停用", "gray");
          const accountText = store.username && store.password ? "凭证已配置" : "凭证未完整";
          const row = ` ${index === state.storeSelection ? "▶" : " "} ${store.displayName}  编号=${store.key}  ${enabledText}  ${accountText}`;
          lines.push(index === state.storeSelection ? ansi.colorize(fit(row, columns), "reverse") : row);
        });
        lines.push(` ${ansi.colorize("A", "brightYellow")} 新增店铺`);
      } else {
        const store = findStore(config, state.platformKey, state.storeKey);
        if (store) {
          lines.push(...titleBanner(`◆ ${store.displayName} ◆`, columns - 2));
          lines.push(` 店铺编号  ${store.key}`);
          lines.push(` 运行状态  ${store.enabled !== false ? ansi.colorize("启用", "brightGreen") : ansi.colorize("停用", "gray")}`);
          lines.push(` 登录账号  ${store.username || "未配置"}`);
          lines.push(` 登录密码  ${store.password ? "********（已配置）" : "未配置"}`);
          if (state.platformKey === "douyin") {
            lines.push(` 平台店铺  ${store.platformStoreName || "未配置"}（ID=${store.platformStoreId || "未配置"}）`);
          }
          lines.push("");
          lines.push(ansi.colorize("── 操作 ──", "brightCyan"));
          this.getStoreActions(app).forEach((action, index) => {
            const row = ` ${index === state.selection ? "▶" : " "} ${action.label}`;
            lines.push(index === state.selection ? ansi.colorize(fit(row, columns), "reverse") : row);
          });
        }
      }
      if (state.message) {
        lines.push(ansi.colorize(` ${state.message}`, "brightYellow"));
      }
      return lines;
    },

    footer(app) {
      if (this.state.mode === "platforms") return "↑↓选择 回车进入  Esc/退格 返回总览";
      if (this.state.mode === "stores") return "↑↓选择 回车进入  A 新增店铺  Esc/退格 返回平台";
      return "↑↓选择 回车执行  Esc/退格 返回店铺列表";
    },

    handleKey(key, app) {
      const state = this.state;
      if (state.mode === "platforms") {
        if (key === "up") {
          state.selection = (state.selection - 1 + PLATFORM_SCOPE_DEFINITIONS.length) % PLATFORM_SCOPE_DEFINITIONS.length;
          return true;
        }
        if (key === "down") {
          state.selection = (state.selection + 1) % PLATFORM_SCOPE_DEFINITIONS.length;
          return true;
        }
        if (key === "enter") {
          const definition = PLATFORM_SCOPE_DEFINITIONS[state.selection];
          if (definition) {
            state.mode = "stores";
            state.platformKey = definition.platformKey;
            state.storeSelection = 0;
            state.message = "";
          }
          return true;
        }
        if (key === "esc" || key === "backspace") {
          app.switchPage(0);
          return true;
        }
        return false;
      }
      if (state.mode === "stores") {
        const stores = app.ctx.services.readConfig()?.[state.platformKey]?.stores || [];
        if (key === "up") {
          const storeCount = Math.max(1, stores.length);
          state.storeSelection = (state.storeSelection - 1 + storeCount) % storeCount;
          return true;
        }
        if (key === "down") {
          const storeCount = Math.max(1, stores.length);
          state.storeSelection = (state.storeSelection + 1) % storeCount;
          return true;
        }
        if (key === "a" || key === "A") {
          this.addStore(app);
          return true;
        }
        if (key === "enter") {
          const store = stores[state.storeSelection];
          if (store) {
            state.mode = "store";
            state.storeKey = store.key;
            state.selection = 0;
            state.message = "";
          }
          return true;
        }
        if (key === "esc" || key === "backspace") {
          state.mode = "platforms";
          state.message = "";
          return true;
        }
        return false;
      }
      // 店铺详情
      const actionCount = Math.max(1, this.getStoreActions(app).length);
      if (key === "up") {
        state.selection = (state.selection - 1 + actionCount) % actionCount;
        return true;
      }
      if (key === "down") {
        state.selection = (state.selection + 1) % actionCount;
        return true;
      }
      if (key === "enter") {
        const action = this.getStoreActions(app)[state.selection];
        if (action) action.run(app);
        return true;
      }
      if (key === "esc" || key === "backspace") {
        state.mode = "stores";
        state.message = "";
        return true;
      }
      return false;
    }
  };
  return page;
}

module.exports = {
  createStoresPage,
  findStore
};