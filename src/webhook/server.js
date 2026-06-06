const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { logger } = require('../utils/logger');
const MonitorService = require('../services/MonitorService');
const ProBotMonitorService = require('../services/ProBotMonitorService');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const WEBHOOK_RATE_LIMIT = new RateLimiterMemory({
  points: 30,
  duration: 60,
  blockDuration: 120,
});

const REPLAY_WINDOW_MS = 300000;
const ALLOWED_IPS = (config.webhook.allowedIps || '').split(',').map(ip => ip.trim()).filter(Boolean);

class WebhookServer {
  constructor() {
    this.app = express();
    this.server = null;
    this._setupMiddleware();
    this._setupRoutes();
  }

  _setupMiddleware() {
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use((req, res, next) => {
      res.removeHeader('X-Powered-By');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      next();
    });
    this.app.use(this._ipFilter.bind(this));
    this.app.use(this._requestLogger.bind(this));
  }

  _ipFilter(req, res, next) {
    if (ALLOWED_IPS.length > 0) {
      const ip = req.ip || req.connection?.remoteAddress || '';
      const normalizedIp = ip.replace(/^::ffff:/, '');
      if (!ALLOWED_IPS.includes(normalizedIp)) {
        logger.warn('Webhook IP blocked', { ip: normalizedIp, path: req.path });
        return res.status(403).json({ status: 'error', message: 'Forbidden' });
      }
    }
    next();
  }

  _requestLogger(req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.debug('Webhook request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip: req.ip,
      });
    });
    next();
  }

  _constantTimeEqual(a, b) {
    if (!a || !b) return false;
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    try {
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  _validateWebhookSecret(req) {
    const configSecret = config.webhook.secret;
    if (!configSecret) {
      logger.warn('Webhook secret not configured, skipping validation');
      return true;
    }
    const provided = req.headers['x-webhook-secret'];
    if (!provided) return false;
    return this._constantTimeEqual(provided, configSecret);
  }

  _validateReplay(req) {
    const timestamp = req.headers['x-timestamp'];
    const nonce = req.headers['x-nonce'];
    if (!timestamp || !nonce) return false;
    const now = Date.now();
    const ts = parseInt(timestamp, 10);
    if (Number.isNaN(ts)) return false;
    if (Math.abs(now - ts) > REPLAY_WINDOW_MS) return false;
    const hash = crypto.createHash('sha256').update(`${timestamp}:${nonce}:${JSON.stringify(req.body)}`).digest('hex');
    const expected = req.headers['x-signature'];
    if (!expected) return false;
    return this._constantTimeEqual(hash, expected);
  }

  _validateRequestBody(req, requiredFields) {
    const body = req.body || {};
    for (const field of requiredFields) {
      if (!body[field] || typeof body[field] !== 'string') {
        return false;
      }
    }
    return true;
  }

  _setupRoutes() {
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', uptime: Math.floor((Date.now() - MonitorService.startTime) / 1000) });
    });

    this.app.get('/api/metrics', (req, res) => {
      const snapshot = MonitorService.getSnapshot();
      res.json({ status: 'ok', ...snapshot });
    });

    this.app.post('/api/webhook/probot', async (req, res) => {
      try {
        const ip = req.ip || req.connection?.remoteAddress;
        try {
          await WEBHOOK_RATE_LIMIT.consume(ip);
        } catch {
          return res.status(429).json({ status: 'error', message: 'Too many requests' });
        }

        if (!this._validateWebhookSecret(req)) {
          logger.warn('Webhook auth failed', { ip, path: req.path });
          return res.status(401).json({ status: 'error', message: 'Invalid webhook secret' });
        }

        if (!this._validateReplay(req)) {
          logger.warn('Webhook replay validation failed', { ip, path: req.path });
          return res.status(400).json({ status: 'error', message: 'Invalid or expired request signature' });
        }

        if (!this._validateRequestBody(req, ['paymentId', 'transactionId'])) {
          return res.status(400).json({ status: 'error', message: 'paymentId and transactionId are required' });
        }

        const { paymentId, transactionId } = req.body;
        const result = await ProBotMonitorService.autoConfirmByTransaction(paymentId, transactionId);
        res.json({ status: 'ok', ...result });
      } catch (error) {
        logger.warn('Webhook auto-confirm failed', { error: error.message, ip: req.ip });
        res.status(400).json({ status: 'error', message: error.message });
      }
    });

    this.app.post('/api/webhook/probot/verify', async (req, res) => {
      try {
        const ip = req.ip || req.connection?.remoteAddress;
        try {
          await WEBHOOK_RATE_LIMIT.consume(ip);
        } catch {
          return res.status(429).json({ status: 'error', message: 'Too many requests' });
        }

        if (!this._validateWebhookSecret(req)) {
          return res.status(401).json({ status: 'error', message: 'Invalid webhook secret' });
        }

        if (!this._validateReplay(req)) {
          return res.status(400).json({ status: 'error', message: 'Invalid or expired request signature' });
        }

        if (!this._validateRequestBody(req, ['paymentId', 'transactionId'])) {
          return res.status(400).json({ status: 'error', message: 'paymentId and transactionId are required' });
        }

        const { paymentId, transactionId } = req.body;
        const PaymentService = require('../services/PaymentService');
        const payment = await PaymentService.getPayment(paymentId);
        if (!payment) return res.status(404).json({ status: 'error', message: 'Payment not found' });

        const result = await PaymentService.verifyPayment(paymentId, transactionId, 'webhook');

        res.json({
          status: 'ok',
          paymentId,
          transactionId,
          previousStatus: payment.status,
          newStatus: result.status,
          amount: result.amount,
        });
      } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
      }
    });

    this.app.post('/api/webhook/probot/confirm', async (req, res) => {
      try {
        const ip = req.ip || req.connection?.remoteAddress;
        try {
          await WEBHOOK_RATE_LIMIT.consume(ip);
        } catch {
          return res.status(429).json({ status: 'error', message: 'Too many requests' });
        }

        if (!this._validateWebhookSecret(req)) {
          return res.status(401).json({ status: 'error', message: 'Invalid webhook secret' });
        }

        if (!this._validateReplay(req)) {
          return res.status(400).json({ status: 'error', message: 'Invalid or expired request signature' });
        }

        if (!this._validateRequestBody(req, ['paymentId'])) {
          return res.status(400).json({ status: 'error', message: 'paymentId is required' });
        }

        const { paymentId } = req.body;
        const PaymentService = require('../services/PaymentService');
        const result = await PaymentService.autoConfirmPayment(paymentId);

        MonitorService.trackAutoConfirm();
        res.json({ status: 'ok', paymentId, completed: true, amount: result?.amount });
      } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
      }
    });
  }

  async start() {
    const port = config.webhook.port || config.server.port;
    if (port == null) {
      logger.info('Webhook server not started (no port configured)');
      return;
    }

    return new Promise((resolve) => {
      this.server = this.app.listen(port, config.server.host, () => {
        this.port = this.server.address().port;
        logger.info(`Webhook server listening on ${config.server.host}:${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logger.info('Webhook server stopped');
          resolve();
        });
      });
    }
  }
}

module.exports = WebhookServer;
