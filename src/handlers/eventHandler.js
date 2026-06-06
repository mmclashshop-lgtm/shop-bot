const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

class EventHandler {
  constructor(client) {
    this.client = client;
  }

  async loadEvents() {
    const eventsPath = path.join(__dirname, '../events');
    const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

    let loaded = 0;

    for (const file of eventFiles) {
      try {
        const event = require(path.join(eventsPath, file));
        if (event.name && event.execute) {
          if (event.once) {
            this.client.once(event.name, (...args) => event.execute(...args, this.client));
          } else {
            this.client.on(event.name, (...args) => event.execute(...args, this.client));
          }
          loaded++;
        }
      } catch (error) {
        logger.error(`Failed to load event: ${file}`, { error: error.message });
      }
    }

    logger.info(`Events loaded: ${loaded}`);
    return loaded;
  }
}

module.exports = EventHandler;