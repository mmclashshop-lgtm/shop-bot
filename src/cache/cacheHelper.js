const cache = require('./CacheService');
const { logger } = require('../utils/logger');

class CacheHelper {
  static async getOrFetch(key, fetchFn, ttl = 300) {
    if (cache.isReady()) {
      const cached = await cache.get(key);
      if (cached !== null) return cached;
    }

    const data = await fetchFn();

    if (cache.isReady() && data) {
      await cache.set(key, data, ttl).catch(err => {
        logger.warn('Cache set failed', { key, error: err.message });
      });
    }

    return data;
  }

  static generateKey(prefix, ...parts) {
    return `market-ai:${prefix}:${parts.join(':')}`;
  }

  static async invalidate(prefix, ...parts) {
    if (!cache.isReady()) return;
    const key = this.generateKey(prefix, ...parts);
    await cache.del(key).catch(() => {});
  }

  static async invalidatePattern(pattern) {
    if (!cache.isReady()) return;
    await cache.delPattern(`market-ai:${pattern}`).catch(() => {});
  }
}

module.exports = CacheHelper;
