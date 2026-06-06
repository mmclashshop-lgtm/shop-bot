const { logger } = require('../utils/logger');

module.exports = {
  name: 'error',
  execute(error, client) {
    logger.error('Discord client error', { error: error.message, stack: error.stack });
  },
};