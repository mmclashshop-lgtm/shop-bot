const config = require('../config');
const { Commission, MarketplaceSettings } = require('../database/models');
const { logger } = require('../utils/logger');
const crypto = require('crypto');

class CommissionService {
  getCommissionRate(storeType) {
    return config.commissions[storeType] || 0.10;
  }

  async getEffectiveCommissionRate(storeType) {
    const settings = await MarketplaceSettings.findOne().lean();
    if (settings?.commissions?.[storeType] !== undefined) {
      return settings.commissions[storeType];
    }
    return config.commissions[storeType] || 0.10;
  }

  calculateCommission(amount, rate) {
    const commission = Math.round(amount * rate * 100) / 100;
    const sellerAmount = amount - commission;
    return {
      totalAmount: amount,
      commissionRate: rate,
      commissionAmount: commission,
      sellerAmount,
      platformAmount: commission,
    };
  }

  async recordCommission(data) {
    const commission = await Commission.create([{
      commissionId: `COM-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
      paymentId: data.paymentId,
      orderId: data.orderId || null,
      storeId: data.storeId,
      sellerId: data.sellerId,
      storeType: data.storeType,
      itemType: data.itemType,
      itemName: data.itemName,
      totalAmount: data.totalAmount,
      commissionRate: data.commissionRate,
      commissionAmount: data.commissionAmount,
      sellerAmount: data.sellerAmount,
      platformAmount: data.platformAmount,
      currency: data.currency || 'credits',
      status: 'completed',
      processedAt: new Date(),
    }], { session: data.session });

    logger.info('Commission recorded', {
      commissionId: commission.commissionId,
      storeId: data.storeId,
      amount: data.commissionAmount,
      rate: data.commissionRate,
    });

    return commission;
  }

  async getSellerCommissions(sellerId, limit = 50) {
    return Commission.find({ sellerId, status: 'completed' }).lean()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async getStoreCommissions(storeId, limit = 50) {
    return Commission.find({ storeId, status: 'completed' }).lean()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async getTotalCommissionByStoreType(storeType) {
    const result = await Commission.aggregate([
      { $match: { storeType, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } },
    ]);
    return result[0] || { total: 0, count: 0 };
  }

  async getTotalCommissions() {
    const result = await Commission.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } },
    ]);
    return result[0] || { total: 0, count: 0 };
  }

  async getCommissionBreakdown() {
    return Commission.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$storeType', total: { $sum: '$commissionAmount' }, count: { $sum: 1 }, avgRate: { $avg: '$commissionRate' } } },
      { $sort: { total: -1 } },
    ]);
  }

  async getMonthlyCommissionReport(year, month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    return Commission.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$storeType', total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } },
    ]);
  }

  getCommissionDisplay(amount, storeType) {
    const rate = config.commissions[storeType] || 0.10;
    const commission = Math.round(amount * rate * 100) / 100;
    const sellerGets = amount - commission;
    return { rate, commission, sellerGets, platformGets: commission };
  }

  async getCommissionSummary(startDate) {
    const match = { status: 'completed' };
    if (startDate) match.createdAt = { $gte: startDate };
    const [result] = await Commission.aggregate([
      { $match: match },
      { $group: { _id: null, totalCommission: { $sum: '$commissionAmount' }, storeCount: { $addToSet: '$storeId' }, commissionCount: { $sum: 1 } } },
      { $project: { totalCommission: 1, storeCount: { $size: '$storeCount' }, commissionCount: 1, _id: 0 } },
    ]);
    return result || { totalCommission: 0, storeCount: 0, commissionCount: 0 };
  }
}

module.exports = new CommissionService();
