#!/usr/bin/env node
require('dotenv').config();

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const logger = require('./logger');
const cfg = require('./config');
const { openBudget, closeBudget, sleepAbortable } = require('./utils');
const { linkOnce } = require('./linker');

async function runOnce(argv) {
  const {
    lookbackDays,
    windowHours,
    minScore,
    dryRun,
    verbose,
    deleteDuplicate,
  } = argv;
  if (verbose) logger.level = 'debug';
  await openBudget();
  try {
    const count = await linkOnce({
      lookbackDays,
      windowHours,
      minScore,
      dryRun,
      deleteDuplicate,
      clearedOnly: argv.clearedOnly,
      keep: argv.keep,
      skipReconciled: argv.skipReconciled,
      preferReconciled: argv.preferReconciled,
      includeAccounts:
        normalizeList(argv.includeAccounts).length > 0
          ? normalizeList(argv.includeAccounts)
          : cfg.INCLUDE_ACCOUNTS,
      excludeAccounts:
        normalizeList(argv.excludeAccounts).length > 0
          ? normalizeList(argv.excludeAccounts)
          : cfg.EXCLUDE_ACCOUNTS,
      mergeNotes: argv.mergeNotes,
      maxLinksPerRun: argv.maxLinksPerRun,
    });
    logger.info(`Linked ${count} transfers`);
  } finally {
    await closeBudget();
  }
}

async function runDaemon(argv) {
  const intervalMs = Math.max(1, argv.intervalMins) * 60 * 1000;
  if (argv.verbose) logger.level = 'debug';
  const controller = new AbortController();
  let stopping = false;

  const onStop = (sig) => {
    if (stopping) return;
    stopping = true;
    logger.info(`Received ${sig}, stopping daemon gracefully...`);
    try {
      controller.abort();
    } catch (e) {
      /* ignore */ void 0;
    }
  };
  const sigintHandler = () => onStop('SIGINT');
  const sigtermHandler = () => onStop('SIGTERM');
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  // Keep budget open across iterations for performance
  await openBudget();
  try {
    while (!stopping) {
      try {
        await linkOnce({
          lookbackDays: argv.lookbackDays,
          windowHours: argv.windowHours,
          minScore: argv.minScore,
          dryRun: argv.dryRun,
          deleteDuplicate: argv.deleteDuplicate,
          clearedOnly: argv.clearedOnly,
          keep: argv.keep,
          skipReconciled: argv.skipReconciled,
          preferReconciled: argv.preferReconciled,
          includeAccounts:
            normalizeList(argv.includeAccounts).length > 0
              ? normalizeList(argv.includeAccounts)
              : cfg.INCLUDE_ACCOUNTS,
          excludeAccounts:
            normalizeList(argv.excludeAccounts).length > 0
              ? normalizeList(argv.excludeAccounts)
              : cfg.EXCLUDE_ACCOUNTS,
          mergeNotes: argv.mergeNotes,
          maxLinksPerRun: argv.maxLinksPerRun,
        });
      } catch (err) {
        logger.warn('Daemon iteration failed:', err?.message || err);
      }
      await sleepAbortable(intervalMs, controller.signal);
    }
  } finally {
    await closeBudget();
    process.off('SIGINT', sigintHandler);
    process.off('SIGTERM', sigtermHandler);
    logger.info('Daemon stopped.');
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('mode', {
      alias: 'm',
      choices: ['link-once', 'daemon'],
      default: 'link-once',
      describe: 'Run once or run on interval',
    })
    .option('lookback-days', {
      type: 'number',
      default: cfg.LOOKBACK_DAYS,
      describe: 'Days to look back for matching transactions',
    })
    .option('window-hours', {
      type: 'number',
      default: cfg.WINDOW_HOURS,
      describe: 'Max hours between matched transactions',
    })
    .option('min-score', {
      type: 'number',
      default: cfg.MIN_SCORE,
      describe: 'Minimum text similarity score to accept a match',
    })
    .option('interval-mins', {
      type: 'number',
      default: cfg.INTERVAL_MINS,
      describe: 'Daemon interval in minutes',
    })
    .option('max-links-per-run', {
      type: 'number',
      default: 50,
      describe: 'Cap the number of links applied per run',
    })
    .option('cleared-only', {
      type: 'boolean',
      default: true,
      describe: 'Only consider cleared transactions for matching',
    })
    .option('keep', {
      choices: ['outgoing', 'incoming'],
      default: 'outgoing',
      describe: 'Which side to keep when linking a pair',
    })
    .option('include-accounts', {
      type: 'array',
      describe:
        'Only scan these accounts (name or id). Provide multiple flags or comma-separated values.',
      default: [],
    })
    .option('exclude-accounts', {
      type: 'array',
      describe:
        'Skip these accounts (name or id). Provide multiple flags or comma-separated values.',
      default: [],
    })
    .option('delete-duplicate', {
      type: 'boolean',
      default: true,
      describe: 'Delete the original duplicate after linking',
    })
    .option('merge-notes', {
      type: 'boolean',
      default: true,
      describe:
        'Merge a short note from the matched counterpart into the kept transaction',
    })
    .option('dry-run', {
      type: 'boolean',
      default: true,
      describe: 'Only log planned actions without modifying data',
    })
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      default: false,
      describe: 'Enable verbose logging',
    })
    .help().argv;

  const mode = argv.mode;
  if (mode === 'link-once') {
    await runOnce(argv);
  } else {
    await runDaemon(argv);
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };

function normalizeList(val) {
  if (!val) return [];
  const list = Array.isArray(val) ? val : [val];
  return list
    .flatMap((x) =>
      String(x)
        .split(',')
        .map((s) => s.trim()),
    )
    .filter(Boolean);
}
