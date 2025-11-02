const api = require('@actual-app/api');
const logger = require('./logger');

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

function formatYMD(dateish) {
  const d = new Date(dateish);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isSplit(tx) {
  return Boolean(tx.is_parent || tx.is_child);
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

function isTransferLike(tx) {
  return Boolean(tx.transfer_id);
}

async function ensureTransferPayeeId(destAccountId) {
  const payees = await api.getPayees();
  let p = payees.find((x) => x.transfer_acct === destAccountId);
  if (p) return p.id;
  p = await api.createPayee({ name: '', transfer_acct: destAccountId });
  return p.id || p;
}

function buildPayeeIndex(payees) {
  const byId = new Map();
  for (const p of payees) byId.set(p.id, p);
  return byId;
}

function isSelfTransfer(tx, payeeById) {
  if (!tx.payee) return false;
  const p = payeeById.get(tx.payee);
  if (!p || !p.transfer_acct) return false;
  return p.transfer_acct === tx.account;
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

async function repairOnce({
  lookbackDays = 30,
  windowHours = 96,
  minScore = 0,
  deleteDuplicate = true,
  dryRun = true,
  clearedOnly = false,
  skipReconciled = false,
  preferReconciled = true,
  keep = 'outgoing',
  maxRepairsPerRun = 100,
} = {}) {
  const now = new Date();
  const start = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const startYMD = formatYMD(start);
  const endYMD = formatYMD(now);

  logger.info('Repair: fetching accounts, payees, transactions');
  const [accounts, payees] = await Promise.all([
    api.getAccounts(),
    api.getPayees(),
  ]);
  const payeeById = buildPayeeIndex(payees);
  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));

  // Collect recent txns across all accounts
  const all = [];
  for (const acct of accounts) {
    try {
      const txns = await api.getTransactions(acct.id, startYMD, endYMD);
      for (const t of txns) all.push(t);
    } catch (err) {
      logger.warn(
        `Repair: tx fetch failed for ${acct.name}`,
        err?.message || err,
      );
    }
  }

  // Find suspicious/self-transfer transactions
  const candidates = all.filter((t) => {
    if (t.amount === 0) return false;
    if (isSplit(t)) return false;
    if (clearedOnly && t.cleared !== true) return false;
    if (skipReconciled && t.reconciled === true) return false;
    return isSelfTransfer(t, payeeById);
  });
  // Find transfers that incorrectly still have a category set
  const categoryFixes = all.filter((t) => {
    if (t.amount === 0) return false;
    if (isSplit(t)) return false;
    if (clearedOnly && t.cleared !== true) return false;
    if (skipReconciled && t.reconciled === true) return false;
    if (!t.payee) return false;
    const p = payeeById.get(t.payee);
    if (!p || !p.transfer_acct) return false; // not a transfer payee
    if (p.transfer_acct === t.account) return false; // handled by self-transfer path
    return t.category != null; // category should be unset on transfers
  });

  const positives = all.filter((t) => t.amount > 0 && !isSplit(t));
  const negatives = all.filter((t) => t.amount < 0 && !isSplit(t));
  const posByAmt = keyByAmount(positives);
  const negByAmt = keyByAmount(negatives);
  const byId = new Map(all.map((t) => [t.id, t]));
  let repaired = 0;
  const usedIds = new Set();

  // First: fix self-transfers by repointing the payee and deleting the duplicate
  for (const bad of candidates) {
    if (usedIds.has(bad.id)) continue;
    if (repaired >= maxRepairsPerRun) {
      logger.info(`Repair: reached cap ${maxRepairsPerRun}`);
      break;
    }
    const amountAbs = Math.abs(bad.amount);
    const sameAmt =
      bad.amount < 0
        ? posByAmt.get(amountAbs) || []
        : negByAmt.get(amountAbs) || [];
    const cands = sameAmt.filter(
      (cand) =>
        cand.account !== bad.account &&
        withinWindow(bad.date, cand.date, windowHours) &&
        (!clearedOnly || cand.cleared === true) &&
        (!skipReconciled || cand.reconciled === false) &&
        !isTransferLike(cand) &&
        !usedIds.has(cand.id),
    );
    if (cands.length === 0) continue;

    const badText = textFor(bad);
    const scored = cands.map((c) => ({
      c,
      score: similarity(badText, textFor(c)),
      sameDay: sameDay(bad.date, c.date) ? 1 : 0,
    }));
    scored.sort((a, b) => b.sameDay - a.sameDay || b.score - a.score);
    const best = scored[0];
    const ambiguous =
      scored.length > 1 &&
      scored[1].sameDay === best.sameDay &&
      scored[1].score === best.score &&
      best.score >= minScore;
    if (!best || best.score < minScore || ambiguous) continue;

    const outTx = bad.amount < 0 ? bad : best.c;
    const inTx = bad.amount > 0 ? bad : best.c;
    const { keep: keepTx, drop } = chooseKeepAndDrop(
      outTx,
      inTx,
      keep,
      preferReconciled,
    );
    const destAccountId =
      keepTx.account === outTx.account ? inTx.account : outTx.account;

    const srcAcct = accountsById[keepTx.account]?.name || keepTx.account;
    const dstAcct = accountsById[destAccountId]?.name || destAccountId;
    logger.info(
      `Repair: fixing self-transfer on ${srcAcct} -> ${dstAcct} amount=${amountAbs} date=${bad.date}`,
    );
    try {
      if (dryRun) {
        logger.info(
          `DRY RUN: would set transfer payee on txn ${keepTx.id} to account ${destAccountId}`,
        );
        if (keepTx.category != null) {
          logger.info(`DRY RUN: would also clear category on txn ${keepTx.id}`);
        }
        if (deleteDuplicate && drop && drop.id !== keepTx.id) {
          logger.info(`DRY RUN: would delete duplicate txn ${drop.id}`);
        }
      } else {
        const transferPayeeId = await ensureTransferPayeeId(destAccountId);
        const fields = { payee: transferPayeeId };
        if (keepTx.category != null) fields.category = null;
        await api.updateTransaction(keepTx.id, fields);
        if (deleteDuplicate && drop && drop.id !== keepTx.id) {
          try {
            await api.deleteTransaction(drop.id);
          } catch (err) {
            // retry once
            try {
              await api.deleteTransaction(drop.id);
            } catch (e) {
              logger.warn(
                'Repair: delete failed for drop txn',
                e?.message || e,
              );
            }
          }
        }
        usedIds.add(keepTx.id);
        if (drop && drop.id) usedIds.add(drop.id);
        repaired += 1;
      }
    } catch (err) {
      logger.warn('Repair: update failed', err?.message || err);
    }
  }
  // Third: repair inconsistent/missing transfer links where transfer_id exists
  for (const tx of all) {
    if (repaired >= maxRepairsPerRun) break;
    if (isSplit(tx)) continue;
    if (clearedOnly && tx.cleared !== true) continue;
    if (skipReconciled && tx.reconciled === true) continue;
    if (!tx.transfer_id) continue;
    if (usedIds.has(tx.id)) continue;
    const other = byId.get(tx.transfer_id);
    const p = tx.payee ? payeeById.get(tx.payee) : null;
    // Case A: counterpart exists, but payee doesn't point to counterpart account
    if (other && (!p || p.transfer_acct !== other.account)) {
      const srcAcct = accountsById[tx.account]?.name || tx.account;
      const dstAcct = accountsById[other.account]?.name || other.account;
      logger.info(
        `Repair: aligning transfer payee on linked pair ${srcAcct} -> ${dstAcct} date=${tx.date}`,
      );
      try {
        if (dryRun) {
          logger.info(
            `DRY RUN: would set transfer payee on txn ${tx.id} to account ${other.account}`,
          );
        } else {
          const transferPayeeId = await ensureTransferPayeeId(other.account);
          const fields = { payee: transferPayeeId };
          if (tx.category != null) fields.category = null;
          await api.updateTransaction(tx.id, fields);
          usedIds.add(tx.id);
          repaired += 1;
        }
      } catch (err) {
        logger.warn(
          'Repair: failed to align transfer payee',
          err?.message || err,
        );
      }
      continue;
    }
    // Case B: counterpart missing; if payee already indicates a transfer account, re-apply payee to trigger relink
    if (!other && p && p.transfer_acct) {
      const srcAcct = accountsById[tx.account]?.name || tx.account;
      const dstAcct = accountsById[p.transfer_acct]?.name || p.transfer_acct;
      logger.info(
        `Repair: relinking orphaned transfer on ${srcAcct} -> ${dstAcct} date=${tx.date}`,
      );
      try {
        if (dryRun) {
          logger.info(
            `DRY RUN: would re-apply transfer payee on txn ${tx.id} to account ${p.transfer_acct}`,
          );
        } else {
          const transferPayeeId = await ensureTransferPayeeId(p.transfer_acct);
          const fields = { payee: transferPayeeId };
          if (tx.category != null) fields.category = null;
          await api.updateTransaction(tx.id, fields);
          usedIds.add(tx.id);
          repaired += 1;
        }
      } catch (err) {
        logger.warn(
          'Repair: failed to relink orphaned transfer',
          err?.message || err,
        );
      }
    }
  }
  // Second: clear categories on valid transfers
  for (const tx of categoryFixes) {
    if (repaired >= maxRepairsPerRun) {
      logger.info(`Repair: reached cap ${maxRepairsPerRun}`);
      break;
    }
    if (usedIds.has(tx.id)) continue;
    const p = payeeById.get(tx.payee);
    const destAccountId = p?.transfer_acct;
    const srcAcct = accountsById[tx.account]?.name || tx.account;
    const dstAcct = accountsById[destAccountId]?.name || destAccountId;
    logger.info(
      `Repair: clearing category on transfer ${srcAcct} -> ${dstAcct} date=${tx.date}`,
    );
    try {
      if (dryRun) {
        logger.info(`DRY RUN: would clear category on txn ${tx.id}`);
      } else {
        await api.updateTransaction(tx.id, { category: null });
        usedIds.add(tx.id);
        repaired += 1;
      }
    } catch (err) {
      logger.warn('Repair: failed to clear category', err?.message || err);
    }
  }

  try {
    await api.sync();
  } catch (err) {
    logger.warn('Repair: sync failed', err?.message || err);
  }

  logger.info(`Repair: fixed ${repaired} transactions`);
  return repaired;
}

module.exports = { repairOnce };
