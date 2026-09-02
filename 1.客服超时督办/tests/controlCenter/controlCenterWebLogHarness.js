const vm = require("node:vm");
const { logsPath, logsScript } = require("./controlCenterWebAppAssets");
const { createElementStub } = require("./controlCenterWebDomStub");

function createLogPageHarness() {
  const elements = {
    logOutput: createElementStub(),
    logStatusText: createElementStub()
  };

  const logChannelButtons = ["timeout", "missed_reply", "online_presence", "off_duty"].map((channel) => {
    const button = createElementStub();
    button.dataset.logChannel = channel;
    return button;
  });

  const document = {
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = createElementStub();
      }

      return elements[id];
    },
    querySelectorAll(selector) {
      if (selector === "[data-log-channel]") {
        return logChannelButtons;
      }

      return [];
    }
  };

  const window = {
    __CONTROL_CENTER_DISABLE_BOOTSTRAP__: true,
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
        runtime: {
          logLinesByChannel: {
            timeout: [],
            missed_reply: [],
            online_presence: [],
            off_duty: []
          },
          logLines: []
        }
      })
    }),
    EventSource: function EventSource() {
      return {
        addEventListener() {},
        close() {}
      };
    }
  };

  vm.createContext(context);
  vm.runInContext(logsScript, context, { filename: logsPath });
  return {
    context,
    elements
  };
}

module.exports = {
  createLogPageHarness
};
