const { logger } = require('../utils/logger');

const INVALIDATION_RULES = {
  // When model is written → invalidate related cache keys
  User: {
    writePatterns: [
      { on: ['save', 'findOneAndUpdate', 'updateOne'], invalidate: (doc) => [`user:${doc?.discordId}`, 'user:top:*', 'users:*'] },
    ],
  },
  Store: {
    writePatterns: [
      { on: ['save', 'findOneAndUpdate', 'updateOne'], invalidate: (doc) => [`store:${doc?._id}`, 'store:owner:*', 'marketplace:*'] },
    ],
  },
  Product: {
    writePatterns: [
      { on: ['save', 'findOneAndUpdate', 'updateOne'], invalidate: (doc) => [`product:${doc?._id}`, 'product:store:*', 'marketplace:*'] },
    ],
  },
  Service: {
    writePatterns: [
      { on: ['save', 'findOneAndUpdate', 'updateOne'], invalidate: (doc) => [`service:${doc?._id}`, 'service:store:*', 'marketplace:*'] },
    ],
  },
  Order: {
    writePatterns: [
      { on: ['save', 'findOneAndUpdate', 'updateOne'], invalidate: (doc) => [`order:${doc?._id}`, 'order:user:*', 'dashboard:*'] },
    ],
  },
  Payment: {
    writePatterns: [
      { on: ['save', 'findOneAndUpdate', 'updateOne'], invalidate: (doc) => [`payment:${doc?.paymentId}`, 'payment:user:*', 'dashboard:*'] },
    ],
  },
  MarketplaceSettings: {
    writePatterns: [
      { on: ['save', 'findOneAndUpdate', 'updateOne'], invalidate: () => ['settings:marketplace:*', 'marketplace:*'] },
    ],
  },
};

class CacheInvalidator {
  constructor(cacheService) {
    this.cache = cacheService;
    this._pending = new Map();
    this._flushInterval = setInterval(() => this.flush(), 1000);
  }

  destroy() {
    if (this._flushInterval) clearInterval(this._flushInterval);
    this._pending.clear();
  }

  onWrite(modelName, operation, doc) {
    const rules = INVALIDATION_RULES[modelName];
    if (!rules) return;

    for (const pattern of rules.writePatterns) {
      if (!pattern.on.includes(operation)) continue;
      const keys = pattern.invalidate(doc || {});
      for (const key of keys) {
        if (key.endsWith('*')) {
          this._pending.set(key, { pattern: key, type: 'pattern' });
        } else {
          this._pending.set(key, { key: `market-ai:${key}`, type: 'exact' });
        }
      }
    }
  }

  async flush() {
    if (this._pending.size === 0) return;

    const batch = new Map(this._pending);
    this._pending.clear();

    for (const [, entry] of batch) {
      try {
        if (entry.type === 'pattern') {
          await this.cache.delPattern(entry.pattern);
        } else {
          await this.cache.del(entry.key);
        }
      } catch (err) {
        logger.warn('Cache invalidation failed', { key: entry.key || entry.pattern, error: err.message });
      }
    }
  }

  pendingCount() {
    return this._pending.size;
  }
}

module.exports = { CacheInvalidator, INVALIDATION_RULES };
