const mongoose = require('mongoose');

const loyaltyRewardSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  rewardId: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['discount', 'commission_waiver', 'store_boost', 'badge', 'custom'],
    required: true,
  },
  value: mongoose.Schema.Types.Mixed,
  cost: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ['claimed', 'used', 'expired', 'cancelled'],
    default: 'claimed',
  },
  claimedAt: {
    type: Date,
    default: Date.now,
  },
  usedAt: {
    type: Date,
    default: null,
  },
  expiresAt: {
    type: Date,
    default: null,
  },
  usedOn: {
    orderId: mongoose.Schema.Types.ObjectId,
    storeId: mongoose.Schema.Types.ObjectId,
  },
  metadata: {
    code: String,
    discountPercentage: Number,
    durationDays: Number,
  },
}, {
  timestamps: true,
});

loyaltyRewardSchema.index({ userId: 1, status: 1 });
loyaltyRewardSchema.index({ userId: 1, rewardId: 1, status: 1 });
loyaltyRewardSchema.index({ rewardId: 1 });
loyaltyRewardSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('LoyaltyReward', loyaltyRewardSchema);