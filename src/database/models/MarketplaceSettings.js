const mongoose = require('mongoose');

const marketplaceSettingsSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    unique: true,
  },
  marketplaceChannelId: {
    type: String,
    default: null,
  },
  storeCategoryId: {
    type: String,
    default: null,
  },
  logChannelId: {
    type: String,
    default: null,
  },
  taxAccountId: {
    type: String,
    default: null,
  },
  commissions: {
    free: { type: Number, default: 0.10, min: 0, max: 1 },
    vip: { type: Number, default: 0.05, min: 0, max: 1 },
    premium: { type: Number, default: 0.03, min: 0, max: 1 },
    verified: { type: Number, default: 0.01, min: 0, max: 1 },
  },
  storeCreationFee: {
    free: { type: Number, default: 0, min: 0 },
    vip: { type: Number, default: 5000, min: 0 },
    premium: { type: Number, default: 15000, min: 0 },
    verified: { type: Number, default: 50000, min: 0 },
  },
  featuredListingFee: {
    type: Number,
    default: 10000,
    min: 0,
  },
  verificationFee: {
    type: Number,
    default: 25000,
    min: 0,
  },
  marketplace: {
    autoUpdate: { type: Boolean, default: true },
    updateInterval: { type: Number, default: 300000, min: 60000 },
    maxFeaturedStores: { type: Number, default: 5, min: 1, max: 50 },
    maxTrendingProducts: { type: Number, default: 10, min: 1, max: 100 },
    maxNewProducts: { type: Number, default: 10, min: 1, max: 100 },
    maxTopRated: { type: Number, default: 10, min: 1, max: 100 },
    showStats: { type: Boolean, default: true },
  },
  storeLimits: {
    maxPerUser: { type: Number, default: 3, min: 1, max: 100 },
    maxProducts: { type: Number, default: 100, min: 1, max: 10000 },
    maxServices: { type: Number, default: 50, min: 1, max: 10000 },
    maxImagesPerProduct: { type: Number, default: 5, min: 0, max: 50 },
  },
  cooldowns: {
    storeCreate: { type: Number, default: 3600000, min: 1000 },
    productAdd: { type: Number, default: 5000, min: 1000 },
    search: { type: Number, default: 3000, min: 1000 },
    ai: { type: Number, default: 10000, min: 1000 },
    ticketCreate: { type: Number, default: 300000, min: 1000 },
  },
  security: {
    antiSpam: { type: Boolean, default: true },
    antiScam: { type: Boolean, default: true },
    maxWarnings: { type: Number, default: 3, min: 1, max: 100 },
    banThreshold: { type: Number, default: 5, min: 1, max: 100 },
    spamThreshold: { type: Number, default: 10, min: 1, max: 1000 },
    spamWindow: { type: Number, default: 60000, min: 1000 },
  },
  loyalty: {
    enabled: { type: Boolean, default: true },
    pointsPerPurchase: { type: Number, default: 10 },
    pointsPerReview: { type: Number, default: 5 },
    pointsPerReferral: { type: Number, default: 50 },
  },
  ai: {
    enabled: { type: Boolean, default: true },
    model: { type: String, default: 'qwen/qwen3-32b' },
    maxTokens: { type: Number, default: 2000 },
    temperature: { type: Number, default: 0.7 },
    systemPrompt: { type: String, default: '' },
  },
  notifications: {
    newOrder: { type: Boolean, default: true },
    newReview: { type: Boolean, default: true },
    newTicket: { type: Boolean, default: true },
    payout: { type: Boolean, default: true },
    lowStock: { type: Boolean, default: true },
  },
  language: {
    type: String,
    default: 'ar',
    enum: ['ar', 'en'],
  },
  currency: {
    code: { type: String, default: 'credits' },
    symbol: { type: String, default: '💰' },
    name: { type: String, default: 'كريدت' },
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('MarketplaceSettings', marketplaceSettingsSchema);