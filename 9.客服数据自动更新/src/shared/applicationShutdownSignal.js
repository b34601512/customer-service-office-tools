let applicationShutdownRequested = false;

function requestApplicationShutdown() {
  applicationShutdownRequested = true;
}

function isApplicationShutdownRequested() {
  return applicationShutdownRequested;
}

function resetApplicationShutdownSignal() {
  applicationShutdownRequested = false;
}

module.exports = {
  requestApplicationShutdown,
  isApplicationShutdownRequested,
  resetApplicationShutdownSignal
};
