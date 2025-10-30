const logger = {
  level: process.env.LOG_LEVEL || 'info',
  _levels: { error: 0, warn: 1, info: 2, debug: 3 },
};

function canLog(lvl) {
  const curr = logger._levels[logger.level] ?? 2;
  return (logger._levels[lvl] ?? 2) <= curr;
}

['error', 'warn', 'info', 'debug'].forEach((lvl) => {
  logger[lvl] = (...args) => {
    if (canLog(lvl)) {
      const ts = new Date().toISOString();
      // eslint-disable-next-line no-console
      console[lvl === 'debug' ? 'log' : lvl](`[${ts}] [${lvl}]`, ...args);
    }
  };
});

module.exports = logger;
