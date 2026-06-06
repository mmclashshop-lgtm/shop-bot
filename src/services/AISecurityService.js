/**
 * AI Abuse Detection Service
 *
 * Detects and mitigates abuse of the AI Chat system:
 *   - Spam requests (rate limiting per user)
 *   - Prompt abuse (known malicious patterns)
 *   - Automated usage (bot-like behavior)
 *   - Excessive token consumption
 *   - Repetitive content loops
 */

const { FraudAlert } = require('../database/models');
const MonitorService = require('./MonitorService');
const { logger } = require('../utils/logger');

const SPAM_PATTERNS = [
  /ignore all previous instructions/i,
  /you are now (?!.*bot)/i,
  /ignore everything/i,
  /repeat (after |back |this |that )/i,
  /jailbreak/i,
  /system prompt/i,
  /developer mode/i,
  /do anything now/i,
  /dan mode/i,
  /no restrictions/i,
];

const SPAM_THRESHOLDS = {
  requestsPerMinute: 10,
  tokensPerHour: 100000,
  consecutiveSimilar: 5,
  maxSessionLength: 100,
};

class AISecurityService {
  constructor() {
    this._userRequestCount = new Map();
    this._userTokenCount = new Map();
    this._userSessionMessages = new Map();
    this._userLastMessages = new Map();
    this._blockedUsers = new Set();
    this._cleanupInterval = setInterval(() => this._cleanup(), 300000);
  }

  stop() {
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
    this._userRequestCount.clear();
    this._userTokenCount.clear();
    this._userSessionMessages.clear();
    this._userLastMessages.clear();
    this._blockedUsers.clear();
  }

  _cleanup() {
    const cutoff = Date.now() - 3600000;
    for (const [key, val] of this._userRequestCount) {
      if (val.ts < cutoff) this._userRequestCount.delete(key);
    }
    for (const [key, val] of this._userTokenCount) {
      if (val.ts < cutoff) this._userTokenCount.delete(key);
    }
  }

  isBlocked(userId) {
    return this._blockedUsers.has(userId);
  }

  async checkRequest(userId, message, tokenCount = 0) {
    const now = Date.now();
    const minuteAgo = now - 60000;
    const hourAgo = now - 3600000;

    // Rate limit check
    const reqCount = this._userRequestCount.get(userId) || { count: 0, ts: now };
    if (reqCount.ts < minuteAgo) {
      reqCount.count = 0;
      reqCount.ts = now;
    }
    reqCount.count++;
    this._userRequestCount.set(userId, reqCount);

    if (reqCount.count > SPAM_THRESHOLDS.requestsPerMinute) {
      this._blockedUsers.add(userId);
      await this._createAbuseAlert(userId, 'spam_requests', 60,
        `تجاوز حد الطلبات: ${reqCount.count}/دقيقة`);
      return { blocked: true, reason: 'rate_limit', riskScore: 60 };
    }

    // Token consumption
    const tokenData = this._userTokenCount.get(userId) || { total: 0, ts: now };
    if (tokenData.ts < hourAgo) {
      tokenData.total = 0;
      tokenData.ts = now;
    }
    tokenData.total += tokenCount;
    this._userTokenCount.set(userId, tokenData);

    if (tokenData.total > SPAM_THRESHOLDS.tokensPerHour) {
      this._blockedUsers.add(userId);
      await this._createAbuseAlert(userId, 'excessive_tokens', 70,
        `تجاوز حد التوكنز: ${tokenData.total}/ساعة`);
      return { blocked: true, reason: 'token_limit', riskScore: 70 };
    }

    // Prompt abuse pattern check
    for (const pattern of SPAM_PATTERNS) {
      if (pattern.test(message)) {
        const riskScore = 75;
        this._blockedUsers.add(userId);
        await this._createAbuseAlert(userId, 'prompt_abuse', riskScore,
          `محاولة اختراق: ${pattern.source.substring(0, 40)}`);
        return { blocked: true, reason: 'prompt_abuse', riskScore };
      }
    }

    // Repetitive content detection
    const lastMessages = this._userLastMessages.get(userId) || [];
    lastMessages.push(message);
    if (lastMessages.length > 10) lastMessages.shift();
    this._userLastMessages.set(userId, lastMessages);

    if (lastMessages.length >= SPAM_THRESHOLDS.consecutiveSimilar) {
      const recent = lastMessages.slice(-SPAM_THRESHOLDS.consecutiveSimilar);
      const unique = new Set(recent.map(m => m.toLowerCase().trim()));
      if (unique.size <= 2) {
        this._blockedUsers.add(userId);
        await this._createAbuseAlert(userId, 'repetitive_content', 50,
          `تكرار نفس المحتوى ${SPAM_THRESHOLDS.consecutiveSimilar} مرة`);
        return { blocked: true, reason: 'repetitive', riskScore: 50 };
      }
    }

    // Session length check
    const sessionMessages = this._userSessionMessages.get(userId) || 0;
    this._userSessionMessages.set(userId, sessionMessages + 1);
    if (sessionMessages + 1 > SPAM_THRESHOLDS.maxSessionLength) {
      await this._createAbuseAlert(userId, 'excessive_session', 40,
        `جلسة طويلة: ${sessionMessages + 1} رسالة`);
      return { blocked: true, reason: 'session_limit', riskScore: 40 };
    }

    return { blocked: false, reason: null, riskScore: 0 };
  }

  async _createAbuseAlert(userId, type, riskScore, description) {
    try {
      const crypto = require('crypto');
      const alert = await FraudAlert.create({
        alertId: `fraud_ai_${crypto.randomBytes(6).toString('hex')}_${Date.now()}`,
        userId,
        type: 'bot_activity',
        severity: riskScore >= 60 ? 'high_risk' : riskScore >= 40 ? 'suspicious' : 'warning',
        riskScore: Math.min(riskScore, 100),
        description,
        details: { aiAbuseType: type },
      });
      MonitorService.trackFraud('bot_activity', alert.severity);
      return alert;
    } catch (err) { logger.error('Unhandled error in services/AISecurityService.js', { error: err?.message }) }
  }

  unblockUser(userId) {
    this._blockedUsers.delete(userId);
    this._userRequestCount.delete(userId);
    this._userTokenCount.delete(userId);
    this._userSessionMessages.delete(userId);
    this._userLastMessages.delete(userId);
  }

  getStats() {
    return {
      blockedUsers: this._blockedUsers.size,
      activeMonitors: {
        requestCount: this._userRequestCount.size,
        tokenCount: this._userTokenCount.size,
        sessionMessages: this._userSessionMessages.size,
      },
    };
  }
}

module.exports = new AISecurityService();
