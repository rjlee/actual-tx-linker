const api = require('@actual-app/api');
const logger = require('./logger');
const { sleep } = require('./utils');
const readline = require('readline');

function normalizeText(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim();
}

function tokens(s) {
  return new Set(
    normalizeText(s)
      .split(' ')
      .filter((t) => t.length >= 3),
  );
}

function textFor(tx) {
  // Pull a few sources and merge
  const parts = [
    tx.description,
    tx.imported_description,
    tx.imported_payee,
    tx.notes,
  ]
    .map((x) => x || '')
    .filter(Boolean);
  return normalizeText(parts.join(' '));
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return inter / union;
}

function withinWindow(aDateStr, bDateStr, windowHours) {
  const a = new Date(aDateStr).getTime();
  const b = new Date(bDateStr).getTime();
  const diff = Math.abs(a - b);
  return diff <= windowHours * 60 * 60 * 1000;
}

function keyByAmount(txns) {
  const map = new Map();
  for (const t of txns) {
    const k = Math.abs(t.amount);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return map;
}

function formatAmount(milliunits) {
  // Actual uses milliunits; render as standard decimal with 2 places
  const units = milliunits / 1000;
  return units.toFixed(2);
}

function formatYMD(dateish) {
  const d = new Date(dateish);
  // Format as YYYY-MM-DD (Actual expects date-only strings for filters)
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseYMDStrict(value, label = 'date') {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${label}: expected YYYY-MM-DD string`);
  }
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    throw new Error(
      `Invalid ${label} format: '${value}'. Expected YYYY-MM-DD (no time).`,
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  // Validate round-trip to catch invalid dates like 2025-02-30
  if (formatYMD(dt) !== value) {
    throw new Error(
      `Invalid ${label} value: '${value}' is not a real calendar date`,
    );
  }
  return dt;
}

function sameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}

async function ensureTransferPayeeId(destAccountId) {
  const payees = await api.getPayees();
  let p = payees.find((x) => x.transfer_acct === destAccountId);
  if (p) return p.id;
  // Create a new transfer payee for dest account
  p = await api.createPayee({ name: '', transfer_acct: destAccountId });
  return p.id || p; // API may return id or object
}

/* istanbul ignore next */
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

function describeTxn(tx, accountName) {
  const dir = tx.amount < 0 ? 'outgoing' : 'incoming';
  const parts = [];
  parts.push(`- account: ${accountName || tx.account}`);
  parts.push(
    `- id: ${tx.id} | date: ${tx.date} | amount: ${formatAmount(Math.abs(tx.amount))} (${dir})`,
  );
  parts.push(`- cleared: ${!!tx.cleared} | reconciled: ${!!tx.reconciled}`);
  if (tx.description) parts.push(`- description: ${tx.description}`);
  if (tx.imported_description)
    parts.push(`- imported_description: ${tx.imported_description}`);
  if (tx.imported_payee) parts.push(`- imported_payee: ${tx.imported_payee}`);
  if (tx.notes) parts.push(`- notes: ${tx.notes}`);
  return parts.join('\n');
}

function chooseKeepAndDrop(
  outTx,
  inTx,
  keep = 'outgoing',
  preferReconciled = true,
) {
  if (preferReconciled) {
    const outRec = !!outTx.reconciled;
    const inRec = !!inTx.reconciled;
    if (outRec !== inRec) {
      return outRec ? { keep: outTx, drop: inTx } : { keep: inTx, drop: outTx };
    }
  }
  if (keep === 'incoming') {
    return { keep: inTx, drop: outTx };
  }
  return { keep: outTx, drop: inTx };
}

function isTransferLike(tx) {
  return Boolean(tx.transfer_id);
}

function isSplit(tx) {
  return Boolean(tx.is_parent || tx.is_child);
}

function accountMatchesToken(account, token) {
  const t = String(token).toLowerCase();
  return (
    account.id.toLowerCase() === t ||
    (account.name && account.name.toLowerCase() === t)
  );
}

async function linkOnce({
  lookbackDays = 14,
  windowHours = 72,
  minScore = 0.2,
  dryRun = false,
  deleteDuplicate = true,
  includeAccounts = [],
  excludeAccounts = [],
  mergeNotes = true,
  clearedOnly = true,
  keep = 'outgoing',
  maxLinksPerRun = 50,
  skipReconciled = true,
  preferReconciled = true,
  pairMultiples = true,
  interactive = false,
  startDate = undefined,
  endDate = undefined,
} = {}) {
  const dayMs = 24 * 60 * 60 * 1000;
  const now = new Date();
  const endObj = endDate ? parseYMDStrict(endDate, 'end-date') : now;
  const startObj = startDate
    ? parseYMDStrict(startDate, 'start-date')
    : new Date(endObj.getTime() - lookbackDays * dayMs);
  const startYMD = formatYMD(startObj);
  const endYMD = formatYMD(endObj);
  if (endDate && !startDate) {
    logger.info(
      `Only --end-date provided; using start-date ${startYMD} computed from lookback-days=${lookbackDays}`,
    );
  }
  if (new Date(startYMD) > new Date(endYMD)) {
    throw new Error(
      `Invalid date range: start-date ${startYMD} after end-date ${endYMD}`,
    );
  }

  logger.info('Fetching accounts');
  const accounts = await api.getAccounts();
  let eligible = accounts;
  if (includeAccounts.length > 0) {
    eligible = accounts.filter((a) =>
      includeAccounts.some((t) => accountMatchesToken(a, t)),
    );
    // Warn for any include tokens that matched no account
    for (const token of includeAccounts) {
      const matched = accounts.some((a) => accountMatchesToken(a, token));
      if (!matched) {
        logger.warn(`Include token '${token}' did not match any account`);
      }
    }
  }
  if (excludeAccounts.length > 0) {
    eligible = eligible.filter(
      (a) => !excludeAccounts.some((t) => accountMatchesToken(a, t)),
    );
  }
  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));

  logger.info('Fetching recent transactions');
  const all = [];
  for (const acct of eligible) {
    try {
      const txns = await api.getTransactions(acct.id, startYMD, endYMD);
      for (const t of txns) all.push(t);
    } catch (err) {
      logger.warn(
        `Failed tx fetch for account ${acct.name}:`,
        err?.message || err,
      );
    }
  }

  // Filter candidates
  const negatives = all.filter((t) => t.amount < 0);
  const positives = all.filter((t) => t.amount > 0);
  const outgoing = all.filter(
    (t) =>
      t.amount < 0 &&
      !isTransferLike(t) &&
      !isSplit(t) &&
      (!clearedOnly || t.cleared === true) &&
      (!skipReconciled || t.reconciled === false),
  );
  const incoming = all.filter(
    (t) =>
      t.amount > 0 &&
      !isTransferLike(t) &&
      !isSplit(t) &&
      (!clearedOnly || t.cleared === true) &&
      (!skipReconciled || t.reconciled === false),
  );

  const incomingByAmt = keyByAmount(incoming);
  const matches = [];
  const ambiguousGroups = new Map(); // key -> { outs: [], incIds: Set(), incAcct: string }
  const stats = {
    totalOutgoing: negatives.length,
    totalIncoming: positives.length,
    outgoingConsidered: outgoing.length,
    incomingConsidered: incoming.length,
    outgoingFiltered: negatives.length - outgoing.length,
    incomingFiltered: positives.length - incoming.length,
    candidatesEvaluated: 0,
    noCandidateInWindow: 0,
    belowScore: 0,
    ambiguous: 0,
    matched: 0,
    failures: 0,
  };

  for (const out of outgoing) {
    const group = incomingByAmt.get(Math.abs(out.amount));
    if (!group || group.length === 0) {
      continue;
    }
    const cands = group.filter(
      (cand) =>
        cand.account !== out.account &&
        withinWindow(out.date, cand.date, windowHours),
    );
    if (cands.length === 0) {
      stats.noCandidateInWindow += 1;
      const outName =
        (accountsById[out.account] && accountsById[out.account].name) ||
        out.account;
      logger.debug(
        `Skip: no candidate within window for ${outName} amount=${formatAmount(Math.abs(out.amount))} on ${out.date}`,
      );
      continue;
    }
    const outText = textFor(out);
    // Priority: same day preferred, then score
    const scored = cands.map((c) => ({
      c,
      score: similarity(outText, textFor(c)),
      sameDay: sameDay(out.date, c.date) ? 1 : 0,
    }));
    stats.candidatesEvaluated += scored.length;
    scored.sort((a, b) => b.sameDay - a.sameDay || b.score - a.score);
    const best = scored[0];
    // Determine top-priority candidate set (sameDay priority, then equal score)
    let topSameDay = best ? best.sameDay : 0;
    let topScore = best ? best.score : 0;
    const topCands = scored.filter(
      (s) => s.sameDay === topSameDay && s.score === topScore,
    );
    const isAmbiguous = topCands.length > 1 && topScore >= minScore;
    if (isAmbiguous) {
      if (pairMultiples) {
        // Only consider for grouping if all candidates are from the same incoming account
        const incAcct = topCands[0].c.account;
        const sameAcct = topCands.every((s) => s.c.account === incAcct);
        if (!sameAcct) {
          stats.ambiguous += 1;
          continue;
        }
        const key = `${Math.abs(out.amount)}|${out.date}|${incAcct}`;
        let g = ambiguousGroups.get(key);
        if (!g) {
          g = { outs: [], incIds: new Set(), incAcct };
          ambiguousGroups.set(key, g);
        }
        g.outs.push(out);
        for (const s of topCands) g.incIds.add(s.c.id);
        continue;
      } else {
        stats.ambiguous += 1;
        const outName =
          (accountsById[out.account] && accountsById[out.account].name) ||
          out.account;
        logger.debug(
          `Skip ambiguous match for ${outName} amount=${formatAmount(Math.abs(out.amount))} on ${out.date}`,
        );
        continue;
      }
    }
    if (best && best.score >= minScore) {
      matches.push({
        out,
        inc: best.c,
        score: best.score,
        sameDay: best.sameDay === 1,
      });
    } else {
      stats.belowScore += 1;
      const outName =
        (accountsById[out.account] && accountsById[out.account].name) ||
        out.account;
      logger.debug(
        `Skip below-score match for ${outName} amount=${formatAmount(Math.abs(out.amount))} on ${out.date} (top=${best.score.toFixed(2)})`,
      );
    }
  }

  // Resolve grouped ambiguities deterministically if enabled
  if (pairMultiples && ambiguousGroups.size > 0) {
    // Build id -> txn map
    const byId = new Map(all.map((t) => [t.id, t]));
    for (const group of ambiguousGroups.values()) {
      const outs = group.outs.slice().sort((a, b) => a.id.localeCompare(b.id));
      const incs = Array.from(group.incIds)
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((a, b) => a.id.localeCompare(b.id));
      if (outs.length !== incs.length || outs.length === 0) {
        continue; // can't pair reliably
      }
      for (let i = 0; i < outs.length; i += 1) {
        matches.push({
          out: outs[i],
          inc: incs[i],
          score: 1,
          sameDay: true,
        });
      }
    }
  }

  // De-duplicate matches that share the same incoming or outgoing transaction
  const usedOut = new Set();
  const usedIn = new Set();
  const final = [];
  for (const m of matches) {
    if (usedOut.has(m.out.id) || usedIn.has(m.inc.id)) continue;
    usedOut.add(m.out.id);
    usedIn.add(m.inc.id);
    final.push(m);
  }

  logger.info(`Found ${final.length} linkable transfer candidates`);
  let linked = 0;
  if (dryRun) {
    for (const m of final) {
      const srcAcct = accountsById[m.out.account];
      const dstAcct = accountsById[m.inc.account];
      logger.info(
        `Linking ${srcAcct?.name || m.out.account} -> ${dstAcct?.name || m.inc.account} | ` +
          `amount=${formatAmount(Math.abs(m.out.amount))} (raw=${Math.abs(m.out.amount)}) score=${m.score.toFixed(2)} ` +
          `dates=${m.out.date} & ${m.inc.date}` +
          (m.sameDay ? ' (same-day)' : ''),
      );
      const { keep: keepTx, drop } = chooseKeepAndDrop(
        m.out,
        m.inc,
        keep,
        preferReconciled,
      );
      let preview = '';
      if (mergeNotes) {
        const merged = buildMergedNotes(
          keepTx,
          drop,
          srcAcct?.name,
          dstAcct?.name,
        );
        if (merged && merged !== (keepTx.notes || '')) {
          preview = `; notes=> ${merged}`;
        }
      }
      logger.info(
        `DRY RUN: would set transfer payee on txn ${keepTx.id} and delete duplicate ${drop.id}${preview}`,
      );
    }
  } else {
    let approveAll = false;
    for (const m of final) {
      const srcAcct = accountsById[m.out.account];
      const dstAcct = accountsById[m.inc.account];
      logger.info(
        `Linking ${srcAcct?.name || m.out.account} -> ${dstAcct?.name || m.inc.account} | ` +
          `amount=${formatAmount(Math.abs(m.out.amount))} (raw=${Math.abs(m.out.amount)}) score=${m.score.toFixed(2)} ` +
          `dates=${m.out.date} & ${m.inc.date}` +
          (m.sameDay ? ' (same-day)' : ''),
      );
      /* istanbul ignore next */
      if (interactive && process.stdin.isTTY && !approveAll) {
        try {
          const header = `\nCandidate match details:\n`;
          const left = describeTxn(m.out, srcAcct?.name);
          const right = describeTxn(m.inc, dstAcct?.name);
          process.stdout.write(header);
          process.stdout.write('Outgoing transaction:\n');
          process.stdout.write(left + '\n');
          process.stdout.write('Incoming transaction:\n');
          process.stdout.write(right + '\n');
          // eslint-disable-next-line no-await-in-loop
          const ans = (
            await prompt('Link this pair? [Y]es/[n]o/[a]ll/[q]uit: ')
          ).toLowerCase();
          if (ans === 'q') break;
          if (ans === 'a') {
            approveAll = true;
          } else if (ans === 'n') {
            continue; // skip this one
          } // default yes on 'y' or empty
        } catch (e) {
          // if prompt fails, fall back to continue non-interactive
        }
      }
      try {
        const { keep: keepTx, drop } = chooseKeepAndDrop(
          m.out,
          m.inc,
          keep,
          preferReconciled,
        );
        // Choose destination account as the opposite side of the kept txn
        const destAccountId =
          keepTx.account === m.out.account ? m.inc.account : m.out.account;
        const transferPayeeId = await ensureTransferPayeeId(destAccountId);
        const fields = { payee: transferPayeeId };
        // Ensure transfers have no category; clear if present
        if (keepTx.category != null) {
          fields.category = null;
        }
        if (mergeNotes) {
          const merged = buildMergedNotes(
            keepTx,
            drop,
            srcAcct?.name,
            dstAcct?.name,
          );
          if (merged) fields.notes = merged;
        }
        await api.updateTransaction(keepTx.id, fields);
        if (deleteDuplicate) {
          try {
            await api.deleteTransaction(drop.id);
          } catch (err) {
            logger.warn(
              `Delete failed once for ${drop.id}, retrying:`,
              err?.message || err,
            );
            await sleep(250);
            await api.deleteTransaction(drop.id);
          }
        }
        linked += 1;
      } catch (err) {
        logger.warn('Linking failed:', err?.message || err);
        stats.failures += 1;
      }
      if (linked >= maxLinksPerRun) {
        logger.info(`Reached max-links-per-run (${maxLinksPerRun}), stopping`);
        break;
      }
    }
  }
  stats.matched = linked;

  try {
    await api.sync();
  } catch (err) {
    logger.warn('Sync after linking failed:', err?.message || err);
  }

  // Summary
  logger.info(
    `Summary: outNeg=${stats.totalOutgoing} (filtered=${stats.outgoingFiltered} -> considered=${stats.outgoingConsidered}), ` +
      `inPos=${stats.totalIncoming} (filtered=${stats.incomingFiltered} -> considered=${stats.incomingConsidered}), ` +
      `candidates=${stats.candidatesEvaluated}, matched=${stats.matched}, ambiguous=${stats.ambiguous}, belowScore=${stats.belowScore}, noWindow=${stats.noCandidateInWindow}, failures=${stats.failures}`,
  );

  return linked;
}

function buildMergedNotes(keep, drop, fromName, toName) {
  const base = keep.notes || '';
  const ref = [
    drop.description,
    drop.imported_description,
    drop.imported_payee,
  ].find(Boolean);
  const summary = `Transfer matched with ${toName || drop.account} on ${drop.date}${
    ref ? ` (ref: ${ref})` : ''
  }`;
  if (!base) return summary;
  const normalized = (s) => String(s).toLowerCase();
  if (normalized(base).includes(normalized(summary))) return base;
  // Append succinctly
  return `${base} | ${summary}`;
}

module.exports = {
  linkOnce,
  __internals: {
    withinWindow,
    formatYMD,
    parseYMDStrict,
    chooseKeepAndDrop,
    buildMergedNotes,
    sameDay,
  },
};
