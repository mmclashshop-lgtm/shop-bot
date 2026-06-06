const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  ownerId: {
    type: String,
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000,
  },
  image: {
    type: String,
    default: null,
  },
  banner: {
    type: String,
    default: null,
  },
  type: {
    type: String,
    enum: ['free', 'vip', 'premium', 'verified'],
    default: 'free',
  },
  categoryId: {
    type: String,
    default: null,
  },
  channels: {
    info: String,
    products: String,
    reviews: String,
    support: String,
    stats: String,
  },
  messageId: {
    type: String,
    default: null,
  },
  channelId: {
    type: String,
    default: null,
  },
  rating: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 },
    distribution: {
      1: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      5: { type: Number, default: 0 },
    },
  },
  stats: {
    totalProducts: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    totalCommission: { type: Number, default: 0 },
    totalViews: { type: Number, default: 0 },
    totalVisitors: { type: Number, default: 0 },
    conversionRate: { type: Number, default: 0 },
  },
  settings: {
    isPublic: { type: Boolean, default: true },
    allowReviews: { type: Boolean, default: true },
    autoReply: { type: Boolean, default: false },
    autoReplyMessage: { type: String, default: '' },
    minimumPurchase: { type: Number, default: 0 },
    maximumPurchase: { type: Number, default: 0 },
    currency: { type: String, default: 'credits' },
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
  }],
  socialLinks: {
    website: String,
    twitter: String,
    discord: String,
    youtube: String,
    instagram: String,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isSuspended: {
    type: Boolean,
    default: false,
  },
  suspensionReason: {
    type: String,
    default: null,
  },
  suspendedAt: {
    type: Date,
    default: null,
  },
  suspendedBy: {
    type: String,
    default: null,
  },
  featuredUntil: {
    type: Date,
    default: null,
  },
  boostLevel: {
    type: Number,
    default: 0,
  },
  boostExpiresAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

storeSchema.index({ name: 'text', description: 'text', tags: 'text' });
storeSchema.index({ 'rating.average': -1 });
storeSchema.index({ 'stats.totalSales': -1 });
storeSchema.index({ createdAt: -1 });
storeSchema.index({ featuredUntil: -1 });
storeSchema.index({ ownerId: 1, isActive: 1 });
storeSchema.index({ isActive: 1, isSuspended: 1 });
storeSchema.index({ isActive: 1, isSuspended: 1, 'stats.totalSales': -1 });

storeSchema.virtual('commissionRate').get(function() {
  const rates = {
    free: 0.10,
    vip: 0.05,
    premium: 0.03,
    verified: 0.01,
  };
  return rates[this.type] || 0.10;
});

storeSchema.set('toJSON', { virtuals: true });
storeSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Store', storeSchema);