const mongoose = require('mongoose');
const os = require('os');
const { EmbedBuilder } = require('discord.js');
const { AlertLog } = require('../database/models');
const { logger } = require('../utils/logger');
const AuditService = require('./AuditService');
const config = require('../config');

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const ALERT_COOLDOWNS = {
  mongodb_down:           { ms: 300000,  priority: 'critical' },
  discord_disconnected:   { ms: 60000,   priority: 'critical' },
  memory_over_80:         { ms: 600000,  priority: 'high' },
  cpu_over_80:            { ms: 600000,  priority: 'high' },
  ai_failure_rate:        { ms: 300000,  priority: 'high' },
  payment_failure:        { ms: 300000,  priority: 'high' },
  withdraw_abuse:         { ms: 600000,  priority: 'high' },
  fraud_detected:         { ms: 300000,  priority: 'critical' },
  spam_attack:            { ms: 300000,  priority: 'high' },
  webhook_abuse:          { ms: 300000,  priority: 'medium' },
  wallet_anomaly:         { ms: 600000,  priority: 'medium' },
  error_rate_spike:       { ms: 300000,  priority: 'medium' },
};

const MEMORY_THRESHOLD = 0.80;
const CPU_THRESHOLD = 0.80;
const AI_FAILURE_RATE_THRESHOLD = 0.10;
const MONGO_CHECK_INTERVAL = 60000;
const DISCORD_CHECK_INTERVAL = 30000;

class AlertService {
  constructor() {
    this.client = null;
    this._monitorInterval = null;
    this._alertCooldowns = new Map();
    this._state = {
      mongoConnected: true,
      discordConnected: true,
      lastMongoCheck: 0,
      lastDiscordCheck: 0,
    };
    this._stats = { totalAlerts: 0, openAlerts: 0, acknowledgedAlerts: 0, resolvedAlerts: 0 };
    this._alertHistory = [];
  }

  setClient(discordClient) {
    this.client = discordClient;
  }

  initialize() {
    this._startMonitoring();
    logger.info('AlertService initialized');
  }

  _startMonitoring() {
    this._monitorInterval = setInterval(() => this._runChecks(), 15000);
    this._runChecks();
  }

  async _runChecks() {
    try {
      await Promise.all([
        this._checkMongoDB(),
        this._checkDiscord(),
        this._checkMemory(),
        this._checkCPU(),
      ]);
    } catch (err) {
      logger.error('Alert monitor run error', { error: err.message });
    }
  }

  async _checkMongoDB() {
    const now = Date.now();
    if (now - this._state.lastMongoCheck < MONGO_CHECK_INTERVAL) return;
    this._state.lastMongoCheck = now;

    let connected = false;
    try {
      connected = mongoose.connection.readyState === 1;
      if (!connected) {
        await mongoose.connection.db?.admin().ping();
        connected = true;
      }
    } catch { connected = false; }

    if (connected && !this._state.mongoConnected) {
      this._state.mongoConnected = true;
      this.resolveAlert('mongodb_down', 'MongoDB connection restored');
    }

    if (!connected && this._state.mongoConnected) {
      this._state.mongoConnected = false;
      await this.fireAlert({
        category: 'mongodb', alertType: 'mongodb_down', priority: 'critical',
        title: '🔴 MongoDB Down',
        message: 'MongoDB connection lost — bot functionality will be degraded',
        value: mongoose.connection.readyState, threshold: 1,
        metadata: { readyState: mongoose.connection.readyState, hosts: mongoose.connection.host },
      });
    }
  }

  _checkDiscord() {
    const now = Date.now();
    if (now - this._state.lastDiscordCheck < DISCORD_CHECK_INTERVAL) return;
    this._state.lastDiscordCheck = now;

    if (!this.client) return;

    const connected = this.client.isReady && this.client.isReady();
    const status = this.client.ws?.status;

    if (connected && !this._state.discordConnected) {
      this._state.discordConnected = true;
      this.resolveAlert('discord_disconnected', 'Discord connection restored');
    }

    if (!connected && this._state.discordConnected) {
      this._state.discordConnected = false;
      this.fireAlert({
        category: 'discord', alertType: 'discord_disconnected', priority: 'critical',
        title: '🔴 Discord Disconnected',
        message: 'Bot disconnected from Discord Gateway — reconnecting',
        value: status, threshold: 0,
        metadata: { wsStatus: status, shards: this.client.ws?.shards?.size },
      });
    }
  }

  async _checkMemory() {
    const mem = process.memoryUsage();
    const heapUsed = mem.heapUsed / mem.heapTotal;
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);

    if (heapUsed > MEMORY_THRESHOLD) {
      await this.fireAlert({
        category: 'memory', alertType: 'memory_over_80', priority: 'high',
        title: '🟠 Memory Usage Critical',
        message: `Heap usage at ${(heapUsed * 100).toFixed(1)}% (${heapMB}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB)`,
        value: Math.round(heapUsed * 100), threshold: 80,
        metadata: { rssMB, heapMB, totalSystemMB: totalMemMB },
      });
    } else {
      await this.resolveAlert('memory_over_80', 'Memory usage normalized');
    }
  }

  async _checkCPU() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg ? os.loadavg() : [0];

    const cpuCount = cpus.length;
    const loadPerCore = loadAvg[0] / cpuCount;

    if (loadPerCore > CPU_THRESHOLD) {
      await this.fireAlert({
        category: 'cpu', alertType: 'cpu_over_80', priority: 'high',
        title: '🟠 CPU Load Critical',
        message: `CPU load at ${(loadPerCore * 100).toFixed(1)}% (1m avg: ${loadAvg[0].toFixed(2)} / ${cpuCount} cores)`,
        value: Math.round(loadPerCore * 100), threshold: 80,
        metadata: { load1m: loadAvg[0], load5m: loadAvg[1], load15m: loadAvg[2], cores: cpuCount },
      });
    } else {
      await this.resolveAlert('cpu_over_80', 'CPU load normalized');
    }
  }

  async checkAIFailureRate(requests, errors) {
    if (requests < 5) return;
    const rate = errors / requests;
    if (rate > AI_FAILURE_RATE_THRESHOLD) {
      await this.fireAlert({
        category: 'ai', alertType: 'ai_failure_rate', priority: 'high',
        title: '🤖 AI Failure Rate Exceeded',
        message: `AI failure rate at ${(rate * 100).toFixed(1)}% (${errors}/${requests} requests failed)`,
        value: Math.round(rate * 100), threshold: AI_FAILURE_RATE_THRESHOLD * 100,
        metadata: { requests, errors, rate },
      });
    } else {
      await this.resolveAlert('ai_failure_rate', 'AI failure rate normalized');
    }
  }

  async checkPaymentFailure(totalPayments, failedPayments) {
    if (totalPayments < 3) return;
    const rate = failedPayments / totalPayments;
    if (rate > 0.30) {
      await this.fireAlert({
        category: 'payment', alertType: 'payment_failure', priority: 'high',
        title: '💳 Payment Failure Rate High',
        message: `${failedPayments}/${totalPayments} payments failed (${(rate * 100).toFixed(1)}%)`,
        value: Math.round(rate * 100), threshold: 30,
        metadata: { total: totalPayments, failed: failedPayments },
      });
    } else {
      await this.resolveAlert('payment_failure', 'Payment failure rate normalized');
    }
  }

  async checkWithdrawalAbuse(withdrawals, timeWindowMs = 60000) {
    if (withdrawals.length < 5) return;
    const recent = withdrawals.filter(w => Date.now() - new Date(w.createdAt).getTime() < timeWindowMs);
    if (recent.length >= 5) {
      const userIds = [...new Set(recent.map(w => w.userId?.toString()))];
      await this.fireAlert({
        category: 'withdrawal', alertType: 'withdraw_abuse', priority: 'high',
        title: '💰 Withdrawal Abuse Detected',
        message: `${recent.length} withdrawals from ${userIds.length} users in ${timeWindowMs / 1000}s`,
        value: recent.length, threshold: 5,
        metadata: { count: recent.length, uniqueUsers: userIds.length, timeWindow: timeWindowMs, userIds },
      });
    }
  }

  async checkFraud(alert) {
    const severityMap = { warning: 'low', suspicious: 'medium', high_risk: 'high', fraud: 'critical' };
    const priority = severityMap[alert.severity] || 'high';

    await this.fireAlert({
      category: 'fraud', alertType: 'fraud_detected', priority,
      title: `🚨 Fraud Detected — ${alert.severity}`,
      message: `Type: ${alert.type} | User: ${alert.userId} | Score: ${alert.riskScore}`,
      value: alert.riskScore, threshold: 0,
      metadata: { type: alert.type, severity: alert.severity, userId: alert.userId, riskScore: alert.riskScore, details: alert.details },
    });
  }

  async checkSpamAttack(count, windowMs = 60000) {
    const SPAM_THRESHOLD = config.security?.spamThreshold || 10;
    if (count >= SPAM_THRESHOLD * 3) {
      await this.fireAlert({
        category: 'spam', alertType: 'spam_attack', priority: 'high',
        title: '🚫 Spam Attack Detected',
        message: `${count} interactions in ${windowMs / 1000}s (threshold: ${SPAM_THRESHOLD})`,
        value: count, threshold: SPAM_THRESHOLD,
        metadata: { count, windowMs, threshold: SPAM_THRESHOLD },
      });
    }
  }

  async checkWebhookAbuse(requests, windowMs = 60000) {
    const WEBHOOK_THRESHOLD = 50;
    if (requests >= WEBHOOK_THRESHOLD) {
      await this.fireAlert({
        category: 'webhook', alertType: 'webhook_abuse', priority: 'medium',
        title: '🌐 Webhook Abuse Detected',
        message: `${requests} webhook requests in ${windowMs / 1000}s (threshold: ${WEBHOOK_THRESHOLD})`,
        value: requests, threshold: WEBHOOK_THRESHOLD,
        metadata: { requests, windowMs },
      });
    }
  }

  async checkWalletAnomaly(anomaly) {
    await this.fireAlert({
      category: 'wallet', alertType: 'wallet_anomaly', priority: 'medium',
      title: '👛 Wallet Anomaly Detected',
      message: anomaly.message || 'Unusual wallet activity detected',
      value: anomaly.score || 0, threshold: anomaly.threshold || 0,
      metadata: anomaly,
    });
  }

  async checkErrorRate(totalErrors, timeWindowMs = 300000) {
    if (totalErrors < 5) return;
    const rate = totalErrors / (timeWindowMs / 1000);
    if (rate > 0.1) {
      await this.fireAlert({
        category: 'error_rate', alertType: 'error_rate_spike', priority: 'medium',
        title: '📈 Error Rate Spike',
        message: `${totalErrors} errors in ${timeWindowMs / 1000}s (${rate.toFixed(2)} errors/sec)`,
        value: Math.round(rate * 100), threshold: 10,
        metadata: { totalErrors, timeWindow: timeWindowMs, rate },
      });
    }
  }

  async fireAlert({ category, alertType, priority, title, message, value, threshold, metadata = {} }) {
    const cooldownKey = alertType;
    const lastFired = this._alertCooldowns.get(cooldownKey);
    const cooldownConfig = ALERT_COOLDOWNS[alertType];
    const cooldownMs = cooldownConfig ? cooldownConfig.ms : 300000;
    const effectivePriority = priority;

    if (lastFired && Date.now() - lastFired < cooldownMs) {
      const existing = await AlertLog.findOne(
        { alertId: { $regex: `^${alertType}_` }, status: { $in: ['open', 'acknowledged'] } },
        null, { sort: { createdAt: -1 } }
      ).lean();
      if (existing) {
        await AlertLog.updateOne(
          { _id: existing._id },
          { $inc: { occurrences: 1 }, $set: { lastOccurrence: new Date() } }
        );
      }
      return;
    }

    this._alertCooldowns.set(cooldownKey, Date.now());
    if (this._alertCooldowns.size > 100) {
      const oldestKey = this._alertCooldowns.keys().next().value;
      this._alertCooldowns.delete(oldestKey);
    }

    const alertId = `${alertType}_${Date.now()}`;

    try {
      await AlertLog.create({
        alertId, category, priority: effectivePriority,
        status: 'open', title, message, value, threshold,
        source: 'system', metadata, lastOccurrence: new Date(),
      });

      this._stats.totalAlerts++;
      this._stats.openAlerts++;

      logger.warn('Alert fired', { alertId, category, priority: effectivePriority, title });

      AuditService.log('alert_fired', 'system', {
        details: { alertId, category, priority: effectivePriority, title, message },
      });

      this._alertHistory.unshift({ alertId, category, priority: effectivePriority, title, message, time: Date.now() });
      if (this._alertHistory.length > 200) this._alertHistory.length = 200;

      await this._notifyAdmin({ alertId, category, priority: effectivePriority, title, message, value, threshold });
    } catch (err) {
      logger.error('Failed to fire alert', { alertId, error: err.message });
    }
  }

  async resolveAlert(alertType, resolution) {
    try {
      const existing = await AlertLog.findOne(
        { alertId: { $regex: `^${alertType}_` }, status: { $in: ['open', 'acknowledged'] } },
        null, { sort: { createdAt: -1 } }).lean()
      ;

      if (existing) {
        existing.status = 'resolved';
        existing.resolvedBy = 'system';
        existing.resolvedAt = new Date();
        await existing.save();

        this._stats.openAlerts--;
        this._stats.resolvedAlerts++;

        logger.info('Alert resolved', { alertType, resolution });
      }
    } catch (err) {
      logger.warn('Failed to resolve alert', { alertType, error: err.message });
    }
  }

  async acknowledgeAlert(alertId, userId) {
    const alert = await AlertLog.findOne({ alertId }).lean();
    if (!alert) throw new Error('Alert not found');
    if (alert.status !== 'open') throw new Error('Alert is not open');

    alert.status = 'acknowledged';
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = new Date();
    await alert.save();

    this._stats.openAlerts--;
    this._stats.acknowledgedAlerts++;

    return alert;
  }

  async _notifyAdmin({ alertId, category, priority, title, message, value, threshold }) {
    if (!this.client || !this.client.isReady || !this.client.isReady()) return;

    const ownerId = config.discord.ownerId;
    if (!ownerId) return;

    try {
      const user = await this.client.users.fetch(ownerId).catch(() => null);
      if (!user) return;

      const colorMap = { critical: 0xE74C3C, high: 0xF39C12, medium: 0x3498DB, low: 0x95A5A6 };

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(colorMap[priority] || 0x95A5A6)
        .setDescription(message)
        .addFields(
          { name: '📂 Category', value: category, inline: true },
          { name: '🏷️ Priority', value: priority.toUpperCase(), inline: true },
        );

      if (value !== undefined && threshold !== undefined) {
        embed.addFields({ name: '📊 Value / Threshold', value: `${value} / ${threshold}`, inline: true });
      }

      embed.setFooter({ text: `ID: ${alertId.substring(0, 24)}...` });
      embed.setTimestamp();

      await user.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      logger.warn('Failed to notify admin of alert', { alertId, error: err.message });
    }
  }

  async getDashboard() {
    const openAlerts = await AlertLog.find({ status: { $in: ['open', 'acknowledged'] } }).lean()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const stats = await this._computeStats();
    const topCategories = await AlertLog.aggregate([
      { $match: { status: { $in: ['open', 'acknowledged'] } } },
      { $group: { _id: '$category', count: { $sum: 1 }, maxPriority: { $min: '$priority' } } },
      { $sort: { count: -1 } },
    ]);

    return { openAlerts, stats, topCategories };
  }

  async getAlertHistory(type = null, limit = 50) {
    const query = type ? { category: type } : {};
    return AlertLog.find(query.lean())
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async getStats() {
    return this._computeStats();
  }

  async _computeStats() {
    const [open, acknowledged, resolved, total, byPriority, byCategory] = await Promise.all([
      AlertLog.countDocuments({ status: 'open' }),
      AlertLog.countDocuments({ status: 'acknowledged' }),
      AlertLog.countDocuments({ status: 'resolved' }),
      AlertLog.countDocuments({}),
      AlertLog.aggregate([
        { $group: { _id: '$priority', count: { $sum: 1 } } },
      ]),
      AlertLog.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 }, lastAlert: { $max: '$createdAt' } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const priorityBreakdown = {};
    for (const p of byPriority) priorityBreakdown[p._id] = p.count;

    const categoryBreakdown = {};
    for (const c of byCategory) categoryBreakdown[c._id] = { count: c.count, lastAlert: c.lastAlert };

    this._stats = { totalAlerts: total, openAlerts: open, acknowledgedAlerts: acknowledged, resolvedAlerts: resolved };

    return {
      total,
      open,
      acknowledged,
      resolved,
      byPriority: priorityBreakdown,
      byCategory: categoryBreakdown,
      uptime: process.uptime(),
    };
  }

  getState() {
    return {
      ...this._state,
      cooldownsActive: this._alertCooldowns.size,
      recentAlerts: this._alertHistory.slice(0, 20),
    };
  }

  stop() {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
    }
    this._alertCooldowns.clear();
    logger.info('AlertService stopped');
  }

  destroy() {
    this.stop();
  }
}

module.exports = new AlertService();
