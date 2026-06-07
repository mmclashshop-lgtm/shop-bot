const crypto = require('crypto');
const { logger } = require('../utils/logger');
const { FraudAlert, PendingAction, Transaction, User } = require('../database/models');
const MonitorService = require('./MonitorService');
const AuditService = require('./AuditService');
const config = require('../config');

const SCORE_WARNING = 30;
const SCORE_SUSPICIOUS = 60;
const SCORE_HIGH_RISK = 80;
const SCORE_FRAUD = 95;

const FRAUD_TYPES = [
  'double_spend', 'rapid_transfer', 'suspicious_withdrawal',
  'multiple_failed_payments', 'fake_payment_verification',
  'coupon_abuse', 'loyalty_abuse', 'account_farming',
  'bot_activity', 'multi_account', 'suspicious_amount',
];

let fraudLogger;
try {
  const winston = require('winston');
  require('winston-daily-rotate-file');
  fraudLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
    ),
    transports: [
      new winston.transports.DailyRotateFile({
        filename: 'logs/fraud-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '30d',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),
    ],
  });
} catch {
  fraudLogger = { info: () => {}, warn: () => {}, error: () => {} };
}

class FraudDetectionService {
  constructor() {
    this._userCache = new Map();
    this._rateLimitMap = new Map();
    this._cooldownMap = new Map();
    this._cleanupInterval = setInterval(() => this._cleanup(), 300000);
  }

  stop() {
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
    this._userCache.clear();
    this._rateLimitMap.clear();
    this._cooldownMap.clear();
  }

  _cleanup() {
    const cutoff = Date.now() - 3600000;
    for (const [key, val] of this._rateLimitMap) {
      if (val.ts < cutoff) this._rateLimitMap.delete(key);
    }
    for (const [key, val] of this._userCache) {
      if (val.ts < cutoff) this._userCache.delete(key);
    }
    for (const [key, val] of this._cooldownMap) {
      if (val < cutoff) this._cooldownMap.delete(key);
    }
  }

  _getSeverity(score) {
    if (score >= SCORE_FRAUD) return 'fraud';
    if (score >= SCORE_HIGH_RISK) return 'high_risk';
    if (score >= SCORE_SUSPICIOUS) return 'suspicious';
    if (score >= SCORE_WARNING) return 'warning';
    return 'info';
  }

  _riskDecay(score, hoursSinceLastAction) {
    return Math.max(0, Math.min(100, score - Math.floor(hoursSinceLastAction * 5)));
  }

  async _getRecentActivity(userId, type, minutes = 5) {
    const cutoff = new Date(Date.now() - minutes * 60000);
    return PendingAction.countDocuments({
      userId,
      type,
      createdAt: { $gte: cutoff },
    });
  }

  async _getRecentTransactions(userId, minutes = 5) {
    const cutoff = new Date(Date.now() - minutes * 60000);
    return Transaction.countDocuments({
      userId,
      createdAt: { $gte: cutoff },
    });
  }

  async _checkDeduplicate(userId, type, riskScore, windowMinutes = 5) {
    const cutoff = new Date(Date.now() - windowMinutes * 60000);
    const recent = await FraudAlert.findOne({
      userId,
      type,
      createdAt: { $gte: cutoff },
      resolved: false,
    }).sort({ createdAt: -1 }).lean();
    if (recent && recent.riskScore >= riskScore) {
      return true;
    }
    return false;
  }

  async _checkCooldown(userId, type) {
    const key = `${userId}:${type}`;
    const lastTime = this._cooldownMap.get(key);
    if (lastTime && Date.now() - lastTime < 60000) {
      return true;
    }
    this._cooldownMap.set(key, Date.now());
    return false;
  }

  async _getUserRiskProfile(userId) {
    const recentAlerts = await FraudAlert.find({
      userId,
      resolved: false,
      createdAt: { $gte: new Date(Date.now() - 86400000) },
    }).lean();

    if (recentAlerts.length === 0) return { score: 0, alerts: [] };

    const totalScore = recentAlerts.reduce((sum, a) => sum + a.riskScore, 0);
    const avgScore = totalScore / recentAlerts.length;
    const decayed = this._riskDecay(avgScore, recentAlerts.length > 10 ? 24 : 1);
    return { score: Math.min(decayed, 50), alerts: recentAlerts };
  }

  async _createAlert(data) {
    if (await this._checkDeduplicate(data.userId, data.type, data.riskScore)) {
      return null;
    }
    if (await this._checkCooldown(data.userId, data.type)) {
      return null;
    }

    const alertId = `fraud_${crypto.randomBytes(8).toString('hex')}_${Date.now()}`;
    const alert = await FraudAlert.create({
      alertId,
      userId: data.userId,
      guildId: data.guildId || null,
      type: data.type,
      severity: this._getSeverity(data.riskScore),
      riskScore: data.riskScore,
      description: data.description,
      details: data.details || {},
      metadata: data.metadata || {},
    });

    MonitorService.trackFraud(data.type, this._getSeverity(data.riskScore));

    const logLevel = data.riskScore >= SCORE_HIGH_RISK ? 'error' : data.riskScore >= SCORE_SUSPICIOUS ? 'warn' : 'info';
    fraudLogger[logLevel]('Fraud detected', {
      alertId,
      userId: data.userId,
      type: data.type,
      riskScore: data.riskScore,
      severity: alert.severity,
      description: data.description,
      guildId: data.guildId,
    });

    return alert;
  }

  async sendAdminAlert(interaction, alert, client) {
    if (!alert || alert.notifiedAdmins) return;
    try {
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const embed = new EmbedBuilder()
        .setTitle('🚨 تنبيه احتيال')
        .setColor(alert.riskScore >= SCORE_HIGH_RISK ? 0xE74C3C : 0xF39C12)
        .addFields(
          { name: 'النوع', value: alert.type, inline: true },
          { name: 'درجة الخطورة', value: `${alert.riskScore}/100`, inline: true },
          { name: 'المستوى', value: alert.severity, inline: true },
          { name: 'المستخدم', value: `<@${alert.userId}>`, inline: true },
          { name: 'الوصف', value: alert.description, inline: false },
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`fraud_review_${alert.alertId}`)
          .setLabel('🔍 مراجعة')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`fraud_resolve_${alert.alertId}`)
          .setLabel('✅ حل')
          .setStyle(ButtonStyle.Success),
      );

      if (interaction?.guild) {
        const admins = await interaction.guild.members.fetch();
        const adminMembers = admins.filter(m => m.permissions.has('Administrator'));
        for (const admin of adminMembers.values()) {
          try {
            await admin.send({ embeds: [embed], components: [row] }).catch(() => {});
          } catch (err) { logger.error('Unhandled error in services/FraudDetectionService.js', { error: err?.message }) }
        }
      }

      await FraudAlert.updateOne({ alertId: alert.alertId }, { notifiedAdmins: true });
    } catch (err) { logger.error('Unhandled error in services/FraudDetectionService.js', { error: err?.message }) }
  }

  async getAlertById(alertId) {
    return FraudAlert.findOne({ alertId }).lean();
  }

  async resolveAlert(alertId, resolvedBy, resolution, actionTaken) {
    const alert = await FraudAlert.findOne({ alertId }).lean();
    if (!alert) return null;

    alert.resolved = true;
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy;
    alert.resolution = resolution || 'action_taken';
    alert.actionTaken = actionTaken || '';
    await alert.save();

    await AuditService.log('fraud_alert_resolved', resolvedBy, {
      targetId: alertId,
      targetType: 'fraud_alert',
      details: {
        userId: alert.userId,
        type: alert.type,
        riskScore: alert.riskScore,
        resolution,
        actionTaken,
        previousStatus: alert.resolved,
      },
    });

    return alert.toObject();
  }

  async getUserAlerts(userId, limit = 20) {
    return FraudAlert.find({ userId }).sort({ createdAt: -1 }).limit(limit).hint({ userId: 1, createdAt: -1 }).lean();
  }

  async getAllAlerts(filter = {}, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [alerts, total] = await Promise.all([
      FraudAlert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).hint({ createdAt: -1 }).lean(),
      FraudAlert.countDocuments(filter),
    ]);
    return { alerts, total, page, pages: Math.ceil(total / limit) };
  }

  async getTopFraudTypes(limit = 5) {
    return FraudAlert.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 }, avgRisk: { $avg: '$riskScore' } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);
  }

  async getTopRiskUsers(limit = 10) {
    return FraudAlert.aggregate([
      { $group: { _id: '$userId', alertCount: { $sum: 1 }, maxRisk: { $max: '$riskScore' }, avgRisk: { $avg: '$riskScore' }, unresolved: { $sum: { $cond: ['$resolved', 0, 1] } } } },
      { $sort: { maxRisk: -1 } },
      { $limit: limit },
    ]);
  }

  async archiveOldAlerts(daysOld = 90) {
    const cutoff = new Date(Date.now() - daysOld * 86400000);
    const result = await FraudAlert.updateMany(
      { createdAt: { $lt: cutoff } },
      { $set: { 'metadata.archived': true } },
    );
    return result.modifiedCount;
  }

  async checkWalletTransfer(userId, targetUserId, amount, guildId = null) {
    const riskProfile = await this._getUserRiskProfile(userId);
    let riskScore = 0;
    const details = {};
    let description = '';

    const [recentTxns, pendingPays, user] = await Promise.all([
      this._getRecentTransactions(userId, 1),
      PendingAction.find({ userId, type: 'pay', createdAt: { $gte: new Date(Date.now() - 300000) } }).lean(),
      User.findOne({ discordId: userId }).lean(),
    ]);

    if (recentTxns >= 5) {
      riskScore += 25;
      details.rapidTransfer = true;
      description = 'تحويلات سريعة متعددة خلال دقيقة';
    }

    const cappedProfile = Math.min(riskProfile.score, 40);
    if (cappedProfile >= SCORE_WARNING) {
      riskScore += Math.round(cappedProfile * 0.2);
      if (!description) description = 'مخاطر تراكمية من سجل الاحتيال';
    }

    if (amount >= 100000) {
      riskScore += 15;
      details.highAmount = true;
      description = (description ? description + ' | ' : '') + 'مبلغ تحويل كبير';
    }

    const totalPendingAmount = pendingPays.reduce((sum, p) => sum + (p.amount || 0), 0);
    if (user && totalPendingAmount + amount > user.balance) {
      riskScore += 35;
      details.doubleSpendAttempt = true;
      details.totalPendingAmount = totalPendingAmount;
      details.pendingCount = pendingPays.length;
      description = (description ? description + ' | ' : '') + 'محاولة إنفاق مزدوج';
    }

    riskScore = Math.min(100, Math.round(riskScore));
    const isFraud = riskScore >= SCORE_HIGH_RISK;

    let alert = null;
    if (riskScore >= SCORE_WARNING) {
      alert = await this._createAlert({
        userId,
        guildId,
        type: riskScore >= 40 ? 'rapid_transfer' : 'suspicious_amount',
        riskScore,
        description: description || 'تحويل مشبوه',
        details: { ...details, amount, targetUserId },
        metadata: { relatedUserIds: [targetUserId] },
      });
    }

    return { isFraud, riskScore, alert };
  }

  async checkWithdrawal(userId, amount, method, guildId = null) {
    const riskProfile = await this._getUserRiskProfile(userId);
    let riskScore = 0;
    const details = {};

    const recentAlerts = await FraudAlert.countDocuments({
      userId,
      type: 'suspicious_withdrawal',
      createdAt: { $gte: new Date(Date.now() - 86400000) },
    });
    if (recentAlerts >= 2) {
      riskScore += 35;
      details.repeatedWithdrawalAlerts = true;
    }

    const user = await User.findOne({ discordId: userId }).lean();
    if (user) {
      const balance = user.platformEarnings || 0;
      if (amount > balance * 0.9 && balance > 100000) {
        riskScore += 10;
        details.withdrawingMostBalance = true;
      }
      const recentWithdrawals = await Transaction.countDocuments({
        userId,
        type: 'withdraw',
        createdAt: { $gte: new Date(Date.now() - 3600000) },
      });
      if (recentWithdrawals >= 3) {
        riskScore += 25;
        details.rapidWithdrawal = true;
      }
    }

    if (riskProfile.score >= SCORE_WARNING) {
      riskScore += Math.round(Math.min(riskProfile.score, 40) * 0.15);
    }

    if (amount >= 500000) {
      riskScore += 15;
      details.highWithdrawalAmount = true;
    }

    riskScore = Math.min(100, Math.round(riskScore));
    const isFraud = riskScore >= SCORE_HIGH_RISK;

    let alert = null;
    if (riskScore >= SCORE_WARNING) {
      alert = await this._createAlert({
        userId,
        guildId,
        type: 'suspicious_withdrawal',
        riskScore,
        description: 'محاولة سحب مشبوهة',
        details: { ...details, amount, method },
      });
    }

    return { isFraud, riskScore, alert };
  }

  async checkPayment(userId, paymentId, transactionId, guildId = null) {
    let riskScore = 0;
    const details = {};

    const Payment = require('../database/models').Payment;
    const [user, existingPayment, recentVerifications] = await Promise.all([
      User.findOne({ discordId: userId }).lean(),
      Payment.findOne({ probotTransactionId: transactionId }).lean().catch(() => null),
      this._getRecentActivity(userId, 'payment_verify', 10),
    ]);

    if (user) {
      const failedPayments = await Transaction.countDocuments({
        userId,
        type: 'payment',
        status: 'failed',
        createdAt: { $gte: new Date(Date.now() - 86400000) },
      });
      if (failedPayments >= 3) {
        riskScore += 25;
        details.multipleFailedPayments = true;
      }
      if (failedPayments >= 8) {
        riskScore += 20;
        details.excessiveFailedPayments = true;
      }
    }

    if (existingPayment && existingPayment.buyerId !== userId) {
      riskScore += 35;
      details.reusedTransactionId = true;
    }

    if (recentVerifications >= 3) {
      riskScore += 20;
      details.rapidVerificationAttempts = true;
    }

    riskScore = Math.min(100, Math.round(riskScore));
    const isFraud = riskScore >= SCORE_HIGH_RISK;

    let alert = null;
    if (riskScore >= SCORE_WARNING) {
      const type = details.reusedTransactionId ? 'fake_payment_verification' : 'multiple_failed_payments';
      alert = await this._createAlert({
        userId,
        guildId,
        type,
        riskScore,
        description: details.reusedTransactionId
          ? 'محاولة إعادة استخدام معرف معاملة'
          : 'محاولات دفع فاشلة متعددة',
        details: { ...details, paymentId, transactionId },
      });
    }

    return { isFraud, riskScore, alert };
  }

  async checkCouponClaim(userId, couponCode, guildId = null) {
    let riskScore = 0;
    const details = {};

    const recentClaims = await this._getRecentActivity(userId, 'coupon_claim', 5);
    if (recentClaims >= 5) {
      riskScore += 30;
      details.rapidCouponClaims = true;
    }

    const totalCouponsToday = await Transaction.countDocuments({
      userId,
      type: 'coupon',
      createdAt: { $gte: new Date(Date.now() - 86400000) },
    });
    if (totalCouponsToday >= 10) {
      riskScore += 25;
      details.excessiveDailyCoupons = true;
    }

    const user = await User.findOne({ discordId: userId }).lean();
    if (user && user.trustLevel === 'new' && recentClaims >= 3) {
      riskScore += 15;
      details.newUserCouponAbuse = true;
    }

    riskScore = Math.min(100, Math.round(riskScore));
    const isFraud = riskScore >= SCORE_HIGH_RISK;

    let alert = null;
    if (riskScore >= SCORE_WARNING) {
      alert = await this._createAlert({
        userId,
        guildId,
        type: 'coupon_abuse',
        riskScore,
        description: 'استخدام مشبوه للكوبونات',
        details: { ...details, couponCode },
      });
    }

    return { isFraud, riskScore, alert };
  }

  async checkLoyaltyClaim(userId, rewardId, guildId = null) {
    let riskScore = 0;
    const details = {};

    const recentClaims = await this._getRecentActivity(userId, 'loyalty_claim', 5);
    if (recentClaims >= 3) {
      riskScore += 30;
      details.rapidLoyaltyClaims = true;
    }

    const user = await User.findOne({ discordId: userId }).lean();
    if (user) {
      const daysSinceRegistration = user.createdAt
        ? (Date.now() - new Date(user.createdAt).getTime()) / 86400000
        : 0;
      if (daysSinceRegistration < 1 && user.loyaltyPoints > 500) {
        riskScore += 25;
        details.newUserHighPoints = true;
      }
    }

    riskScore = Math.min(100, Math.round(riskScore));
    const isFraud = riskScore >= SCORE_HIGH_RISK;

    let alert = null;
    if (riskScore >= SCORE_WARNING) {
      alert = await this._createAlert({
        userId,
        guildId,
        type: 'loyalty_abuse',
        riskScore,
        description: 'استخدام مشبوه لنقاط الولاء',
        details: { ...details, rewardId },
      });
    }

    return { isFraud, riskScore, alert };
  }

  async checkReview(userId, orderId, guildId = null) {
    let riskScore = 0;
    const details = {};

    const recentReviews = await this._getRecentActivity(userId, 'review', 5);
    if (recentReviews >= 3) {
      riskScore += 25;
      details.rapidReviews = true;
    }

    const user = await User.findOne({ discordId: userId }).lean();
    if (user) {
      const daysSinceRegistration = user.createdAt
        ? (Date.now() - new Date(user.createdAt).getTime()) / 86400000
        : 0;
      if (daysSinceRegistration < 1 && recentReviews >= 3) {
        riskScore += 15;
        details.newUserReviewing = true;
      }
    }

    riskScore = Math.min(100, Math.round(riskScore));
    const isFraud = riskScore >= SCORE_HIGH_RISK;

    let alert = null;
    if (riskScore >= SCORE_WARNING) {
      alert = await this._createAlert({
        userId,
        guildId,
        type: 'bot_activity',
        riskScore,
        description: 'نشاط تقييم مشبوه',
        details: { ...details, orderId },
      });
    }

    return { isFraud, riskScore, alert };
  }

  async checkAccountFarming(userId, guildId = null) {
    let riskScore = 0;
    const details = {};

    const user = await User.findOne({ discordId: userId }).lean();
    if (!user) return { isFraud: false, riskScore: 0, alert: null };

    const daysSinceRegistration = user.createdAt
      ? (Date.now() - new Date(user.createdAt).getTime()) / 86400000
      : 999;

    if (daysSinceRegistration < 7) {
      const activityCount = await Promise.all([
        Transaction.countDocuments({ userId, createdAt: { $gte: new Date(Date.now() - 86400000) } }),
        PendingAction.countDocuments({ userId, createdAt: { $gte: new Date(Date.now() - 86400000) } }),
      ]);
      const totalActivity = activityCount[0] + activityCount[1];

      if (totalActivity > 50 && daysSinceRegistration < 1) {
        riskScore += 40;
        details.extremeNewUserActivity = true;
      } else if (totalActivity > 30 && daysSinceRegistration < 3) {
        riskScore += 20;
        details.highNewUserActivity = true;
      }

      if (user.referrals && user.referrals.length > 10 && daysSinceRegistration < 7) {
        riskScore += 30;
        details.referralFarming = true;
      }
    }

    riskScore = Math.min(100, Math.round(riskScore));
    const isFraud = riskScore >= SCORE_HIGH_RISK;

    let alert = null;
    if (riskScore >= SCORE_WARNING) {
      alert = await this._createAlert({
        userId,
        guildId,
        type: 'account_farming',
        riskScore,
        description: 'نشاط مشبوه يشبه زراعة الحسابات',
        details,
      });
    }

    return { isFraud, riskScore, alert };
  }

  async checkMultiAccount(userId, ipAddress = null, guildId = null) {
    let riskScore = 0;
    const details = {};
    const relatedUserIds = [];

    if (ipAddress) {
      const sameIpUsers = await User.find({ 'metadata.lastIp': ipAddress, discordId: { $ne: userId } }).lean()
        .select('discordId createdAt')
        .lean();
      if (sameIpUsers.length >= 3) {
        riskScore += 30;
        details.multiAccountSameIp = true;
        details.sameIpCount = sameIpUsers.length;
        sameIpUsers.forEach(u => relatedUserIds.push(u.discordId));
      }
    }

    riskScore = Math.min(100, Math.round(riskScore));
    const isFraud = riskScore >= SCORE_HIGH_RISK;

    let alert = null;
    if (riskScore >= SCORE_WARNING) {
      alert = await this._createAlert({
        userId,
        guildId,
        type: 'multi_account',
        riskScore,
        description: 'اشتباه بتعدد حسابات من نفس البيئة',
        details,
        metadata: { ipAddress, relatedUserIds },
      });
    }

    return { isFraud, riskScore, alert };
  }

  async checkBotActivity(userId, action, guildId = null) {
    let riskScore = 0;
    const details = {};

    const recentActions = await this._getRecentActivity(userId, action, 1);
    if (recentActions >= 10) {
      riskScore += 30;
      details.automatedBehavior = true;
    }

    const user = await User.findOne({ discordId: userId }).lean();
    if (user && recentActions >= 5) {
      const daysSinceRegistration = user.createdAt
        ? (Date.now() - new Date(user.createdAt).getTime()) / 86400000
        : 0;
      if (daysSinceRegistration < 1 && recentActions >= 5) {
        riskScore += 20;
        details.newUserAutomatedBehavior = true;
      }
    }

    riskScore = Math.min(100, Math.round(riskScore));
    const isFraud = riskScore >= SCORE_HIGH_RISK;

    let alert = null;
    if (riskScore >= SCORE_WARNING) {
      alert = await this._createAlert({
        userId,
        guildId,
        type: 'bot_activity',
        riskScore,
        description: 'سلوك يشبه البوتات الآلية',
        details: { ...details, action },
      });
    }

    return { isFraud, riskScore, alert };
  }
}

module.exports = new FraudDetectionService();
