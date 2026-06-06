const { RateLimiterMemory, RateLimiterRedis } = require('rate-limiter-flexible');
const { MessageFlags } = require('discord.js');
const config = require('../config');
const { logger } = require('../utils/logger');
const { RateLimitError } = require('../utils/errors');
const cache = require('./CacheService');

class RateLimiterService {
  constructor() {
    this.limiters = new Map();
    this.useRedis = false;
    this.globalLimiter = null;
  }

  createLimiter(name, options) {
    const points = options.points || 10;
    const duration = options.duration || 60;
    const blockDuration = options.blockDuration || 300;

    let limiter;

    if (this.useRedis && cache.isReady()) {
      try {
        limiter = new RateLimiterRedis({
          storeClient: cache.client,
          keyPrefix: `rl:${name}:`,
          points,
          duration,
          blockDuration,
        });
      } catch (err) {
        logger.warn('Redis rate limiter failed, falling back to memory', { name, error: err.message });
        this.useRedis = false;
      }
    }

    if (!limiter) {
      limiter = new RateLimiterMemory({
        points,
        duration,
        blockDuration,
      });
    }

    this.limiters.set(name, limiter);
    return limiter;
  }

  getLimiter(name) {
    return this.limiters.get(name);
  }

  async consume(key, points = 1, limiterName = 'default') {
    let limiter = this.limiters.get(limiterName);

    if (!limiter) {
      let configLimit = config.limits.cooldowns[limiterName];
      if (!configLimit) {
        configLimit = config.limits.rateLimits?.[limiterName];
      }
      limiter = this.createLimiter(limiterName, {
        points: configLimit?.points || 10,
        duration: Math.floor((configLimit?.duration || 60000) / 1000),
        blockDuration: configLimit?.blockDuration || 300,
      });
    }

    try {
      await limiter.consume(key, points);
      return true;
    } catch (rejRes) {
      const retryAfter = Math.ceil((rejRes.msBeforeNext || 0) / 1000) || 60;
      throw new RateLimitError(`⏳ تم تجاوز الحد المسموح، حاول بعد ${retryAfter} ثانية`, retryAfter);
    }
  }

  async get(key, limiterName = 'default') {
    const limiter = this.limiters.get(limiterName);
    if (!limiter) return null;
    try {
      return await limiter.get(key);
    } catch {
      return null;
    }
  }

  async reset(key, limiterName = 'default') {
    const limiter = this.limiters.get(limiterName);
    if (!limiter) return;
    try {
      await limiter.delete(key);
    } catch (error) {
      logger.error('RateLimiter: Reset failed', { key, limiterName, error: error.message });
    }
  }

  async resetAll(limiterName = 'default') {
    const limiter = this.limiters.get(limiterName);
    if (!limiter) return;
    try {
      await limiter.deleteAll();
    } catch (error) {
      logger.error('RateLimiter: Reset all failed', { limiterName, error: error.message });
    }
  }

  middleware(limiterName = 'default', keyGenerator = (interaction) => interaction.user.id) {
    return async (interaction, next) => {
      const key = keyGenerator(interaction);
      try {
        await this.consume(key, 1, limiterName);
        return next();
      } catch (error) {
        if (error instanceof RateLimitError) {
          const reply = { content: `⏳ ${error.message}`, flags: MessageFlags.Ephemeral };
          if (interaction.deferred || interaction.replied) {
            return interaction.editReply(reply).catch(() => {});
          }
          return interaction.reply(reply).catch(() => {});
        }
        throw error;
      }
    };
  }

  initRedis() {
    if (cache.isReady()) {
      this.useRedis = true;
      logger.info('RateLimiter: Using Redis backend');
    } else {
      this.useRedis = false;
      logger.info('RateLimiter: Using Memory backend (Redis unavailable)');
    }
  }

  getStats(limiterName = 'default') {
    const limiter = this.limiters.get(limiterName);
    if (!limiter) return null;
    return {
      backend: this.useRedis ? 'redis' : 'memory',
      points: limiter.points,
      duration: limiter.duration,
    };
  }
}

module.exports = new RateLimiterService();
