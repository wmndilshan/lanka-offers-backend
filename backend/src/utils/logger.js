let logger;

try {
  const { createLogger } = require('../../../lib/logger');
  logger = createLogger('backend');
} catch (error) {
  const noop = () => {};
  logger = {
    debug: noop,
    info: console.log,
    warn: console.warn,
    error: console.error,
    success: console.log,
  };
}

module.exports = logger;
