#!/usr/bin/env node
require('dotenv').config();

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const logger = require('./logger');
const cfg = require('./config');
const { openBudget, closeBudget, sleepAbortable } = require('./utils');
const { linkOnce } = require('./linker');
const { configureArgs, runLinkJob, triggerDebounced } = require('./runner');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const cron = require('node-cron');

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
      startDate: argv.startDate,
      endDate: argv.endDate,
      interactive: argv.interactive,
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
      pairMultiples: argv.pairMultiples,
    });
    logger.info(`Linked ${count} transfers`);
  } finally {
    await closeBudget();
  }
}

async function runRepair(argv) {
  const { lookbackDays, windowHours, minScore, verbose } = argv;
  if (verbose) logger.level = 'debug';
  const { repairOnce } = require('./repair');
  await openBudget();
  try {
    const count = await repairOnce({
      lookbackDays,
      windowHours,
      minScore,
      deleteDuplicate: argv.deleteDuplicate,
      dryRun: argv.dryRun,
      clearedOnly: argv.clearedOnly,
      skipReconciled: argv.skipReconciled,
      preferReconciled: argv.preferReconciled,
      keep: argv.keep,
      maxRepairsPerRun: argv.maxLinksPerRun,
    });
    logger.info(`Repaired ${count} transfers`);
  } finally {
    await closeBudget();
  }
}

function scheduleLinking() {
  const disableCron = process.env.DISABLE_CRON_SCHEDULING === 'true';
  const schedule = process.env.LINK_CRON || '0 * * * *';
  const timezone = process.env.LINK_CRON_TIMEZONE || 'UTC';
  if (disableCron) {
    logger.info({ job: 'linker' }, 'Cron scheduling disabled');
    return false;
  }
  if (!cron.validate(schedule)) {
    logger.error({ schedule }, `Invalid LINK_CRON: ${schedule}`);
    process.exit(1);
  }
  logger.info(
    { job: 'linker', schedule, timezone },
    'Scheduling linker daemon',
  );
  cron.schedule(
    schedule,
    async () => {
      const ts = new Date().toISOString();
      logger.info({ ts }, 'Daemon link run start');
      try {
        await runLinkJob();
        logger.info({ ts }, 'Daemon link run complete');
      } catch (err) {
        logger.warn('Daemon link run failed:', err?.message || err);
      }
    },
    timezone ? { timezone } : {},
  );
  return true;
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
    // Configure shared runner with current args supplier
    configureArgs(() => ({
      lookbackDays: argv.lookbackDays,
      windowHours: argv.windowHours,
      minScore: argv.minScore,
      dryRun: argv.dryRun,
      deleteDuplicate: argv.deleteDuplicate,
      startDate: argv.startDate,
      endDate: argv.endDate,
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
      pairMultiples: argv.pairMultiples,
    }));

    // Optional: integrate with actual-events SSE
    const enableEvents =
      /^true$/i.test(process.env.ENABLE_EVENTS || '') ||
      process.env.ENABLE_EVENTS === '1';
    const eventsUrl = process.env.EVENTS_URL || '';
    const authToken = process.env.EVENTS_AUTH_TOKEN || '';
    if (enableEvents && eventsUrl) {
      startEventsListener({ eventsUrl, authToken, verbose: argv.verbose });
    } else if (enableEvents && !eventsUrl) {
      logger.warn(
        'ENABLE_EVENTS set but EVENTS_URL missing; skipping event listener',
      );
    }

    // If cron scheduling is enabled, do not use interval loop
    const usingCron = scheduleLinking();
    if (!usingCron) {
      while (!stopping) {
        try {
          await runLinkJob();
        } catch (err) {
          logger.warn('Daemon iteration failed:', err?.message || err);
        }
        await sleepAbortable(intervalMs, controller.signal);
      }
    } else {
      // Keep process alive while cron timers run
      // eslint-disable-next-line no-constant-condition
      while (!stopping) {
        await sleepAbortable(60 * 1000, controller.signal);
      }
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
      choices: ['link-once', 'daemon', 'repair'],
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
    .option('start-date', {
      type: 'string',
      describe:
        'Start date (YYYY-MM-DD only). If set, overrides lookback-days together with --end-date.',
    })
    .option('end-date', {
      type: 'string',
      describe:
        'End date (YYYY-MM-DD only). If set, overrides lookback-days together with --start-date. Defaults to today when only start-date is set.',
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
    .option('skip-reconciled', {
      type: 'boolean',
      default: cfg.SKIP_RECONCILED,
      describe: 'Skip reconciled transactions entirely',
    })
    .option('prefer-reconciled', {
      type: 'boolean',
      default: cfg.PREFER_RECONCILED,
      describe: 'When not skipping reconciled, keep the reconciled side',
    })
    .option('max-links-per-run', {
      type: 'number',
      default: cfg.MAX_LINKS_PER_RUN,
      describe: 'Cap the number of links applied per run',
    })
    .option('cleared-only', {
      type: 'boolean',
      default: cfg.CLEARED_ONLY,
      describe: 'Only consider cleared transactions for matching',
    })
    .option('keep', {
      choices: ['outgoing', 'incoming'],
      default: cfg.KEEP,
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
      default: cfg.DELETE_DUPLICATE,
      describe: 'Delete the original duplicate after linking',
    })
    .option('pair-multiples', {
      type: 'boolean',
      default: cfg.PAIR_MULTIPLES,
      describe:
        'Deterministically pair same-day, same-amount multiples instead of skipping as ambiguous',
    })
    .option('merge-notes', {
      type: 'boolean',
      default: cfg.MERGE_NOTES,
      describe:
        'Merge a short note from the matched counterpart into the kept transaction',
    })
    .option('interactive', {
      alias: 'i',
      type: 'boolean',
      default: false,
      describe: 'Prompt before linking each candidate and show details',
    })
    .option('dry-run', {
      type: 'boolean',
      default:
        process.env.DRY_RUN !== undefined
          ? !/^(false|0|no)$/i.test(process.env.DRY_RUN)
          : true,
      describe:
        'Only log planned actions without modifying data (can also set DRY_RUN env)',
    })
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      default: false,
      describe: 'Enable verbose logging',
    })
    .check((args) => {
      const rx = /^\d{4}-\d{2}-\d{2}$/;
      if (args.startDate && !rx.test(args.startDate)) {
        throw new Error(
          `Invalid --start-date format '${args.startDate}'. Expected YYYY-MM-DD (no time).`,
        );
      }
      if (args.endDate && !rx.test(args.endDate)) {
        throw new Error(
          `Invalid --end-date format '${args.endDate}'. Expected YYYY-MM-DD (no time).`,
        );
      }
      return true;
    })
    .help().argv;

  const mode = argv.mode;
  if (mode === 'link-once') {
    await runOnce(argv);
  } else if (mode === 'daemon') {
    await runDaemon(argv);
  } else if (mode === 'repair') {
    await runRepair(argv);
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

// Lightweight SSE client to subscribe to actual-events and trigger linking runs
function startEventsListener({ eventsUrl, authToken, verbose }) {
  try {
    const base = new URL(eventsUrl);
    if (!base.searchParams.get('events')) {
      base.searchParams.set('events', '^transaction\\.(created|updated)$');
      base.searchParams.set('entities', 'transaction');
      base.searchParams.set('useRegex', 'true');
    }
    const isHttps = base.protocol === 'https:';
    const agent = isHttps ? https : http;
    let lastId = undefined;
    let retryMs = 2000;

    const connect = () => {
      const headers = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      if (lastId) headers['Last-Event-ID'] = lastId;
      headers['Accept'] = 'text/event-stream';
      const req = agent.request(base, { method: 'GET', headers }, (res) => {
        if (res.statusCode !== 200) {
          logger.warn(
            { status: res.statusCode },
            'Event stream returned non-200; will retry',
          );
          res.resume();
          setTimeout(connect, retryMs);
          retryMs = Math.min(30000, retryMs * 2);
          return;
        }
        logger.info({ url: base.toString() }, 'Connected to event stream');
        retryMs = 2000;
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString('utf8');
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            handleEvent(raw);
          }
        });
        res.on('end', () => {
          logger.warn('Event stream ended; reconnecting');
          setTimeout(connect, retryMs);
          retryMs = Math.min(30000, retryMs * 2);
        });
      });
      req.on('error', (err) => {
        logger.warn({ err }, 'Event stream error; reconnecting');
        setTimeout(connect, retryMs);
        retryMs = Math.min(30000, retryMs * 2);
      });
      req.end();
    };

    const handleEvent = (raw) => {
      try {
        const lines = raw.split(/\r?\n/);
        let id = null;
        let event = 'message';
        let data = '';
        for (const line of lines) {
          if (!line) continue;
          if (line.startsWith('id:')) id = line.slice(3).trim();
          else if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (id) lastId = id;
        if (!data) return;
        const payload = JSON.parse(data);
        if (
          event === 'transaction.created' ||
          event === 'transaction.updated'
        ) {
          if (verbose) {
            logger.info(
              { event, txId: payload?.after?.id || payload?.before?.id },
              'Event received; scheduling link run',
            );
          }
          triggerDebounced({ delayMs: 1500 });
        }
      } catch (e) {
        /* ignore */ void 0;
      }
    };

    connect();
  } catch (err) {
    logger.warn({ err }, 'Failed to start event listener');
  }
}
