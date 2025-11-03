require('dotenv').config();

function parseListEnv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBoolEnv(value, defaultVal) {
  if (value === undefined) return defaultVal;
  const v = String(value).trim();
  return !/^(false|0|no)$/i.test(v);
}

function parseIntEnv(value, defaultVal) {
  if (value === undefined) return defaultVal;
  const n = parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n : defaultVal;
}

function parseKeepEnv(value, defaultVal) {
  const v = (value || '').toString().toLowerCase();
  return v === 'incoming' || v === 'outgoing' ? v : defaultVal;
}

module.exports = {
  BUDGET_DIR: process.env.BUDGET_DIR || './data/budget',
  LOOKBACK_DAYS: parseInt(process.env.LOOKBACK_DAYS || '14', 10),
  WINDOW_HOURS: parseInt(process.env.WINDOW_HOURS || '72', 10),
  MIN_SCORE: parseFloat(process.env.MIN_SCORE || '0.2'),
  INCLUDE_ACCOUNTS: parseListEnv(process.env.INCLUDE_ACCOUNTS),
  EXCLUDE_ACCOUNTS: parseListEnv(process.env.EXCLUDE_ACCOUNTS),
  // New env-driven defaults for formerly CLI-only opts
  DELETE_DUPLICATE: parseBoolEnv(process.env.DELETE_DUPLICATE, true),
  PAIR_MULTIPLES: parseBoolEnv(process.env.PAIR_MULTIPLES, true),
  MERGE_NOTES: parseBoolEnv(process.env.MERGE_NOTES, true),
  CLEARED_ONLY: parseBoolEnv(process.env.CLEARED_ONLY, true),
  SKIP_RECONCILED: parseBoolEnv(process.env.SKIP_RECONCILED, true),
  PREFER_RECONCILED: parseBoolEnv(process.env.PREFER_RECONCILED, true),
  KEEP: parseKeepEnv(process.env.KEEP, 'outgoing'),
  MAX_LINKS_PER_RUN: parseIntEnv(process.env.MAX_LINKS_PER_RUN, 50),
};
