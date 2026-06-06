const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  version: { type: Number, default: 1 },

  ai: {
    enabled: { type: Boolean, default: true },
    model: { type: String, default: 'qwen/qwen3-32b' },
    maxTokens: { type: Number, default: 2000, min: 100, max: 32000 },
    temperature: { type: Number, default: 0.7, min: 0, max: 2 },
    systemPrompt: { type: String, default: '' },
    dailyUserLimit: { type: Number, default: 100, min: 1 },
    dailyGuildLimit: { type: Number, default: 500, min: 1 },
    cooldownMs: { type: Number, default: 2000, min: 500 },
    rateLimitWarnings: { type: Boolean, default: true },
  },

  marketplace: {
    channelId: { type: String, default: null },
    storeCategoryId: { type: String, default: null },
    autoUpdate: { type: Boolean, default: true },
    updateInterval: { type: Number, default: 300000, min: 60000 },
    maxFeaturedStores: { type: Number, default: 5, min: 1, max: 50 },
    maxTrendingProducts: { type: Number, default: 10, min: 1, max: 100 },
    maxNewProducts: { type: Number, default: 10, min: 1, max: 100 },
    maxTopRated: { type: Number, default: 10, min: 1, max: 100 },
    showStats: { type: Boolean, default: true },
  },

  commissions: {
    free: { type: Number, default: 0.10, min: 0, max: 1 },
    vip: { type: Number, default: 0.05, min: 0, max: 1 },
    premium: { type: Number, default: 0.03, min: 0, max: 1 },
    verified: { type: Number, default: 0.01, min: 0, max: 1 },
    storeCreationFree: { type: Number, default: 0, min: 0 },
    storeCreationVip: { type: Number, default: 5000, min: 0 },
    storeCreationPremium: { type: Number, default: 15000, min: 0 },
    storeCreationVerified: { type: Number, default: 50000, min: 0 },
    featuredListing: { type: Number, default: 10000, min: 0 },
    verificationFee: { type: Number, default: 25000, min: 0 },
  },

  wallet: {
    minDeposit: { type: Number, default: 100, min: 0 },
    maxDeposit: { type: Number, default: 1000000, min: 0 },
    minTransfer: { type: Number, default: 100, min: 0 },
    maxTransfer: { type: Number, default: 100000, min: 0 },
    transferCooldown: { type: Number, default: 5000, min: 1000 },
    allowNegativeBalance: { type: Boolean, default: false },
  },

  payment: {
    timeoutMinutes: { type: Number, default: 30, min: 5, max: 1440 },
    maxVerificationAttempts: { type: Number, default: 5, min: 1 },
    autoConfirmEnabled: { type: Boolean, default: false },
    autoConfirmPollInterval: { type: Number, default: 30000, min: 5000 },
    maxPendingPerCycle: { type: Number, default: 10, min: 1 },
  },

  withdraw: {
    minAmount: { type: Number, default: 1000, min: 0 },
    maxPending: { type: Number, default: 5, min: 1, max: 100 },
    fee: { type: Number, default: 0, min: 0 },
    cooldownMs: { type: Number, default: 60000, min: 1000 },
    requireApproval: { type: Boolean, default: true },
    autoApproveThreshold: { type: Number, default: 0, min: 0 },
    maxDailyWithdrawals: { type: Number, default: 10, min: 1 },
  },

  fraud: {
    enabled: { type: Boolean, default: true },
    riskThreshold: { type: Number, default: 50, min: 0, max: 100 },
    autoBanThreshold: { type: Number, default: 80, min: 0, max: 100 },
    maxAlertsPerUser: { type: Number, default: 10, min: 1 },
    notifyOnDetection: { type: Boolean, default: true },
    suspiciousIpCheck: { type: Boolean, default: true },
    duplicateAccountCheck: { type: Boolean, default: true },
    rapidTransactionCheck: { type: Boolean, default: true },
  },

  security: {
    antiSpam: { type: Boolean, default: true },
    antiScam: { type: Boolean, default: true },
    maxWarnings: { type: Number, default: 3, min: 1, max: 100 },
    banThreshold: { type: Number, default: 5, min: 1, max: 100 },
    spamThreshold: { type: Number, default: 10, min: 1, max: 1000 },
    spamWindow: { type: Number, default: 60000, min: 1000 },
    rateLimitAdmin: { type: Number, default: 10, min: 1 },
    rateLimitOwner: { type: Number, default: 5, min: 1 },
    blockDuration: { type: Number, default: 60, min: 10 },
  },

  backup: {
    enabled: { type: Boolean, default: true },
    dailyRetention: { type: Number, default: 7, min: 1, max: 365 },
    weeklyRetention: { type: Number, default: 4, min: 1, max: 52 },
    monthlyRetention: { type: Number, default: 12, min: 1, max: 120 },
    notifyOnFailure: { type: Boolean, default: true },
    notifyOnSuccess: { type: Boolean, default: false },
    autoVerify: { type: Boolean, default: true },
  },

  alert: {
    enabled: { type: Boolean, default: true },
    notifyOnCritical: { type: Boolean, default: true },
    notifyOnHigh: { type: Boolean, default: true },
    notifyOnMedium: { type: Boolean, default: false },
    notifyOnLow: { type: Boolean, default: false },
    mongoCheckInterval: { type: Number, default: 60000, min: 5000 },
    discordCheckInterval: { type: Number, default: 30000, min: 5000 },
    memoryThreshold: { type: Number, default: 80, min: 10, max: 100 },
    cpuThreshold: { type: Number, default: 80, min: 10, max: 100 },
  },

  monitor: {
    enabled: { type: Boolean, default: true },
    sampleInterval: { type: Number, default: 60000, min: 5000 },
    reportInterval: { type: Number, default: 3600000, min: 60000 },
    maxErrorSamples: { type: Number, default: 1000, min: 100 },
    maxResponseTimes: { type: Number, default: 10000, min: 100 },
    trackCommands: { type: Boolean, default: true },
    trackInteractions: { type: Boolean, default: true },
    trackPayments: { type: Boolean, default: true },
  },

  ticket: {
    enabled: { type: Boolean, default: true },
    categoryId: { type: String, default: null },
    supportRoleId: { type: String, default: null },
    cooldownMs: { type: Number, default: 300000, min: 1000 },
    maxOpenPerUser: { type: Number, default: 3, min: 1 },
    autoCloseHours: { type: Number, default: 48, min: 1 },
    requireReason: { type: Boolean, default: true },
    allowAttachments: { type: Boolean, default: true },
  },

  loyalty: {
    enabled: { type: Boolean, default: true },
    pointsPerPurchase: { type: Number, default: 10, min: 0 },
    pointsPerReview: { type: Number, default: 5, min: 0 },
    pointsPerReferral: { type: Number, default: 50, min: 0 },
    pointsPerStoreCreation: { type: Number, default: 100, min: 0 },
    bonusMultiplier: { type: Number, default: 1.0, min: 0.1, max: 10 },
  },

  trust: {
    enabled: { type: Boolean, default: true },
    minSalesToVerify: { type: Number, default: 10, min: 0 },
    minRatingToVerify: { type: Number, default: 4.0, min: 0, max: 5 },
    minAgeDays: { type: Number, default: 7, min: 0 },
    autoVerifyEnabled: { type: Boolean, default: false },
    reviewThreshold: { type: Number, default: 5, min: 0 },
  },

  roles: {
    adminRoleId: { type: String, default: null },
    modRoleId: { type: String, default: null },
    supportRoleId: { type: String, default: null },
    verifiedBuyerRoleId: { type: String, default: null },
    verifiedSellerRoleId: { type: String, default: null },
    premiumRoleId: { type: String, default: null },
    vipRoleId: { type: String, default: null },
    autoAssignVerified: { type: Boolean, default: true },
    autoAssignPremium: { type: Boolean, default: true },
  },

  log: {
    channelId: { type: String, default: null },
    logCommands: { type: Boolean, default: true },
    logErrors: { type: Boolean, default: true },
    logPayments: { type: Boolean, default: true },
    logWithdrawals: { type: Boolean, default: true },
    logFraud: { type: Boolean, default: true },
    logModActions: { type: Boolean, default: true },
    logBackups: { type: Boolean, default: true },
    logAlerts: { type: Boolean, default: true },
    logLevel: { type: String, default: 'info', enum: ['debug', 'info', 'warn', 'error'] },
  },
}, { timestamps: true });

module.exports = mongoose.model('ServerSettings', settingSchema);
