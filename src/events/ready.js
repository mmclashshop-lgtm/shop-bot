const { ActivityType } = require('discord.js');
const { logger } = require('../utils/logger');
const MarketplaceService = require('../services/MarketplaceService');
const AIService = require('../services/AIService');
const cache = require('../cache/CacheService');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.info(`Bot ready: ${client.user.tag}`);
    logger.info(`Serving ${client.guilds.cache.size} guilds`);

    client.user.setPresence({
      activities: [
        { name: 'Market AI', type: ActivityType.Playing },
        { name: '/market | /ai | /ticket | /profile | /admin | /owner', type: ActivityType.Listening },
      ],
      status: 'online',
    });

    try {
      await cache.connect();
      AIService.initialize();
    } catch (err) {
      logger.error('Failed to initialize services', { error: err.message });
    }

    const marketplace = new MarketplaceService(client);
    await marketplace.initialize();
    client.marketplace = marketplace;

    const commands = Array.from(client.commands.commands.values()).map(c => c.data.toJSON());
    logger.info(`Loaded ${commands.length} slash commands`);

    try {
      await client.application.commands.set(commands);
      logger.info('Slash commands registered globally');
    } catch (error) {
      logger.error('Failed to register commands', { error: error.message });
    }
  },
};