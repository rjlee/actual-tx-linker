require('dotenv').config();

function parseListEnv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  BUDGET_DIR: process.env.BUDGET_DIR || './data/budget',
  LOOKBACK_DAYS: parseInt(process.env.LOOKBACK_DAYS || '14', 10),
  WINDOW_HOURS: parseInt(process.env.WINDOW_HOURS || '72', 10),
  MIN_SCORE: parseFloat(process.env.MIN_SCORE || '0.2'),
  INTERVAL_MINS: parseInt(process.env.INTERVAL_MINS || '5', 10),
  INCLUDE_ACCOUNTS: parseListEnv(process.env.INCLUDE_ACCOUNTS),
  EXCLUDE_ACCOUNTS: parseListEnv(process.env.EXCLUDE_ACCOUNTS),
};
