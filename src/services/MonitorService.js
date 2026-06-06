const os = require('os');
const mongoose = require('mongoose');
const { logger } = require('../utils/logger');
const config = require('../config');

function getAIService() {
  return require('./AIService');
}

function getAlertService() {
  return require('./AlertService');
}

class MonitorService {
  constructor() {
    this.startTime = Date.now();

    this.metrics = {
      commands: new Map(),
      errors: [],
      interactions: { total: 0, byType: { command: 0, modal: 0, button: 0, select: 0, autocomplete: 0 } },
      responseTimes: [],
      ai: { requests: 0, tokens: 0, errors: 0, avgResponseTime: 0 },
      memory: { samples: [] },
      mongo: { ops: 0, errors: 0 },
      payments: { total: 0, created: 0, verified: 0, confirmed: 0, completed: 0, cancelled: 0, failed: 0, expired: 0, autoConfirmed: 0 },
      withdrawals: { total: 0, requested: 0, approved: 0, rejected: 0, completed: 0, cancelled: 0 },
      fraud: { total: 0 },
      fraudBySeverity: { warning: 0, suspicious: 0, high_risk: 0, fraud: 0 },
      fraudByType: {},
    };

    this._sampleInterval = null;
    this._reportInterval = null;
    this.reportCallbacks = [];
  }

  start() {
    this._sampleInterval = setInterval(() => this._sampleMetrics(), 60000);
    this._reportInterval = setInterval(() => this._generateDailyReport(), 3600000);
    logger.info('MonitorService started');
  }

  stop() {
    if (this._sampleInterval) clearInterval(this._sampleInterval);
    if (this._reportInterval) clearInterval(this._reportInterval);
  }

  reset() {
    this.startTime = Date.now();
    this.metrics = {
      commands: new Map(),
      errors: [],
      interactions: { total: 0, byType: { command: 0, modal: 0, button: 0, select: 0, autocomplete: 0 } },
      responseTimes: [],
      ai: { requests: 0, tokens: 0, errors: 0, avgResponseTime: 0 },
      memory: { samples: [] },
      mongo: { ops: 0, errors: 0 },
      payments: { total: 0, created: 0, verified: 0, confirmed: 0, completed: 0, cancelled: 0, failed: 0, expired: 0, autoConfirmed: 0 },
      withdrawals: { total: 0, requested: 0, approved: 0, rejected: 0, completed: 0, cancelled: 0 },
      fraud: { total: 0 },
      fraudBySeverity: { warning: 0, suspicious: 0, high_risk: 0, fraud: 0 },
      fraudByType: {},
    };
  }

  onDailyReport(callback) {
    this.reportCallbacks.push(callback);
  }

  trackCommand(name, userId, duration, success = true) {
    const existing = this.metrics.commands.get(name) || { uses: 0, errors: 0, totalTime: 0, users: new Set() };
    existing.uses++;
    existing.totalTime += duration;
    if (existing.users.size < 10000) existing.users.add(userId);
    if (!success) existing.errors++;
    this.metrics.commands.set(name, existing);
    this.metrics.responseTimes.push({ ts: Date.now(), duration, type: 'command', name });
    if (this.metrics.responseTimes.length > 10000) this.metrics.responseTimes.splice(0, 1000);
  }

  trackInteraction(type) {
    this.metrics.interactions.total++;
    if (this.metrics.interactions.byType[type] !== undefined) this.metrics.interactions.byType[type]++;
  }

  trackError(context, error) {
    this.metrics.errors.push({
      ts: new Date(),
      context: context.substring(0, 200),
      message: (error?.message || String(error)).substring(0, 500),
      name: error?.name || 'Unknown',
    });
    if (this.metrics.errors.length > 1000) this.metrics.errors.splice(0, 100);

    if (this.metrics.errors.length % 10 === 0) {
      getAlertService().checkErrorRate(this.metrics.errors.length);
    }
  }

  trackMongoOp() {
    this.metrics.mongo.ops++;
  }

  trackMongoError(err) {
    this.metrics.mongo.errors++;
    this.trackError('mongodb', err);
  }

  trackAIRequest(duration, tokens) {
    this.metrics.ai.requests++;
    this.metrics.ai.tokens += tokens || 0;
    this.metrics.ai.avgResponseTime = (
      (this.metrics.ai.avgResponseTime * (this.metrics.ai.requests - 1) + duration) / this.metrics.ai.requests
    );
  }

  trackAIError() {
    this.metrics.ai.errors++;
    if (this.metrics.ai.requests >= 5) {
      getAlertService().checkAIFailureRate(this.metrics.ai.requests, this.metrics.ai.errors);
    }
  }

  trackPayment(status) {
    this.metrics.payments.total++;
    if (status === 'created') {
      this.metrics.payments.created++;
    } else {
      this.metrics.payments.created++;
      if (this.metrics.payments[status] !== undefined) this.metrics.payments[status]++;
    }
    const failedCount = (this.metrics.payments.failed || 0) + (this.metrics.payments.cancelled || 0);
    if (this.metrics.payments.total >= 3) {
      getAlertService().checkPaymentFailure(this.metrics.payments.total, failedCount);
    }
  }

  trackAutoConfirm() {
    this.metrics.payments.autoConfirmed++;
  }

  trackWithdrawal(status) {
    this.metrics.withdrawals.total++;
    if (this.metrics.withdrawals[status] !== undefined) this.metrics.withdrawals[status]++;
  }

  trackFraud(type, severity = 'warning') {
    this.metrics.fraud.total++;
    if (this.metrics.fraudBySeverity[severity] !== undefined) this.metrics.fraudBySeverity[severity]++;
    if (!this.metrics.fraudByType[type]) this.metrics.fraudByType[type] = 0;
    this.metrics.fraudByType[type]++;

    try {
      getAlertService().checkFraud({ type, severity, userId: '', riskScore: 0, details: {} });
    } catch (err) { logger.error('Unhandled error in services/MonitorService.js', { error: err?.message }) }
  }

  getPaymentStats() {
    return { ...this.metrics.payments };
  }

  getWithdrawalStats() {
    return { ...this.metrics.withdrawals };
  }

  getFraudStats() {
    return {
      ...this.metrics.fraud,
      bySeverity: { ...this.metrics.fraudBySeverity },
      byType: { ...this.metrics.fraudByType },
      topTypes: this.metrics.fraudTopTypes || [],
      topUsers: this.metrics.fraudTopUsers || [],
    };
  }

  async refreshFraudTopLists() {
    try {
      const FraudAlert = require('../database/models/FraudAlert');
      this.metrics.fraudTopTypes = await FraudAlert.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 }, avgRisk: { $avg: '$riskScore' } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]);
      this.metrics.fraudTopUsers = await FraudAlert.aggregate([
        { $group: { _id: '$userId', alertCount: { $sum: 1 }, maxRisk: { $max: '$riskScore' }, avgRisk: { $avg: '$riskScore' }, unresolved: { $sum: { $cond: ['$resolved', 0, 1] } } } },
        { $sort: { maxRisk: -1 } },
        { $limit: 10 },
      ]);
    } catch (err) { logger.error('Unhandled error in services/MonitorService.js', { error: err?.message }) }
  }

  _sampleMetrics() {
    const mem = process.memoryUsage();
    const cpu = os.cpus();
    const loadAvg = os.loadavg ? os.loadavg() : [0, 0, 0];

    this.metrics.memory.samples.push({
      ts: Date.now(),
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external || 0,
      cpuLoad: loadAvg[0] || 0,
      cpuCores: cpu.length,
    });

    if (this.metrics.memory.samples.length > 1440) this.metrics.memory.samples.splice(0, 60);
  }

  _generateDailyReport() {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const elapsed = Date.now() - this.startTime;

      const topCommands = [...this.metrics.commands.entries()]
        .map(([name, data]) => ({ name, uses: data.uses, errors: data.errors, avgTime: data.uses > 0 ? (data.totalTime / data.uses).toFixed(0) : 0, uniqueUsers: data.users.size }))
        .sort((a, b) => b.uses - a.uses)
        .slice(0, 10);

      const recentErrors = this.metrics.errors.slice(-20);
      const mem = process.memoryUsage();
      const mongoState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
      const aiService = getAIService();
      const aiStats = aiService.getUsageStats ? aiService.getUsageStats() : { totalRequests: 0, totalTokens: 0 };

      const report = {
        generatedAt: now.toISOString(),
        uptime: Math.floor(elapsed / 1000),
        commands: {
          total: this.metrics.commands.size,
          executions: [...this.metrics.commands.values()].reduce((s, c) => s + c.uses, 0),
          errors: [...this.metrics.commands.values()].reduce((s, c) => s + c.errors, 0),
          top: topCommands,
        },
        interactions: this.metrics.interactions,
        ai: {
          requests: aiStats.totalRequests || this.metrics.ai.requests,
          tokens: aiStats.totalTokens || this.metrics.ai.tokens,
          errors: this.metrics.ai.errors,
          avgResponseTime: this.metrics.ai.avgResponseTime.toFixed(0),
        },
        mongo: {
          state: mongoState,
          ops: this.metrics.mongo.ops,
          errors: this.metrics.mongo.errors,
        },
        memory: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        },
        errors: {
          total: this.metrics.errors.length,
          recent: recentErrors.map(e => ({ ts: e.ts, context: e.context, message: e.message })),
        },
        payments: { ...this.metrics.payments },
        withdrawals: { ...this.metrics.withdrawals },
        fraud: { ...this.metrics.fraud, bySeverity: { ...this.metrics.fraudBySeverity }, byType: { ...this.metrics.fraudByType } },
      };

      logger.info('Daily report generated', { date: today, commands: report.commands.executions, errors: report.errors.total, ai: report.ai.requests });

      for (const cb of this.reportCallbacks) {
        try { cb(report); } catch (err) { logger.error('Unhandled error in services/MonitorService.js', { error: err?.message }) }
      }

      return report;
    } catch (error) {
      logger.error('Daily report generation failed', { error: error.message });
      return null;
    }
  }

  getSnapshot() {
    const mem = process.memoryUsage();
    const mongoState = mongoose.connection.readyState;
    const mongoStatus = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const aiService = getAIService();
    const aiStats = aiService.getUsageStats ? aiService.getUsageStats() : {};
    const cpu = os.cpus();
    const loadAvg = os.loadavg ? os.loadavg() : [0, 0, 0];

    const cmdStats = [...this.metrics.commands.entries()]
      .map(([name, data]) => ({ name, uses: data.uses, errors: data.errors, avgTime: data.uses > 0 ? Math.round(data.totalTime / data.uses) : 0, uniqueUsers: data.users.size }))
      .sort((a, b) => b.uses - a.uses);

    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      commands: {
        total: this.metrics.commands.size,
        executions: cmdStats.reduce((s, c) => s + c.uses, 0),
        errors: cmdStats.reduce((s, c) => s + c.errors, 0),
        top: cmdStats.slice(0, 15),
      },
      interactions: {
        total: this.metrics.interactions.total,
        byType: this.metrics.interactions.byType,
      },
      ai: {
        requests: aiStats.totalRequests || this.metrics.ai.requests,
        tokens: aiStats.totalTokens || this.metrics.ai.tokens,
        errors: this.metrics.ai.errors,
        avgResponseTime: this.metrics.ai.avgResponseTime ? `${this.metrics.ai.avgResponseTime.toFixed(0)}ms` : 'N/A',
        cacheSize: aiStats.responseCacheSize || 0,
        rateLimiterSize: aiStats.rateLimiterSize || 0,
        memoryUsers: aiStats.memory?.userCacheSize || 0,
      },
      mongo: {
        state: mongoStatus[mongoState] || 'unknown',
        ops: this.metrics.mongo.ops,
        errors: this.metrics.mongo.errors,
      },
      memory: {
        rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
        external: `${Math.round((mem.external || 0) / 1024 / 1024)} MB`,
        samples: this.metrics.memory.samples.length,
      },
      cpu: {
        cores: cpu.length,
        model: cpu[0]?.model?.trim() || 'unknown',
        load1m: loadAvg[0]?.toFixed(2) || 'N/A',
        load5m: loadAvg[1]?.toFixed(2) || 'N/A',
        load15m: loadAvg[2]?.toFixed(2) || 'N/A',
      },
      errors: {
        total: this.metrics.errors.length,
        recent: this.metrics.errors.slice(-10).map(e => ({ ts: e.ts, context: e.context, message: e.message })),
      },
      os: {
        platform: os.platform(),
        release: os.release(),
        hostname: os.hostname(),
        totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
        freeMemory: `${Math.round(os.freemem() / 1024 / 1024 / 1024)} GB`,
      },
      payments: { ...this.metrics.payments },
      withdrawals: { ...this.metrics.withdrawals },
      fraud: { ...this.metrics.fraud, bySeverity: { ...this.metrics.fraudBySeverity }, byType: { ...this.metrics.fraudByType } },
    };
  }

  getCommandStats(name) {
    const data = this.metrics.commands.get(name);
    if (!data) return null;
    return {
      name,
      uses: data.uses,
      errors: data.errors,
      avgTime: data.uses > 0 ? Math.round(data.totalTime / data.uses) : 0,
      uniqueUsers: data.users.size,
      errorRate: data.uses > 0 ? `${((data.errors / data.uses) * 100).toFixed(1)}%` : '0%',
    };
  }

  getErrorReport(limit = 50) {
    return this.metrics.errors.slice(-limit).map(e => ({
      time: e.ts instanceof Date ? e.ts.toISOString() : e.ts,
      context: e.context,
      message: e.message,
      name: e.name,
    }));
  }

  getPerformanceReport() {
    if (this.metrics.responseTimes.length === 0) return { avg: 0, p50: 0, p95: 0, p99: 0, count: 0 };

    const times = this.metrics.responseTimes.map(r => r.duration).sort((a, b) => a - b);
    const len = times.length;
    return {
      avg: Math.round(times.reduce((s, t) => s + t, 0) / len),
      p50: times[Math.floor(len * 0.5)],
      p95: times[Math.floor(len * 0.95)],
      p99: times[Math.floor(len * 0.99)],
      max: times[len - 1],
      count: len,
    };
  }

  getMemoryTrend() {
    const samples = this.metrics.memory.samples;
    if (samples.length < 2) return { samples: samples.length, trend: 'insufficient_data' };

    const first = samples[0];
    const last = samples[samples.length - 1];
    const growth = last.heapUsed - first.heapUsed;
    return {
      samples: samples.length,
      currentHeap: Math.round(last.heapUsed / 1024 / 1024),
      currentRss: Math.round(last.rss / 1024 / 1024),
      growth24h: `${growth > 0 ? '+' : ''}${Math.round(growth / 1024 / 1024)} MB`,
      trend: growth > 5 * 1024 * 1024 ? 'increasing' : growth < -5 * 1024 * 1024 ? 'decreasing' : 'stable',
      latest: samples.slice(-5).map(s => ({ ts: new Date(s.ts).toISOString(), heap: Math.round(s.heapUsed / 1024 / 1024), rss: Math.round(s.rss / 1024 / 1024) })),
    };
  }
}

module.exports = new MonitorService();
