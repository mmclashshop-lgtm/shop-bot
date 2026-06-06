const { AIChat } = require('\.\./database/models');
const { MarketplaceSettings } = require('\.\./database/models');
const { logger } = require('../utils/logger');

class MemoryService {
  constructor() {
    this.userMemoryCache = new Map();
    this.serverMemoryCache = new Map();
    this.cacheTTL = 1000 * 60 * 30;
    this.maxHistoryAge = 1000 * 60 * 60 * 24 * 30; // 30 days
    this._historyCleanup = setInterval(() => {
      try {
        this._cleanupOldHistory();
        this._cleanupStaleCacheEntries();
      } catch (err) { logger.error('Unhandled error in services/MemoryService.js', { error: err?.message }) }
    }, 3600000);
  }

  _getUserCacheKey(userId, guildId) {
    return `${guildId}:${userId}`;
  }

  _getServerCacheKey(guildId) {
    return `server:${guildId}`;
  }

  _isCacheValid(cached) {
    return cached && (Date.now() - cached.timestamp) < this.cacheTTL;
  }

  async getUserMemory(userId, guildId, limit = 20) {
    const cacheKey = this._getUserCacheKey(userId, guildId);
    const cached = this.userMemoryCache.get(cacheKey);

    if (this._isCacheValid(cached)) {
      return cached.data;
    }

    try {
      const sessions = await AIChat.find({ userId, guildId }).lean()
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();

      const memory = {
        messages: sessions.flatMap(s => s.messages || []).slice(-limit),
        topics: this._extractTopics(sessions),
        preferences: this._extractPreferences(sessions),
        lastActive: sessions[0]?.updatedAt || null,
        totalTokens: sessions.reduce((sum, s) => sum + (s.usage?.totalTokens || 0), 0),
        sessionCount: sessions.length,
      };

      this.userMemoryCache.set(cacheKey, { data: memory, timestamp: Date.now() });
      return memory;
    } catch (error) {
      logger.error('Failed to get user memory', { userId, guildId, error: error.message });
      return { messages: [], topics: [], preferences: {}, lastActive: null, totalTokens: 0, sessionCount: 0 };
    }
  }

  async getServerMemory(guildId) {
    const cacheKey = this._getServerCacheKey(guildId);
    const cached = this.serverMemoryCache.get(cacheKey);

    if (this._isCacheValid(cached)) {
      return cached.data;
    }

    try {
      const sessions = await AIChat.find({ guildId }).lean()
        .sort({ updatedAt: -1 })
        .limit(100)
        .lean();

      const memory = {
        commonTopics: this._extractTopics(sessions),
        faq: this._generateFAQ(sessions),
        rules: await this._getServerRules(guildId),
        totalSessions: sessions.length,
        totalTokens: sessions.reduce((sum, s) => sum + (s.usage?.totalTokens || 0), 0),
      };

      this.serverMemoryCache.set(cacheKey, { data: memory, timestamp: Date.now() });
      return memory;
    } catch (error) {
      logger.error('Failed to get server memory', { guildId, error: error.message });
      return { commonTopics: [], faq: [], rules: '', totalSessions: 0, totalTokens: 0 };
    }
  }

  _extractTopics(sessions) {
    const topicCounts = {};
    for (const session of sessions) {
      const topic = session.type || 'general';
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    }
    return Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count }));
  }

  _extractPreferences(sessions) {
    const prefs = {
      language: 'ar',
      responseLength: 'medium',
      detailLevel: 'balanced',
    };

    for (const session of sessions) {
      if (session.metadata) {
        if (session.metadata.temperature !== undefined) {
          prefs.creativity = session.metadata.temperature > 0.7 ? 'high' : session.metadata.temperature > 0.4 ? 'medium' : 'low';
        }
      }
    }

    return prefs;
  }

  _generateFAQ(sessions) {
    const questionCounts = {};
    for (const session of sessions) {
      for (const msg of session.messages || []) {
        if (msg.role === 'user' && msg.content?.includes('?')) {
          const q = msg.content.trim().slice(0, 200);
          questionCounts[q] = (questionCounts[q] || 0) + 1;
        }
      }
    }

    return Object.entries(questionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([question, count]) => ({ question, count }));
  }

  async _getServerRules(guildId) {
    try {
      const settings = await MarketplaceSettings.findOne({ guildId }).lean();
      return settings?.ai?.systemPrompt || '';
    } catch {
      return '';
    }
  }

  async addUserFact(userId, guildId, fact) {
    const cacheKey = this._getUserCacheKey(userId, guildId);
    const cached = this.userMemoryCache.get(cacheKey);
    if (cached && cached.data) {
      cached.data.facts = cached.data.facts || [];
      cached.data.facts.push({ fact, timestamp: new Date() });
      cached.data.facts = cached.data.facts.slice(-50);
    }
  }

  async addServerFact(guildId, fact) {
    const cacheKey = this._getServerCacheKey(guildId);
    const cached = this.serverMemoryCache.get(cacheKey);
    if (cached && cached.data) {
      cached.data.facts = cached.data.facts || [];
      cached.data.facts.push({ fact, timestamp: new Date() });
      cached.data.facts = cached.data.facts.slice(-50);
    }
  }

  invalidateUserCache(userId, guildId) {
    const cacheKey = this._getUserCacheKey(userId, guildId);
    this.userMemoryCache.delete(cacheKey);
  }

  invalidateServerCache(guildId) {
    const cacheKey = this._getServerCacheKey(guildId);
    this.serverMemoryCache.delete(cacheKey);
  }

  clearAllCaches() {
    this.userMemoryCache.clear();
    this.serverMemoryCache.clear();
  }

  getCacheStats() {
    return {
      userCacheSize: this.userMemoryCache.size,
      serverCacheSize: this.serverMemoryCache.size,
      cacheTTL: this.cacheTTL,
    };
  }

  async _cleanupOldHistory() {
    try {
      const { AIChat } = require('../database/models');
      const cutoffDate = new Date(Date.now() - this.maxHistoryAge);
      const result = await AIChat.deleteMany({ updatedAt: { $lt: cutoffDate } });
      if (result.deletedCount > 0) {
        this.invalidateUserCache('*', '*'); // Invalidate all caches
      }
      return result.deletedCount;
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  _cleanupStaleCacheEntries() {
    const now = Date.now();
    for (const [key, entry] of this.userMemoryCache) {
      if ((now - entry.timestamp) > this.cacheTTL) this.userMemoryCache.delete(key);
    }
    for (const [key, entry] of this.serverMemoryCache) {
      if ((now - entry.timestamp) > this.cacheTTL) this.serverMemoryCache.delete(key);
    }
  }

  destroy() {
    if (this._historyCleanup) {
      clearInterval(this._historyCleanup);
    }
    this.clearAllCaches();
  }
}

module.exports = new MemoryService();
