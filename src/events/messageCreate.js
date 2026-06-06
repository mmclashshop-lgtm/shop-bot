const { logger } = require('../utils/logger');

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(message, client) {
    if (message.author.bot) return;
    if (!message.guild) return;

    if (client.aiChatSessionManager && message.channel.name.startsWith('ai-')) {
      const category = message.channel.parent;
      if (category && category.name === 'AI Chats') {
        try {
          await client.aiChatSessionManager.handleMessage(message);
        } catch (error) {
          logger.error('messageCreate AI handler error', { error: error.message });
        }
      }
    }
  },
};
