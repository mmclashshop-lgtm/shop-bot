const Redis = require('ioredis');
const config = require('../config');
const { logger } = require('../utils/logger');

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.defaultTTL = 300;
  }

  async connect() {
    try {
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        retryStrategy: (times) => {
          if (times > 2) {
            return null;
          }
          return Math.min(times * 200, 2000);
        },
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: true,
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis: Connected');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        logger.info('Redis: Ready');
      });

      this.client.on('error', (err) => {
        logger.error('Redis error', { error: err.message });
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        logger.warn('Redis reconnecting...');
      });

      await this.client.connect();
      return this;
    } catch (error) {
      logger.debug('Redis: Not available', { error: error.message });
      this.client = null;
      return this;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis: Disconnected');
    }
  }

  isReady() {
    return this.isConnected && this.client?.status === 'ready';
  }

  async get(key) {
    if (!this.isReady()) return null;
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Cache GET error', { key, error: error.message });
      return null;
    }
  }

  async set(key, value, ttl = this.defaultTTL) {
    if (!this.isReady()) return false;
    try {
      await this.client.setex(key, ttl, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error('Cache SET error', { key, error: error.message });
      return false;
    }
  }

  async del(key) {
    if (!this.isReady()) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error('Cache DEL error', { key, error: error.message });
      return false;
    }
  }

  async delPattern(pattern) {
    if (!this.isReady()) return false;
    try {
      let cursor = '0';
      const keysToDelete = [];
      do {
        const result = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        keysToDelete.push(...result[1]);
      } while (cursor !== '0');

      if (keysToDelete.length > 0) {
        const pipeline = this.client.pipeline();
        for (const key of keysToDelete) {
          pipeline.del(key);
        }
        await pipeline.exec();
      }
      return true;
    } catch (error) {
      logger.error('Cache DEL PATTERN error', { pattern, error: error.message });
      return false;
    }
  }

  async exists(key) {
    if (!this.isReady()) return false;
    try {
      return await this.client.exists(key) === 1;
    } catch (error) {
      logger.error('Cache EXISTS error', { key, error: error.message });
      return false;
    }
  }

  async incr(key, ttl = this.defaultTTL) {
    if (!this.isReady()) return null;
    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, ttl);
      }
      return count;
    } catch (error) {
      logger.error('Cache INCR error', { key, error: error.message });
      return null;
    }
  }

  async expire(key, ttl) {
    if (!this.isReady()) return false;
    try {
      return await this.client.expire(key, ttl) === 1;
    } catch (error) {
      logger.error('Cache EXPIRE error', { key, error: error.message });
      return false;
    }
  }

  async ttl(key) {
    if (!this.isReady()) return -2;
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error('Cache TTL error', { key, error: error.message });
      return -2;
    }
  }

  async hget(key, field) {
    if (!this.isReady()) return null;
    try {
      const value = await this.client.hget(key, field);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Cache HGET error', { key, field, error: error.message });
      return null;
    }
  }

  async hset(key, field, value, ttl = this.defaultTTL) {
    if (!this.isReady()) return false;
    try {
      await this.client.hset(key, field, JSON.stringify(value));
      await this.client.expire(key, ttl);
      return true;
    } catch (error) {
      logger.error('Cache HSET error', { key, field, error: error.message });
      return false;
    }
  }

  async hgetall(key) {
    if (!this.isReady()) return {};
    try {
      const data = await this.client.hgetall(key);
      const result = {};
      for (const [field, value] of Object.entries(data)) {
        try {
          result[field] = JSON.parse(value);
        } catch {
          result[field] = value;
        }
      }
      return result;
    } catch (error) {
      logger.error('Cache HGETALL error', { key, error: error.message });
      return {};
    }
  }

  async hdel(key, ...fields) {
    if (!this.isReady()) return false;
    try {
      await this.client.hdel(key, ...fields);
      return true;
    } catch (error) {
      logger.error('Cache HDEL error', { key, fields, error: error.message });
      return false;
    }
  }

  async sadd(key, ...members) {
    if (!this.isReady()) return 0;
    try {
      return await this.client.sadd(key, ...members);
    } catch (error) {
      logger.error('Cache SADD error', { key, error: error.message });
      return 0;
    }
  }

  async srem(key, ...members) {
    if (!this.isReady()) return 0;
    try {
      return await this.client.srem(key, ...members);
    } catch (error) {
      logger.error('Cache SREM error', { key, error: error.message });
      return 0;
    }
  }

  async smembers(key) {
    if (!this.isReady()) return [];
    try {
      return await this.client.smembers(key);
    } catch (error) {
      logger.error('Cache SMEMBERS error', { key, error: error.message });
      return [];
    }
  }

  async sismember(key, member) {
    if (!this.isReady()) return false;
    try {
      return await this.client.sismember(key, member) === 1;
    } catch (error) {
      logger.error('Cache SISMEMBER error', { key, error: error.message });
      return false;
    }
  }

  async zadd(key, score, member) {
    if (!this.isReady()) return 0;
    try {
      return await this.client.zadd(key, score, member);
    } catch (error) {
      logger.error('Cache ZADD error', { key, error: error.message });
      return 0;
    }
  }

  async zrem(key, member) {
    if (!this.isReady()) return 0;
    try {
      return await this.client.zrem(key, member);
    } catch (error) {
      logger.error('Cache ZREM error', { key, error: error.message });
      return 0;
    }
  }

  async zrange(key, start, stop, withScores = false) {
    if (!this.isReady()) return [];
    try {
      return await this.client.zrange(key, start, stop, withScores ? 'WITHSCORES' : '');
    } catch (error) {
      logger.error('Cache ZRANGE error', { key, error: error.message });
      return [];
    }
  }

  async zrevrange(key, start, stop, withScores = false) {
    if (!this.isReady()) return [];
    try {
      return await this.client.zrevrange(key, start, stop, withScores ? 'WITHSCORES' : '');
    } catch (error) {
      logger.error('Cache ZREVRANGE error', { key, error: error.message });
      return [];
    }
  }

  async keys(pattern) {
    if (!this.isReady()) return [];
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error('Cache KEYS error', { pattern, error: error.message });
      return [];
    }
  }

  async flush() {
    if (!this.isReady()) return false;
    try {
      await this.client.flushdb();
      return true;
    } catch (error) {
      logger.error('Cache FLUSH error', { error: error.message });
      return false;
    }
  }

  generateKey(...parts) {
    return `market-ai:${parts.join(':')}`;
  }

  async getOrSet(key, factory, ttl = this.defaultTTL) {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  async invalidatePattern(pattern) {
    return this.delPattern(this.generateKey(pattern));
  }
}

module.exports = new CacheService();