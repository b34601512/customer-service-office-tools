const { resolveBrowserMode } = require("../src/engine/browserAutomationScope");
try {
  process.env.CUSTOMER_PERFORMANCE_BROWSER_MODE = resolveBrowserMode(process.argv[2]);
  process.argv.splice(2, 1);
  require("../src/cli/startCli");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
