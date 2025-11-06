const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
});

if (process.env.NODE_ENV === 'test' || process.env.LOG_LEVEL === 'silent') {
  logger.level = 'silent';
}

module.exports = logger;
