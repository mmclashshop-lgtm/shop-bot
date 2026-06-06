const { logger } = require('../utils/logger');

class CacheMonitor {
  constructor() {
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0 };
    this._reportInterval = setInterval(() => this._report(), 300000);
  }

  destroy() {
    if (this._reportInterval) clearInterval(this._reportInterval);
  }

  track(method, hit) {
    if (method === 'get') {
      if (hit) this.stats.hits++;
      else this.stats.misses++;
    } else if (method === 'set') {
      this.stats.sets++;
    } else if (method === 'del') {
      this.stats.deletes++;
    } else if (method === 'error') {
      this.stats.errors++;
    }
  }

  hitRate() {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? 1 : this.stats.hits / total;
  }

  snapshot() {
    return { ...this.stats, hitRate: this.hitRate() };
  }

  reset() {
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0 };
  }

  _report() {
    const total = this.stats.hits + this.stats.misses;
    if (total > 0) {
      logger.info('Cache stats', { hits: this.stats.hits, misses: this.stats.misses, hitRate: `${(this.hitRate() * 100).toFixed(1)}%` });
    }
  }
}

function ttlJitter(ttl, jitterPercent = 0.1) {
  const jitter = Math.floor(ttl * jitterPercent * (Math.random() * 2 - 1));
  return Math.max(1, ttl + jitter);
}

module.exports = { CacheMonitor: new CacheMonitor(), ttlJitter };
