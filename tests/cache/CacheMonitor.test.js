const { CacheMonitor, ttlJitter } = require('../../src/cache/CacheMonitor');

describe('CacheMonitor', () => {
  beforeEach(() => {
    CacheMonitor.reset();
  });

  afterAll(() => {
    CacheMonitor.destroy();
  });

  describe('track', () => {
    it('should count hits', () => {
      CacheMonitor.track('get', true);
      const s = CacheMonitor.snapshot();
      expect(s.hits).toBe(1);
      expect(s.misses).toBe(0);
    });

    it('should count misses', () => {
      CacheMonitor.track('get', false);
      const s = CacheMonitor.snapshot();
      expect(s.hits).toBe(0);
      expect(s.misses).toBe(1);
    });

    it('should count sets and deletes', () => {
      CacheMonitor.track('set');
      CacheMonitor.track('del');
      const s = CacheMonitor.snapshot();
      expect(s.sets).toBe(1);
      expect(s.deletes).toBe(1);
    });

    it('should count errors', () => {
      CacheMonitor.track('error');
      const s = CacheMonitor.snapshot();
      expect(s.errors).toBe(1);
    });
  });

  describe('hitRate', () => {
    it('should return 1 when no requests', () => {
      expect(CacheMonitor.hitRate()).toBe(1);
    });

    it('should calculate correct rate', () => {
      CacheMonitor.track('get', true);
      CacheMonitor.track('get', true);
      CacheMonitor.track('get', false);
      expect(CacheMonitor.hitRate()).toBeCloseTo(0.667, 2);
    });

    it('should return 0 for all misses', () => {
      CacheMonitor.track('get', false);
      expect(CacheMonitor.hitRate()).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all stats', () => {
      CacheMonitor.track('get', true);
      CacheMonitor.track('set');
      CacheMonitor.reset();
      const s = CacheMonitor.snapshot();
      expect(s.hits).toBe(0);
      expect(s.sets).toBe(0);
    });
  });
});

describe('ttlJitter', () => {
  it('should return a number close to the original TTL', () => {
    for (let i = 0; i < 100; i++) {
      const result = ttlJitter(300, 0.1);
      expect(result).toBeGreaterThanOrEqual(270);
      expect(result).toBeLessThanOrEqual(330);
    }
  });

  it('should never return less than 1', () => {
    const result = ttlJitter(1, 0.5);
    expect(result).toBeGreaterThanOrEqual(1);
  });
});
