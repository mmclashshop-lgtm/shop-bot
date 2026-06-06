const { logger } = require('../utils/logger');

module.exports = {
  name: 'warn',
  execute(warning, client) {
    logger.warn('Discord client warning', { warning: warning.message });
  },
};