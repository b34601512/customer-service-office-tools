const vm = require("node:vm");
const {
  appScript,
  customerMirrorDetailDialogPath,
  customerMirrorDetailDialogScript,
  customerMirrorListPath,
  customerMirrorListScript
} = require("./controlCenterWebAppAssets");
const { createElementStub } = require("./controlCenterWebDomStub");

function createAppPageHarness() {
  const elements = {};
  const document = {
    body: createElementStub(),
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
    }
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
      json: async () => ({ ok: true })
    })
  };

  vm.createContext(context);
  vm.runInContext(customerMirrorDetailDialogScript, context, { filename: customerMirrorDetailDialogPath });
  vm.runInContext(customerMirrorListScript, context, { filename: customerMirrorListPath });
  vm.runInContext(appScript, context, { filename: "control-center-app-bundle.js" });
  return {
    context,
    elements
  };
}

module.exports = {
  createAppPageHarness
};
