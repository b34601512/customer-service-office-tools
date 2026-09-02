const vm = require("node:vm");
const {
  appScript,
  customerMirrorDetailDialogScript,
  customerMirrorListScript,
  settingsHtmlPath,
  settingsScript
} = require("./controlCenterWebAppAssets");
const { createClassListStub, createElementStub } = require("./controlCenterWebDomStub");

function createSettingsPageHarness() {
  const elements = {};
  const configPages = [
    "hub",
    "params",
    "timeoutReminder",
    "missedReply",
    "missedReplyRuntime",
    "missedReplyTemporaryKeywords",
    "missedReplyResolutionKeywords",
    "missedReplyClosingKeywords",
    "missedReplyInvalidKeywords",
    "missedReplyPlatformNoticeKeywords",
    "onlinePresence",
    "offDuty",
    "wecom"
  ].map((pageName) => {
    const page = createElementStub();
    page.dataset.configPage = pageName;
    page.classList = createClassListStub(pageName === "hub" ? [] : ["hidden"]);
    return page;
  });
  const configPageButtons = [
    "params",
    "timeoutReminder",
    "missedReply",
    "missedReplyRuntime",
    "missedReplyTemporaryKeywords",
    "missedReplyResolutionKeywords",
    "missedReplyClosingKeywords",
    "missedReplyInvalidKeywords",
    "missedReplyPlatformNoticeKeywords",
    "onlinePresence",
    "offDuty",
    "wecom",
    "hub"
  ].map((targetName) => {
    const button = createElementStub();
    button.dataset.configPageTarget = targetName;
    button.events = {};
    button.addEventListener = (eventName, handler) => {
      button.events[eventName] = handler;
    };
    return button;
  });
  const document = {
    body: createElementStub(),
    activeElement: createElementStub(),
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = createElementStub();
      }

      return elements[id];
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return createElementStub();
    },
    addEventListener() {}
  };
  const configModal = document.getElementById("configModal");
  configModal.querySelectorAll = (selector) => {
    if (selector === "[data-config-page]") {
      return configPages;
    }
    if (selector === "[data-config-page-target]") {
      return configPageButtons;
    }

    return [];
  };
  const window = {
    setTimeout() {},
    open() {}
  };
  const context = {
    console,
    document,
    window,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        config: {},
        wecomRobot: {}
      })
    })
  };

  vm.createContext(context);
  vm.runInContext(settingsScript, context, { filename: "control-center-settings-bundle.js" });
  return {
    configPages,
    configPageButtons,
    elements
  };
}

function createInteractiveElementStub(initialClassNames = []) {
  const element = createElementStub();
  element.events = {};
  element.attributes = {};
  element.classList = createClassListStub(initialClassNames);
  element.addEventListener = (eventName, handler) => {
    element.events[eventName] = handler;
  };
  element.setAttribute = (name, value) => {
    element.attributes[name] = value;
  };
  return element;
}

function createIndexConfigModalHarness() {
  const elements = {};
  const configPages = ["hub", "params", "timeoutReminder", "missedReply", "onlinePresence", "offDuty", "wecom"].map(
    (pageName) => {
      const page = createInteractiveElementStub(pageName === "hub" ? [] : ["hidden"]);
      page.dataset.configPage = pageName;
      return page;
    }
  );
  const document = {
    body: createInteractiveElementStub(),
    activeElement: createInteractiveElementStub(),
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = createInteractiveElementStub(id === "configModal" || id === "keywordAddModal" ? ["hidden"] : []);
      }

      return elements[id];
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return createInteractiveElementStub();
    },
    addEventListener() {}
  };
  const configModal = document.getElementById("configModal");
  configModal.querySelectorAll = (selector) => {
    if (selector === "[data-config-page]") {
      return configPages;
    }

    return [];
  };
  const window = {
    __CONTROL_CENTER_DISABLE_BOOTSTRAP__: true,
    setTimeout() {},
    setInterval() {},
    open() {}
  };
  const context = {
    console,
    document,
    window,
    EventSource: function EventSource() {
      return {
        addEventListener() {},
        close() {}
      };
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        runtime: { currentTask: null },
        dashboard: {},
        loginStatus: null,
        config: {},
        wecomRobot: {}
      })
    })
  };

  vm.createContext(context);
  vm.runInContext(customerMirrorDetailDialogScript, context, { filename: "customerMirrorDetailDialog.js" });
  vm.runInContext(customerMirrorListScript, context, { filename: "customerMirrorList.js" });
  vm.runInContext(appScript, context, { filename: "control-center-app-bundle.js" });
  vm.runInContext(settingsScript, context, { filename: "control-center-settings-bundle.js" });
  return {
    configPages,
    elements
  };
}

module.exports = {
  createIndexConfigModalHarness,
  createSettingsPageHarness
};
