const crypto = require('crypto');
const mongoose = require('mongoose');
const { Payment, Order, User, Store, Product, Service, Transaction, AuditLog } = require('../database/models');
const { logger } = require('../utils/logger');
const config = require('../config');
const CommissionService = require('./CommissionService');
const MonitorService = require('./MonitorService');
const auditService = require('./AuditService');

const PAYMENT_TIMEOUT = 30 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function validateAmount(amount, label = 'Amount') {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

function generateCorrelationId() {
  return `corr_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

class PaymentService {
  constructor() {
    this._pendingCleanup = setInterval(() => this._expireStalePayments(), 60000);
  }

  destroy() {
    if (this._pendingCleanup) clearInterval(this._pendingCleanup);
  }

  generatePaymentId() {
    return `PAY-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  }

  generateReferenceCode() {
    return crypto.randomBytes(6).toString('hex').toUpperCase();
  }

  async createPayment(data) {
    validateAmount(data.amount, 'Payment amount');
    const correlationId = data.correlationId || generateCorrelationId();

    const idempotencyKey = data.idempotencyKey || crypto.randomUUID();
    const existing = await Payment.findOne({ idempotencyKey }).lean();
    if (existing) {
      logger.info('Payment idempotency hit', { idempotencyKey, paymentId: existing.paymentId });
      return existing;
    }

    const store = await Store.findById(data.storeId).lean();
    if (!store) throw new Error('Store not found');

    const commissionRate = await CommissionService.getEffectiveCommissionRate(store.type);
    const commission = CommissionService.calculateCommission(data.amount, commissionRate);

    const payment = await Payment.create({
      paymentId: this.generatePaymentId(),
      idempotencyKey,
      correlationId,
      buyerId: data.buyerId,
      sellerId: store.ownerId,
      storeId: data.storeId,
      orderId: data.orderId || null,
      itemType: data.itemType,
      itemId: data.itemId,
      itemName: data.itemName,
      amount: data.amount,
      commissionRate,
      commissionAmount: commission.commissionAmount,
      sellerAmount: commission.sellerAmount,
      platformAmount: commission.platformAmount,
      currency: 'credits',
      paymentMethod: 'probot_credits',
      status: 'pending',
      referenceCode: this.generateReferenceCode(),
      platformAccountId: data.platformAccountId || null,
      expiresAt: new Date(Date.now() + PAYMENT_TIMEOUT),
      auditTrail: [{ action: 'created', by: data.buyerId, at: new Date(), details: `دفعة بقيمة ${data.amount} لـ ${data.itemName}`, correlationId }],
    });

    logger.info('Payment created', { paymentId: payment.paymentId, buyerId: data.buyerId, amount: data.amount, correlationId });
    MonitorService.trackPayment('created');

    await auditService.log('payment_created', data.buyerId, {
      targetId: payment.paymentId,
      targetType: 'payment',
      details: {
        paymentId: payment.paymentId,
        buyerId: data.buyerId,
        sellerId: store.ownerId,
        amount: data.amount,
        commission: payment.commissionAmount,
        netAmount: payment.sellerAmount,
        orderId: data.orderId,
        paymentMethod: 'probot_credits',
        status: payment.status,
        timestamp: new Date(),
        correlationId,
      },
      guildId: data.guildId,
      metadata: { commandName: 'payment_create' },
    });

    return payment;
  }

  async verifyPayment(paymentId, probotTransactionId, userId) {
    if (!probotTransactionId || typeof probotTransactionId !== 'string') {
      throw new Error('Valid transaction ID is required');
    }

    const duplicateCheck = await Payment.findOne({
      probotTransactionId,
      _id: { $ne: await Payment.findOne({ paymentId }).select('_id') },
      status: { $in: ['awaiting_verification', 'confirmed', 'completed'] },
    }).lean();

    if (duplicateCheck) {
      logger.warn('Duplicate transaction ID detected', { transactionId: probotTransactionId, existingPaymentId: duplicateCheck.paymentId });
      await auditService.log('payment_fraud_flagged', 'system', {
        targetId: duplicateCheck.paymentId,
        targetType: 'payment',
        details: { type: 'duplicate_txn', transactionId: probotTransactionId, attemptedPaymentId: paymentId },
      });
      MonitorService.trackFraud('duplicate_txn');
      throw new Error('This transaction ID has already been used');
    }

    const result = await Payment.findOneAndUpdate(
      {
        paymentId,
        status: 'pending',
        verificationAttempts: { $lt: MAX_VERIFICATION_ATTEMPTS },
        expiresAt: { $gt: new Date() },
        $or: [
          { buyerId: userId },
          { buyerId: '__webhook__' },
        ],
      },
      {
        $set: {
          probotTransactionId,
          status: 'awaiting_verification',
        },
        $inc: { verificationAttempts: 1 },
        $push: {
          auditTrail: {
            action: 'verified',
            by: userId,
            at: new Date(),
            details: `تم إدخال معرف المعاملة: ${probotTransactionId}`,
          },
        },
      },
      { new: true }
    );

    if (!result) {
      const payment = await Payment.findOne({ paymentId }).lean();
      if (!payment) throw new Error('Payment not found');
      if (payment.buyerId !== userId && userId !== 'system') throw new Error('Payment ownership mismatch');
      if (payment.status !== 'pending') throw new Error(`Payment already ${payment.status}`);
      if (payment.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        await Payment.updateOne({ paymentId }, {
          $set: { status: 'failed' },
          $push: { auditTrail: { action: 'failed', by: 'system', at: new Date(), details: 'تجاوز عدد محاولات التحقق' } },
        });
        throw new Error('Max verification attempts exceeded');
      }
      if (Date.now() > new Date(payment.expiresAt).getTime()) {
        await Payment.updateOne({ paymentId }, {
          $set: { status: 'expired' },
          $push: { auditTrail: { action: 'expired', by: 'system', at: new Date(), details: 'انتهت صلاحية الدفعة' } },
        });
        throw new Error('Payment has expired');
      }
      throw new Error('Payment cannot be verified at this time');
    }

    if (result.orderId) {
      const order = await Order.findById(result.orderId);
      if (order && order.status !== 'pending') {
        throw new Error('Order is no longer pending');
      }
    }

    MonitorService.trackPayment('verified');

    await auditService.log('payment_verified', userId, {
      targetId: result.paymentId,
      targetType: 'payment',
      details: {
        paymentId: result.paymentId,
        buyerId: result.buyerId,
        sellerId: result.sellerId,
        amount: result.amount,
        commission: result.commissionAmount,
        netAmount: result.sellerAmount,
        orderId: result.orderId,
        probotTransactionId,
        status: result.status,
        timestamp: new Date(),
      },
    });

    return result;
  }

  async confirmPayment(paymentId, staffId) {
    const payment = await Payment.findOneAndUpdate(
      { paymentId, status: { $in: ['awaiting_verification', 'confirmed'] } },
      {
        $set: {
          status: 'confirmed',
          verifiedAt: new Date(),
          verifiedBy: staffId,
        },
        $push: {
          auditTrail: {
            action: 'confirmed',
            by: staffId,
            at: new Date(),
            details: 'تم تأكيد الدفعة من قبل الإدارة',
          },
        },
      },
      { new: true }
    );

    if (!payment) {
      const existing = await Payment.findOne({ paymentId }).lean();
      if (!existing) throw new Error('Payment not found');
      if (existing.status === 'completed') return existing;
      if (existing.status === 'confirmed' && existing.verifiedBy === staffId) return existing;
      throw new Error(`Cannot confirm payment with status: ${existing.status}`);
    }

    const result = await this._completePayment(payment);
    MonitorService.trackPayment('confirmed');

    await auditService.log('payment_confirmed', staffId, {
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
        status: payment.status,
        timestamp: new Date(),
        paymentMethod: payment.paymentMethod,
      },
    });

    return result;
  }

  async autoConfirmPayment(paymentId) {
    const payment = await Payment.findOneAndUpdate(
      {
        paymentId,
        status: { $in: ['pending', 'awaiting_verification', 'confirmed'] },
      },
      {
        $set: {
          status: 'confirmed',
          verifiedAt: new Date(),
          verifiedBy: 'system',
        },
        $push: {
          auditTrail: {
            action: 'confirmed',
            by: 'system',
            at: new Date(),
            details: 'تم التأكيد التلقائي',
          },
        },
      },
      { new: true }
    );

    if (!payment) {
      const existing = await Payment.findOne({ paymentId }).lean();
      if (!existing) throw new Error('Payment not found');
      if (existing.status === 'completed') return existing;
      if (existing.status === 'confirmed' && existing.verifiedBy === 'system') return existing;
      throw new Error(`Cannot auto-confirm payment with status: ${existing.status}`);
    }

    const result = await this._completePayment(payment);
    MonitorService.trackPayment('confirmed');
    return result;
  }

  async _completePayment(payment) {
    const { paymentId, sellerId, sellerAmount, commissionAmount, amount, storeId, orderId, itemType, itemId, itemName, commissionRate, buyerId, _id } = payment;
    if (payment.status === 'completed') {
      logger.info('Payment already completed, skipping', { paymentId });
      return payment;
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });

      const paymentDoc = await Payment.findById(_id).session(session).lean();
      if (!paymentDoc || paymentDoc.status === 'completed') {
        await session.abortTransaction();
        logger.info('Payment already completed in DB, aborting', { paymentId });
        return paymentDoc || payment;
      }

      const now = new Date();

      const [seller] = await Promise.all([
        User.findOneAndUpdate(
          { discordId: sellerId },
          { $inc: { platformEarnings: sellerAmount, totalEarned: sellerAmount, 'stats.totalSales': 1 } },
          { new: true, session }
        ),
        Store.findByIdAndUpdate(
          storeId,
          { $inc: { 'stats.totalSales': 1, 'stats.totalRevenue': amount, 'stats.totalCommission': commissionAmount } },
          { session }
        ),
        orderId
          ? Order.findByIdAndUpdate(orderId, { $set: { status: 'paid', paymentMethod: 'credits', 'paymentDetails.transactionId': paymentId, 'paymentDetails.walletAmount': amount, 'paymentDetails.paidAt': now } }, { session })
          : Promise.resolve(),
        itemType === 'product'
          ? Product.findByIdAndUpdate(itemId, { $inc: { soldCount: 1 } }, { session })
          : Service.findByIdAndUpdate(itemId, { $inc: { soldCount: 1 } }, { session }),
      ]);
      if (!seller) throw new Error('Seller not found');

      const sellerBalanceBefore = (seller.platformEarnings || 0) - sellerAmount;

      await CommissionService.recordCommission({
        paymentId: _id, orderId, storeId, sellerId, storeType: paymentDoc.storeType || 'free',
        itemType, itemName, totalAmount: amount, commissionRate, commissionAmount,
        sellerAmount, platformAmount: commissionAmount, session,
      });

      await Promise.all([
        Transaction.create([{
          userId: sellerId, type: 'sale', status: 'completed', amount: sellerAmount,
          currency: 'credits', balanceBefore: Math.max(0, sellerBalanceBefore),
          balanceAfter: seller.platformEarnings,
          description: `ربح من بيع ${itemName} (بعد خصم العمولة)`,
          reference: { orderId, storeId },
          metadata: { transactionId: paymentId, fee: commissionAmount, netAmount: sellerAmount },
        }], { session }),
        Transaction.create([{
          userId: 'platform', type: 'commission', status: 'completed', amount: commissionAmount,
          currency: 'credits', balanceBefore: 0, balanceAfter: commissionAmount,
          description: `عمولة من بيع ${itemName} (${Math.round(commissionRate * 100)}%)`,
          reference: { orderId, storeId },
          metadata: { transactionId: paymentId, fee: commissionAmount },
        }], { session }),
        Payment.findByIdAndUpdate(_id, {
          $set: { status: 'completed', completedAt: now },
          $push: { auditTrail: { action: 'completed', by: 'system', at: now, details: 'تم إكمال الدفعة وإضافة الرصيد' } },
        }, { session }),
        AuditLog.create([{
          action: 'product_purchase', userId: buyerId, targetId: paymentId, targetType: 'order',
          details: { amount, commission: commissionAmount, sellerAmount, storeId: storeId.toString(), itemName },
        }], { session }),
      ]);

      await session.commitTransaction();

      logger.info('Payment completed', { paymentId, sellerId, amount, commission: commissionAmount, sellerGets: sellerAmount });
      MonitorService.trackPayment('completed');

      await auditService.log('payment_completed', buyerId, {
        targetId: paymentId, targetType: 'payment',
        details: { paymentId, buyerId, sellerId, amount, commission: commissionAmount, netAmount: sellerAmount, orderId, probotTransactionId: payment.probotTransactionId, timestamp: now, status: 'completed', paymentMethod: 'probot_credits' },
      });

      return payment;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Payment completion failed', { paymentId, error: error.message });
      throw error;
    } finally {
      session.endSession();
    }
  }

  async cancelPayment(paymentId, userId, reason) {
    const payment = await Payment.findOneAndUpdate(
      {
        paymentId,
        buyerId: userId,
        status: { $in: ['pending', 'awaiting_verification'] },
      },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: reason || 'ألغاه المستخدم',
        },
        $push: {
          auditTrail: {
            action: 'cancelled',
            by: userId,
            at: new Date(),
            details: reason || 'ألغاه المستخدم',
          },
        },
      },
      { new: true }
    );

    if (!payment) {
      const existing = await Payment.findOne({ paymentId }).lean();
      if (!existing) throw new Error('Payment not found');
      if (existing.buyerId !== userId) throw new Error('Not authorized');
      throw new Error(`Cannot cancel payment with status: ${existing.status}`);
    }

    logger.info('Payment cancelled', { paymentId, userId });
    MonitorService.trackPayment('cancelled');

    await auditService.log('payment_cancelled', userId, {
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
        reason: reason || 'cancelled_by_user',
        status: 'cancelled',
        timestamp: new Date(),
      },
    });

    return payment;
  }

  async _expireStalePayments() {
    try {
      const expired = await Payment.updateMany(
        { status: 'pending', expiresAt: { $lte: new Date() } },
        { $set: { status: 'expired' }, $push: { auditTrail: { action: 'expired', by: 'system', at: new Date(), details: 'انتهت صلاحية الدفعة تلقائياً' } } }
      );
      if (expired.modifiedCount > 0) {
        logger.info(`Expired ${expired.modifiedCount} stale payments`);
      }
    } catch (err) {
      logger.error('Payment expiry cleanup error', { error: err.message });
    }
  }

  async getPayment(paymentId) {
    return Payment.findOne({ paymentId }).lean();
  }

  async getUserPayments(userId, limit = 20) {
    return Payment.find({ buyerId: userId }).sort({ createdAt: -1 }).limit(limit).lean();
  }

  async getSellerPayments(sellerId, limit = 20) {
    return Payment.find({ sellerId }).sort({ createdAt: -1 }).limit(limit).lean();
  }

  async getStorePayments(storeId, limit = 20) {
    return Payment.find({ storeId }).sort({ createdAt: -1 }).limit(limit).lean();
  }

  async getUserPendingPayments(userId) {
    return Payment.find({ buyerId: userId, status: { $in: ['pending', 'awaiting_verification'] } }).lean()
      .sort({ createdAt: -1 })
      .lean();
  }

  async getPaymentStats() {
    const [totalPayments, totalRevenue, totalCommission, statusCounts] = await Promise.all([
      Payment.countDocuments(),
      Payment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Payment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
      ]),
      Payment.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    return {
      total: totalPayments,
      revenue: totalRevenue[0]?.total || 0,
      commissions: totalCommission[0]?.total || 0,
      byStatus: statusCounts.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
    };
  }

  async getPendingVerification() {
    return Payment.find({ status: 'awaiting_verification' }).lean()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
  }
}

module.exports = new PaymentService();
