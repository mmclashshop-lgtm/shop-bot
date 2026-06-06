const { CacheInvalidator, INVALIDATION_RULES } = require('../../src/cache/CacheInvalidator');

jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

const mockCacheService = {
  del: jest.fn().mockResolvedValue(true),
  delPattern: jest.fn().mockResolvedValue(true),
};

describe('CacheInvalidator', () => {
  let invalidator;

  beforeEach(() => {
    jest.clearAllMocks();
    invalidator = new CacheInvalidator(mockCacheService);
  });

  afterEach(() => {
    invalidator.destroy();
  });

  describe('INVALIDATION_RULES', () => {
    it('should have rules for core models', () => {
      expect(INVALIDATION_RULES.User).toBeDefined();
      expect(INVALIDATION_RULES.Store).toBeDefined();
      expect(INVALIDATION_RULES.Product).toBeDefined();
      expect(INVALIDATION_RULES.Order).toBeDefined();
      expect(INVALIDATION_RULES.Payment).toBeDefined();
    });
  });

  describe('onWrite', () => {
    it('should queue invalidation for User writes', () => {
      invalidator.onWrite('User', 'save', { discordId: 'user1' });
      expect(invalidator.pendingCount()).toBeGreaterThan(0);
    });

    it('should queue marketplace invalidation for Store writes', () => {
      invalidator.onWrite('Store', 'save', { _id: 'store1' });
      expect(invalidator.pendingCount()).toBeGreaterThan(0);
    });

    it('should ignore unknown models', () => {
      invalidator.onWrite('UnknownModel', 'save', {});
      expect(invalidator.pendingCount()).toBe(0);
    });

    it('should ignore unlisted operations', () => {
      invalidator.onWrite('User', 'deleteOne', {});
      expect(invalidator.pendingCount()).toBe(0);
    });
  });

  describe('flush', () => {
    it('should call cache.del for exact keys', async () => {
      invalidator.onWrite('User', 'save', { discordId: 'user1' });
      await invalidator.flush();

      expect(mockCacheService.del).toHaveBeenCalled();
      expect(mockCacheService.delPattern).toHaveBeenCalled();
    });

    it('should call cache.delPattern for wildcard keys', async () => {
      invalidator.onWrite('Store', 'save', { _id: 'store1' });
      await invalidator.flush();

      expect(mockCacheService.delPattern).toHaveBeenCalled();
    });
  });
});
