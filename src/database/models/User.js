const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  discordId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  username: {
    type: String,
    required: true,
    maxlength: 32,
    minlength: 2,
  },
  discriminator: {
    type: String,
    default: '0000',
    match: /^\d{4}$/,
  },
  avatar: {
    type: String,
    default: null,
  },
  banner: {
    type: String,
    default: null,
  },
  bio: {
    type: String,
    default: '',
    maxlength: 500,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  platformEarnings: {
    type: Number,
    default: 0,
    min: 0,
  },
  totalSpent: {
    type: Number,
    default: 0,
    min: 0,
  },
  totalEarned: {
    type: Number,
    default: 0,
    min: 0,
  },
  loyaltyPoints: {
    type: Number,
    default: 0,
    min: 0,
  },
  trustLevel: {
    type: String,
    enum: ['none', 'verified', 'trusted', 'premium'],
    default: 'none',
  },
  trustBadge: {
    type: String,
    default: null,
  },
  isBanned: {
    type: Boolean,
    default: false,
  },
  banReason: {
    type: String,
    default: null,
  },
  warnings: [{
    reason: String,
    issuedBy: String,
    issuedAt: { type: Date, default: Date.now },
    expiresAt: Date,
  }],
  settings: {
    notifications: {
      purchases: { type: Boolean, default: true },
      reviews: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false },
    },
    privacy: {
      showBalance: { type: Boolean, default: false },
      showPurchases: { type: Boolean, default: false },
      showReviews: { type: Boolean, default: true },
    },
    language: {
      type: String,
      default: 'ar',
      enum: ['ar', 'en'],
    },
  },
  stats: {
    totalPurchases: { type: Number, default: 0, min: 0 },
    totalSales: { type: Number, default: 0, min: 0 },
    totalReviews: { type: Number, default: 0, min: 0 },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    joinedAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
  },
  cooldowns: {
    storeCreate: Date,
    productAdd: Date,
    search: Date,
    ai: Date,
    ticketCreate: Date,
  },
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
  },
  referredBy: {
    type: String,
    default: null,
  },
  referrals: [{
    userId: String,
    joinedAt: { type: Date, default: Date.now },
    bonusClaimed: { type: Boolean, default: false },
  }],
}, {
  timestamps: true,
});

userSchema.index({ 'stats.averageRating': -1 });
userSchema.index({ balance: -1 });
userSchema.index({ loyaltyPoints: -1 });
userSchema.index({ isBanned: 1 });
userSchema.index({ trustLevel: 1 });
userSchema.index({ username: 1 });
userSchema.index({ 'stats.lastActive': -1 });
userSchema.index({ referredBy: 1 });

module.exports = mongoose.model('User', userSchema);