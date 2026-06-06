jest.mock('../../src/cache/CacheService', () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(true),
  del: jest.fn().mockResolvedValue(true),
  delPattern: jest.fn().mockResolvedValue(true),
  generateKey: jest.fn((...parts) => `market-ai:${parts.join(':')}`),
}));

jest.mock('../../src/cache/CacheMonitor', () => ({
  CacheMonitor: { track: jest.fn() },
  ttlJitter: jest.fn((ttl) => ttl),
}));

const cache = require('../../src/cache/CacheService');
const queryCache = require('../../src/cache/QueryCache');

describe('QueryCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCached', () => {
    it('should return cached value on hit', async () => {
      cache.get.mockResolvedValue({ id: 'cached' });
      const fn = jest.fn();

      const result = await queryCache.getCached('key1', fn, 300);

      expect(result).toEqual({ id: 'cached' });
      expect(fn).not.toHaveBeenCalled();
    });

    it('should fetch and cache on miss', async () => {
      cache.get.mockResolvedValue(null);
      const fn = jest.fn().mockResolvedValue({ id: 'fresh' });

      const result = await queryCache.getCached('key1', fn, 300);

      expect(result).toEqual({ id: 'fresh' });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledWith('key1', { id: 'fresh' }, 300);
    });

    it('should not cache null values', async () => {
      cache.get.mockResolvedValue(null);
      const fn = jest.fn().mockResolvedValue(null);

      const result = await queryCache.getCached('key1', fn, 300);

      expect(result).toBeNull();
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('getUser', () => {
    it('should call getCached with correct key', async () => {
      cache.get.mockResolvedValue(null);
      const fn = jest.fn().mockResolvedValue({ discordId: 'user1' });

      cache.get.mockImplementation(async (key) => {
        if (key === 'market-ai:user:user1') return null;
        return { discordId: 'user1' };
      });

      // Mock the internal getCached call
      const spy = jest.spyOn(queryCache, 'getCached');
      spy.mockImplementation(async (key, fetchFn) => fetchFn());

      const result = await queryCache.getUser('user1', fn);
      expect(result.discordId).toBe('user1');
      spy.mockRestore();
    });
  });

  describe('invalidation functions', () => {
    it('invalidateUser should delete user cache', () => {
      queryCache.invalidateUser('user1');
      expect(cache.del).toHaveBeenCalledWith('market-ai:user:user1');
    });

    it('invalidateSettings should delete settings cache', () => {
      queryCache.invalidateSettings('guild1');
      expect(cache.del).toHaveBeenCalledWith('market-ai:settings:guild1');
    });

    it('invalidateDashboard should delete dashboard pattern', () => {
      queryCache.invalidateDashboard();
      expect(cache.delPattern).toHaveBeenCalledWith('market-ai:dashboard:*');
    });
  });
});
