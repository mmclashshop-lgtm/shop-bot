const crypto = require('crypto');
const mongoose = require('mongoose');
const { User, Withdrawal, Transaction, MarketplaceSettings, AuditLog } = require('../database/models');
const { logger } = require('../utils/logger');
const config = require('../config');
const MonitorService = require('./MonitorService');
const auditService = require('./AuditService');

const MIN_WITHDRAWAL = 1000;
const MAX_WITHDRAWAL_PENDING = 5;
const WITHDRAWAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function validateAmount(amount, label = 'Amount') {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

function generateCorrelationId() {
  return `corr_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

class BalanceService {
  async getSellerBalance(discordId) {
    const user = await User.findOne({ discordId }).lean();
    if (!user) return 0;
    return user.platformEarnings || 0;
  }

  async getPlatformBalance() {
    const result = await Transaction.aggregate([
      { $match: { type: 'commission', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return result[0]?.total || 0;
  }

  async getTotalSellerEarnings() {
    const result = await User.aggregate([
      { $group: { _id: null, total: { $sum: { $ifNull: ['$platformEarnings', 0] } }, count: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$platformEarnings', 0] }, 0] }, 1, 0] } } } },
    ]);
    return result[0] || { total: 0, count: 0 };
  }

  async getTopSellers(limit = 10) {
    return User.find({ platformEarnings: { $gt: 0 } }).lean()
      .sort({ platformEarnings: -1 })
      .limit(limit)
      .select('discordId username platformEarnings totalEarned stats.totalSales trustLevel')
      .lean();
  }

  async getTopStores(limit = 10) {
    const { Store } = require('../database/models');
    return Store.find({ isActive: true }).lean()
      .sort({ 'stats.totalRevenue': -1 })
      .limit(limit)
      .select('name ownerId type stats.totalRevenue stats.totalSales rating.average')
      .lean();
  }

  async getTopProducts(limit = 10) {
    const { Product } = require('../database/models');
    return Product.find({ isActive: true }).lean()
      .sort({ soldCount: -1 })
      .limit(limit)
      .select('name price soldCount storeId finalPrice')
      .populate('storeId', 'name')
      .lean();
  }

  async requestWithdrawal(discordId, amount, paymentDetails = {}) {
    validateAmount(amount, 'Withdrawal amount');
    const correlationId = generateCorrelationId();

    const user = await User.findOne({ discordId }).lean();
    if (!user) throw new Error('User not found');

    const balance = user.platformEarnings || 0;
    if (balance < amount) throw new Error(`Insufficient balance. Available: ${balance}, Requested: ${amount}`);

    const settings = await MarketplaceSettings.findOne().lean();
    const minWithdraw = settings?.storeCreationFee?.free > 0 ? Math.max(MIN_WITHDRAWAL, settings.storeCreationFee.free) : MIN_WITHDRAWAL;
    if (amount < minWithdraw) throw new Error(`Minimum withdrawal is ${minWithdraw}`);

    if (paymentDetails.idempotencyKey) {
      const existing = await Withdrawal.findOne({ idempotencyKey: paymentDetails.idempotencyKey }).lean();
      if (existing) {
        logger.info('Withdrawal idempotency hit', { idempotencyKey: paymentDetails.idempotencyKey });
        return existing;
      }
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const pendingCount = await Withdrawal.countDocuments({ userId: discordId, status: 'pending' }).session(session);
      if (pendingCount >= MAX_WITHDRAWAL_PENDING) throw new Error('You already have maximum pending withdrawals');

      const lastWithdrawal = await Withdrawal.findOne({ userId: discordId, status: { $in: ['approved', 'completed'] } }).lean()
        .sort({ requestedAt: -1 })
        .session(session)
        .lean();
      if (lastWithdrawal && lastWithdrawal.requestedAt) {
        const elapsed = Date.now() - new Date(lastWithdrawal.requestedAt).getTime();
        if (elapsed < WITHDRAWAL_COOLDOWN_MS) {
          const remaining = Math.ceil((WITHDRAWAL_COOLDOWN_MS - elapsed) / 3600000);
          throw new Error(`You must wait ${remaining}h between withdrawal requests`);
        }
      }

      const updated = await User.findOneAndUpdate(
        { discordId, platformEarnings: { $gte: amount } },
        { $inc: { platformEarnings: -amount } },
        { new: true, session }
      );
      if (!updated) throw new Error('Insufficient balance or user not found');

      const fee = 0;
      const netAmount = amount - fee;
      const balanceBefore = balance;
      const balanceAfter = updated.platformEarnings;

      const withdrawalData = {
        withdrawalId: `WTH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        userId: discordId,
        amount,
        fee,
        netAmount,
        currency: 'credits',
        status: 'pending',
        paymentMethod: paymentDetails.paymentMethod || 'probot_credits',
        paymentDetails: {
          probotUserId: paymentDetails.probotUserId || discordId,
          accountName: paymentDetails.accountName || '',
          accountNumber: paymentDetails.accountNumber || '',
          bankName: paymentDetails.bankName || '',
          cryptoAddress: paymentDetails.cryptoAddress || '',
          notes: paymentDetails.notes || '',
        },
        balanceBefore,
        balanceAfter,
        requestedAt: new Date(),
        correlationId,
        idempotencyKey: paymentDetails.idempotencyKey,
        auditTrail: [{ action: 'requested', by: discordId, at: new Date(), details: `طلب سحب ${amount}`, correlationId }],
      };

      const withdrawal = await Withdrawal.create([withdrawalData], { session });

      await Transaction.create([{
        userId: discordId,
        type: 'withdraw',
        status: 'pending',
        amount: -amount,
        currency: 'credits',
        balanceBefore,
        balanceAfter,
        description: `طلب سحب أرباح: ${amount}`,
        metadata: { transactionId: withdrawal[0].withdrawalId, fee, netAmount, correlationId },
      }], { session });

      await session.commitTransaction();

      logger.info('Withdrawal requested', { withdrawalId: withdrawal[0].withdrawalId, userId: discordId, amount, correlationId });
      MonitorService.trackWithdrawal('requested');

      await auditService.log('withdrawal_requested', discordId, {
        targetId: withdrawal[0].withdrawalId,
        targetType: 'withdrawal',
        details: {
          withdrawalId: withdrawal[0].withdrawalId,
          userId: discordId,
          amount,
          fee: withdrawal[0].fee,
          netAmount: withdrawal[0].netAmount,
          paymentMethod: withdrawal[0].paymentMethod,
          balanceBefore: withdrawal[0].balanceBefore,
          balanceAfter: withdrawal[0].balanceAfter,
          status: 'pending',
          timestamp: new Date(),
          correlationId,
        },
      });

      return withdrawal[0];
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async approveWithdrawal(withdrawalId, staffId) {
    const correlationId = generateCorrelationId();
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const withdrawal = await Withdrawal.findOneAndUpdate(
        { withdrawalId, status: { $in: ['pending', 'approved'] } },
        {
          $set: {
            status: 'approved',
            processedAt: new Date(),
            processedBy: staffId,
          },
          $push: {
            auditTrail: {
              action: 'approved',
              by: staffId,
              at: new Date(),
              details: `تمت الموافقة على سحب ${withdrawal.amount || 0}`,
              correlationId,
            },
          },
        },
        { new: true, session }
      );

      if (!withdrawal) {
        const existing = await Withdrawal.findOne({ withdrawalId }).session(session).lean();
        if (!existing) throw new Error('Withdrawal not found');
        if (existing.status === 'approved' && existing.processedBy === staffId) return existing;
        throw new Error(`Cannot approve withdrawal with status: ${existing.status}`);
      }

      if (withdrawal.status === 'approved') {
        await session.commitTransaction();
        return withdrawal;
      }

      await Transaction.create([{
        userId: withdrawal.userId,
        type: 'withdraw',
        status: 'completed',
        amount: withdrawal.netAmount,
        currency: 'credits',
        balanceBefore: withdrawal.balanceBefore,
        balanceAfter: withdrawal.balanceAfter,
        description: `سحب أرباح: ${withdrawal.amount}`,
        metadata: { transactionId: withdrawal.withdrawalId, fee: withdrawal.fee, netAmount: withdrawal.netAmount, correlationId },
      }], { session });

      await AuditLog.create([{
        action: 'wallet_withdraw',
        userId: withdrawal.userId,
        targetId: withdrawal.withdrawalId,
        targetType: 'order',
        details: { amount: withdrawal.amount, fee: withdrawal.fee, netAmount: withdrawal.netAmount, approvedBy: staffId, correlationId },
      }], { session });

      await session.commitTransaction();

      logger.info('Withdrawal approved', { withdrawalId, staffId, amount: withdrawal.amount, correlationId });
      MonitorService.trackWithdrawal('approved');

      await auditService.log('withdrawal_approved', staffId, {
        targetId: withdrawal.withdrawalId,
        targetType: 'withdrawal',
        details: {
          withdrawalId: withdrawal.withdrawalId,
          userId: withdrawal.userId,
          amount: withdrawal.amount,
          fee: withdrawal.fee,
          netAmount: withdrawal.netAmount,
          staffId,
          balanceBefore: withdrawal.balanceBefore,
          balanceAfter: withdrawal.balanceAfter,
          status: 'approved',
          timestamp: new Date(),
          correlationId,
        },
      });

      return withdrawal;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Withdrawal approval failed', { withdrawalId, error: error.message, correlationId });
      throw error;
    } finally {
      session.endSession();
    }
  }

  async rejectWithdrawal(withdrawalId, staffId, reason) {
    const correlationId = generateCorrelationId();
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const withdrawal = await Withdrawal.findOneAndUpdate(
        { withdrawalId, status: { $in: ['pending', 'approved'] } },
        {
          $set: {
            status: 'rejected',
            processedAt: new Date(),
            processedBy: staffId,
            rejectionReason: reason || 'مرفوض من قبل الإدارة',
          },
          $push: {
            auditTrail: {
              action: 'rejected',
              by: staffId,
              at: new Date(),
              details: reason || 'مرفوض من قبل الإدارة',
              correlationId,
            },
          },
        },
        { new: true, session }
      );

      if (!withdrawal) {
        const existing = await Withdrawal.findOne({ withdrawalId }).session(session).lean();
        if (!existing) throw new Error('Withdrawal not found');
        if (existing.status === 'rejected' && existing.processedBy === staffId) return existing;
        throw new Error(`Cannot reject withdrawal with status: ${existing.status}`);
      }

      if (withdrawal.status === 'rejected') {
        await session.commitTransaction();
        return withdrawal;
      }

      await User.findOneAndUpdate(
        { discordId: withdrawal.userId },
        { $inc: { platformEarnings: withdrawal.amount } },
        { session }
      );

      await Transaction.create([{
        userId: withdrawal.userId,
        type: 'withdraw',
        status: 'reversed',
        amount: withdrawal.amount,
        currency: 'credits',
        balanceBefore: withdrawal.balanceAfter,
        balanceAfter: (withdrawal.balanceAfter || 0) + withdrawal.amount,
        description: `إلغاء سحب: ${withdrawal.withdrawalId}`,
        metadata: { transactionId: withdrawal.withdrawalId, reversedBy: staffId, correlationId },
      }], { session });

      await session.commitTransaction();

      logger.info('Withdrawal rejected', { withdrawalId, staffId, reason, correlationId });
      MonitorService.trackWithdrawal('rejected');

      await auditService.log('withdrawal_rejected', staffId, {
        targetId: withdrawal.withdrawalId,
        targetType: 'withdrawal',
        details: {
          withdrawalId: withdrawal.withdrawalId,
          userId: withdrawal.userId,
          amount: withdrawal.amount,
          staffId,
          reason: reason || 'rejected',
          status: 'rejected',
          timestamp: new Date(),
          correlationId,
        },
      });

      return withdrawal;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Withdrawal rejection failed', { withdrawalId, error: error.message, correlationId });
      throw error;
    } finally {
      session.endSession();
    }
  }

  async completeWithdrawal(withdrawalId, staffId) {
    const correlationId = generateCorrelationId();

    const withdrawal = await Withdrawal.findOneAndUpdate(
      { withdrawalId, status: { $in: ['approved', 'completed'] } },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          processedBy: staffId,
        },
        $push: {
          auditTrail: {
            action: 'completed',
            by: staffId,
            at: new Date(),
            details: 'تم تنفيذ السحب',
            correlationId,
          },
        },
      },
      { new: true }
    );

    if (!withdrawal) {
      const existing = await Withdrawal.findOne({ withdrawalId }).lean();
      if (!existing) throw new Error('Withdrawal not found');
      if (existing.status === 'completed' && existing.processedBy === staffId) return existing;
      throw new Error(`Cannot complete withdrawal with status: ${existing.status}`);
    }

    if (withdrawal.status === 'completed') {
      return withdrawal;
    }

    logger.info('Withdrawal completed', { withdrawalId, staffId, correlationId });
    MonitorService.trackWithdrawal('completed');
    return withdrawal;
  }

  async getWithdrawal(withdrawalId) {
    return Withdrawal.findOne({ withdrawalId }).lean();
  }

  async getUserWithdrawals(userId, limit = 20) {
    return Withdrawal.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
  }

  async getPendingWithdrawals() {
    return Withdrawal.find({ status: 'pending' }).sort({ requestedAt: -1 }).limit(50).lean();
  }

  async getWithdrawalStats() {
    const [total, pending, approved, completed, totalAmount] = await Promise.all([
      Withdrawal.countDocuments(),
      Withdrawal.countDocuments({ status: 'pending' }),
      Withdrawal.countDocuments({ status: 'approved' }),
      Withdrawal.countDocuments({ status: 'completed' }),
      Withdrawal.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);
    return { total, pending, approved, completed, totalPaid: totalAmount[0]?.total || 0 };
  }

  async getMonthlyRevenue(year, month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    const payments = require('../database/models').Payment;
    return payments.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: start, $lte: end } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } }, revenue: { $sum: '$amount' }, commissions: { $sum: '$commissionAmount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
  }
}

module.exports = new BalanceService();
