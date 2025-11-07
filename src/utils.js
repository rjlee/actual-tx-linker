const fs = require('fs');
const path = require('path');
const api = require('@actual-app/api');
const logger = require('./logger');
const config = require('./config');

let hasDownloadedBudget = false;

async function openBudget() {
  const url = process.env.ACTUAL_SERVER_URL;
  const password = process.env.ACTUAL_PASSWORD;
  const syncId = process.env.ACTUAL_SYNC_ID;
  if (!url || !password || !syncId) {
    throw new Error(
      'Please set ACTUAL_SERVER_URL, ACTUAL_PASSWORD, and ACTUAL_SYNC_ID environment variables',
    );
  }
  const budgetDir = config.BUDGET_DIR;
  const absBudgetDir = path.isAbsolute(budgetDir)
    ? budgetDir
    : path.join(process.cwd(), budgetDir);
  fs.mkdirSync(absBudgetDir, { recursive: true });

  logger.info('Connecting to Actual API...');
  await api.init({ dataDir: absBudgetDir, serverURL: url, password });

  const opts = {};
  const budgetPassword = process.env.ACTUAL_BUDGET_ENCRYPTION_PASSWORD;
  if (budgetPassword) opts.password = budgetPassword;

  if (!hasDownloadedBudget) {
    logger.info('Downloading budget if needed...');
    try {
      await api.downloadBudget(syncId, opts);
      hasDownloadedBudget = true;
    } catch (err) {
      logger.warn(
        'Download budget may have failed or is cached:',
        err?.message || err,
      );
      // Do not flip the flag to allow a later successful attempt
    }
  } else {
    logger.debug('Skipping download; budget already downloaded this session');
  }

  logger.info('Syncing budget...');
  try {
    await api.sync();
  } catch (err) {
    logger.warn('Initial sync failed:', err?.message || err);
  }
}

async function closeBudget() {
  try {
    await api.shutdown();
  } catch (err) {
    logger.warn('Shutdown failed:', err?.message || err);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepAbortable(ms, signal) {
  if (!signal) return sleep(ms);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = () => {
      try {
        signal.removeEventListener('abort', onAbort);
      } catch {
        /* ignore */
      }
    };
    try {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    } catch {
      // Fallback if AbortController not supported
      /* ignore */
    }
  });
}

module.exports = { openBudget, closeBudget, sleep, sleepAbortable };
