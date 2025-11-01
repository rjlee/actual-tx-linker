const logger = require('./logger');
const { linkOnce } = require('./linker');

let running = false;
let pending = false;
let debounceTimer = null;
let getArgs = () => ({ dryRun: true });

function configureArgs(fn) {
  if (typeof fn === 'function') getArgs = fn;
}

async function runLinkJob() {
  if (running) {
    logger.warn(
      { source: 'runner' },
      'Skipping scheduled link run: previous run still in progress',
    );
    pending = true;
    return 0;
  }
  running = true;
  try {
    const args = getArgs();
    const count = await linkOnce(args);
    return count;
  } catch (err) {
    logger.warn('Link job failed:', err?.message || err);
    return 0;
  } finally {
    running = false;
    if (pending) {
      pending = false;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        runLinkJob().catch(() => {});
      }, 1000);
    }
  }
}

function triggerDebounced({ delayMs = 1500 } = {}) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(
    () => {
      runLinkJob().catch(() => {});
    },
    Math.max(0, delayMs),
  );
}

module.exports = { configureArgs, runLinkJob, triggerDebounced };
