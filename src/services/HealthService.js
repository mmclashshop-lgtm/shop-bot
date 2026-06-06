const express = require('express');
const mongoose = require('mongoose');
const config = require('../config');
const { logger } = require('../utils/logger');
const CircuitBreaker = require('../utils/CircuitBreaker');
const AIService = require('./AIService');
const MonitorService = require('./MonitorService');

const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch((error) => {
  logger.error('Health route error', { error: error.message });
  res.status(500).json({ status: 'error', message: error.message });
});

class HealthService {
  constructor(client) {
    this.client = client;
    this.app = express();
    this.server = null;
    this.startTime = Date.now();
    this.breakers = new Map();
  }

  registerBreaker(name, breaker) {
    this.breakers.set(name, breaker);
  }

  start() {
    this.app.get('/health/liveness', (req, res) => {
      res.json({ status: 'ok', uptime: Math.floor((Date.now() - this.startTime) / 1000) });
    });

    this.app.get('/health/readiness', asyncHandler(async (req, res) => {
      const checks = await this.runChecks();
      const allOk = checks.every(c => c.status === 'ok');
      res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', checks });
    }));

    this.app.get('/health', asyncHandler(async (req, res) => {
      const checks = await this.runChecks();
      const allOk = checks.every(c => c.status === 'ok');
      res.status(allOk ? 200 : 503).json({
        status: allOk ? 'ok' : 'degraded',
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        checks,
      });
    }));

    this.app.get('/health/circuitbreakers', (req, res) => {
      const states = {};
      for (const [name, breaker] of this.breakers) {
        states[name] = breaker.getState();
      }
      res.json(states);
    });

    this.app.get('/monitor/metrics', (req, res) => {
      const snapshot = MonitorService.getSnapshot();
      res.json(snapshot);
    });

    this.app.get('/monitor/errors', (req, res) => {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const errors = MonitorService.getErrorReport(limit);
      res.json({ count: errors.length, errors });
    });

    this.app.get('/monitor/performance', (req, res) => {
      const perf = MonitorService.getPerformanceReport();
      const mem = MonitorService.getMemoryTrend();
      res.json({ responseTimes: perf, memory: mem });
    });

    this.app.get('/monitor/commands', (req, res) => {
      const snapshot = MonitorService.getSnapshot();
      const cmd = req.query.name ? MonitorService.getCommandStats(req.query.name) : snapshot.commands;
      res.json(cmd || { error: 'Command not found' });
    });

    const port = config.server.port;
    const host = config.server.host;
    this.server = this.app.listen(port, host, () => {
      logger.info(`Health server listening on ${host}:${port}`);
    });
  }

  async runChecks() {
    const checks = [];

    checks.push({
      name: 'mongodb',
      status: mongoose.connection.readyState === 1 ? 'ok' : 'error',
      details: mongoose.connection.readyState === 1
        ? { readyState: 'connected' }
        : { readyState: mongoose.connection.readyState },
    });

    checks.push({
      name: 'discord',
      status: this.client?.isReady() ? 'ok' : 'error',
      details: this.client?.isReady()
        ? { user: this.client.user?.tag, guilds: this.client.guilds.cache.size }
        : { readyState: this.client?.readyAt ? 'connecting' : 'disconnected' },
    });

    checks.push({
      name: 'ai',
      status: AIService.client ? 'ok' : 'error',
      details: {
        model: config.groq.model,
        configured: !!config.groq.apiKey,
        requests: AIService.usageStats?.totalRequests || 0,
      },
    });

    checks.push({
      name: 'memory',
      status: 'ok',
      details: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    });

    checks.push({
      name: 'uptime',
      status: 'ok',
      details: { seconds: Math.floor((Date.now() - this.startTime) / 1000) },
    });

    const breakerStates = {};
    for (const [name, breaker] of this.breakers) {
      breakerStates[name] = breaker.getState();
    }
    checks.push({
      name: 'circuitbreakers',
      status: Object.values(breakerStates).some(b => b.state === 'OPEN') ? 'degraded' : 'ok',
      details: breakerStates,
    });

    return checks;
  }

  stop() {
    if (this.server) {
      this.server.close();
      logger.info('Health server stopped');
    }
  }
}

module.exports = HealthService;
