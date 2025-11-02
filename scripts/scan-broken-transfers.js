#!/usr/bin/env node
require('dotenv').config();

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const api = require('@actual-app/api');
const { openBudget, closeBudget } = require('../src/utils');

function formatYMD(dateish) {
  const d = new Date(dateish);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('lookback-days', { type: 'number', default: 120 })
    .option('window-hours', { type: 'number', default: 120 })
    .option('cleared-only', { type: 'boolean', default: false })
    .option('skip-reconciled', { type: 'boolean', default: false })
    .option('verbose', { type: 'boolean', default: true })
    .help().argv;

  const now = new Date();
  const start = new Date(
    now.getTime() - argv['lookback-days'] * 24 * 60 * 60 * 1000,
  );
  const startYMD = formatYMD(start);
  const endYMD = formatYMD(now);

  await openBudget();
  try {
    const [accounts, payees] = await Promise.all([
      api.getAccounts(),
      api.getPayees(),
    ]);
    const payeeById = new Map(payees.map((p) => [p.id, p]));
    const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));

    const all = [];
    for (const acct of accounts) {
      const txns = await api.getTransactions(acct.id, startYMD, endYMD);
      for (const t of txns) all.push(t);
    }
    const byId = new Map(all.map((t) => [t.id, t]));
    const byAmtSign = new Map();
    for (const t of all) {
      const key = `${t.amount > 0 ? '+' : '-'}${Math.abs(t.amount)}`;
      if (!byAmtSign.has(key)) byAmtSign.set(key, []);
      byAmtSign.get(key).push(t);
    }

    const issues = [];
    function add(reason, t, extra = {}) {
      const acct = accountsById[t.account]?.name || t.account;
      const p = t.payee ? payeeById.get(t.payee) : null;
      issues.push({
        reason,
        id: t.id,
        acct,
        date: t.date,
        amt: t.amount,
        payee: p,
        ...extra,
      });
    }

    for (const t of all) {
      if (argv['cleared-only'] && t.cleared !== true) continue;
      if (argv['skip-reconciled'] && t.reconciled === true) continue;
      const p = t.payee ? payeeById.get(t.payee) : null;
      const isTransferPayee = p && p.transfer_acct;
      const counterpart = t.transfer_id ? byId.get(t.transfer_id) : null;

      // Transfer with category
      if (isTransferPayee && t.category != null)
        add('transfer-has-category', t, {
          destAcct: accountsById[p.transfer_acct]?.name || p.transfer_acct,
        });

      // Self-transfer
      if (isTransferPayee && p.transfer_acct === t.account)
        add('self-transfer', t);

      // Linked but payee mismatch
      if (
        t.transfer_id &&
        counterpart &&
        (!isTransferPayee || p.transfer_acct !== counterpart.account)
      ) {
        add('linked-payee-mismatch', t, {
          shouldPointTo:
            accountsById[counterpart.account]?.name || counterpart.account,
        });
      }

      // Linked but counterpart missing
      if (t.transfer_id && !counterpart) add('linked-orphan', t);

      // Unlinked but looks like a transfer by symmetry (opposite signed same abs amount same-day):
      if (!t.transfer_id && isTransferPayee) {
        const key = `${t.amount < 0 ? '+' : '-'}${Math.abs(t.amount)}`;
        const cands = (byAmtSign.get(key) || []).filter(
          (x) => x.account === p.transfer_acct && sameDay(x.date, t.date),
        );
        if (cands.length === 0)
          add('unlinked-transfer-no-counterpart', t, {
            destAcct: accountsById[p.transfer_acct]?.name || p.transfer_acct,
          });
        else if (cands.length > 1)
          add('unlinked-transfer-ambiguous', t, { count: cands.length });
      }
    }

    const counts = issues.reduce(
      (m, x) => ((m[x.reason] = (m[x.reason] || 0) + 1), m),
      {},
    );
    // eslint-disable-next-line no-console
    console.log('Summary:', counts);
    for (const it of issues) {
      // eslint-disable-next-line no-console
      console.log(
        `[${it.reason}] id=${it.id} ${it.acct} ${it.date} amt=${(it.amt / 1000).toFixed(2)} raw=${it.amt}`,
      );
    }
  } finally {
    await closeBudget();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
