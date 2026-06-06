const config = require('../config');
const { logger } = require('../utils/logger');
const PaymentService = require('./PaymentService');
const MonitorService = require('./MonitorService');
const auditService = require('./AuditService');

class ProBotMonitorService {
  constructor() {
    this._pollTimer = null;
    this._processing = false;
  }

  start() {
    if (!config.payment.autoConfirm.enabled) {
      logger.info('ProBot auto-confirm is disabled');
      return;
    }

    const interval = config.payment.autoConfirm.pollIntervalMs;
    this._pollTimer = setInterval(() => this._checkPendingPayments(), interval);
    logger.info('ProBotMonitorService started', { pollIntervalMs: interval });
  }

  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _checkPendingPayments() {
    if (this._processing) return;
    this._processing = true;

    try {
      const max = config.payment.autoConfirm.maxPendingPerCycle;
      const pending = await PaymentService.getPendingVerification();

      if (pending.length === 0) { this._processing = false; return; }

      const toProcess = pending.slice(0, max);
      logger.debug('Auto-confirm checking payments', { pending: pending.length, toProcess: toProcess.length });

      for (const payment of toProcess) {
        await this._autoConfirm(payment);
      }
    } catch (error) {
      logger.error('Auto-confirm cycle failed', { error: error.message });
    } finally {
      this._processing = false;
    }
  }

  async _autoConfirm(payment) {
    try {
      const ProBotApiService = require('./ProBotApiService');
      if (ProBotApiService.isAvailable()) {
        if (!payment.probotTransactionId) return;
        const transaction = await ProBotApiService.verifyTransaction(payment.probotTransactionId);
        if (!transaction) {
          logger.warn('Auto-confirm failed: Transaction not found in ProBot API', { paymentId: payment.paymentId, transactionId: payment.probotTransactionId });
          return;
        }
      }

      await PaymentService.autoConfirmPayment(payment.paymentId);

      logger.info('Payment auto-confirmed', {
        paymentId: payment.paymentId,
        buyerId: payment.buyerId,
        sellerId: payment.sellerId,
        amount: payment.amount,
      });

      MonitorService.trackAutoConfirm();
      MonitorService.trackPayment('confirmed');

      auditService.log('payment_auto_confirmed', 'system', {
        targetId: payment.paymentId,
        targetType: 'payment',
        details: {
          paymentId: payment.paymentId,
          buyerId: payment.buyerId,
          sellerId: payment.sellerId,
          amount: payment.amount,
          commission: payment.commissionAmount,
          netAmount: payment.sellerAmount,
          orderId: payment.orderId,
          probotTransactionId: payment.probotTransactionId,
          status: 'confirmed',
          timestamp: new Date(),
          paymentMethod: 'probot_credits',
          autoConfirmed: true,
        },
      });
    } catch (error) {
      logger.warn('Auto-confirm failed for payment', {
        paymentId: payment.paymentId,
        error: error.message,
      });
    }
  }

  async autoConfirmByTransaction(paymentId, transactionId) {
    const payment = await PaymentService.getPayment(paymentId);
    if (!payment) throw new Error('Payment not found');
    if (payment.status === 'completed') return { alreadyCompleted: true, payment };
    if (payment.status === 'confirmed') return { alreadyCompleted: true, payment };

    const ProBotApiService = require('./ProBotApiService');
    if (ProBotApiService.isAvailable()) {
      const transaction = await ProBotApiService.verifyTransaction(transactionId);
      if (!transaction) {
        logger.warn('Webhook auto-confirm failed: Transaction not found in ProBot API', { paymentId, transactionId });
        throw new Error('Transaction not found in ProBot API');
      }
    }

    if (payment.status === 'pending') {
      await PaymentService.verifyPayment(paymentId, transactionId, 'system');
    }

    const result = await PaymentService.autoConfirmPayment(paymentId);

    logger.info('Webhook auto-confirmed payment', {
      paymentId,
      transactionId,
      amount: payment.amount,
    });

    MonitorService.trackAutoConfirm();
    auditService.log('payment_webhook_confirmed', 'system', {
      targetId: paymentId,
      targetType: 'payment',
      details: {
        paymentId,
        transactionId,
        buyerId: payment.buyerId,
        sellerId: payment.sellerId,
        amount: payment.amount,
        status: 'completed',
        timestamp: new Date(),
        source: 'webhook',
      },
    });

    return { success: true, payment: result };
  }

  isRunning() {
    return this._pollTimer !== null;
  }
}

module.exports = new ProBotMonitorService();
