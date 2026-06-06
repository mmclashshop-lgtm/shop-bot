const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    maxlength: 20,
  },
  name: {
    type: String,
    required: true,
    maxlength: 100,
  },
  description: {
    type: String,
    maxlength: 500,
    default: '',
  },
  type: {
    type: String,
    enum: ['percentage', 'fixed', 'free_shipping', 'buy_x_get_y'],
    required: true,
  },
  value: {
    type: Number,
    required: true,
    min: 0,
  },
  maxDiscount: {
    type: Number,
    default: null,
  },
  minPurchase: {
    type: Number,
    default: 0,
  },
  applicableTo: {
    type: String,
    enum: ['all', 'products', 'services', 'store', 'category', 'specific'],
    default: 'all',
  },
  applicableIds: [{
    type: mongoose.Schema.Types.ObjectId,
  }],
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    default: null,
    index: true,
  },
  createdBy: {
    type: String,
    required: true,
  },
  usageLimit: {
    total: { type: Number, default: 0 },
    perUser: { type: Number, default: 1 },
  },
  usageCount: {
    total: { type: Number, default: 0 },
    users: [{
      userId: String,
      count: { type: Number, default: 0 },
      lastUsed: Date,
    }],
  },
  startsAt: {
    type: Date,
    default: Date.now,
  },
  endsAt: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isPublic: {
    type: Boolean,
    default: true,
  },
  allowedUsers: [{
    type: String,
  }],
  allowedRoles: [{
    type: String,
  }],
  excludedProducts: [{
    type: mongoose.Schema.Types.ObjectId,
  }],
  excludedStores: [{
    type: mongoose.Schema.Types.ObjectId,
  }],
  metadata: {
    source: { type: String, enum: ['admin', 'store', 'event', 'loyalty', 'referral'], default: 'admin' },
    campaign: String,
  },
}, {
  timestamps: true,
});

couponSchema.index({ storeId: 1, isActive: 1 });
couponSchema.index({ endsAt: 1 });
couponSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });

couponSchema.virtual('isValid').get(function() {
  const now = new Date();
  if (!this.isActive) return false;
  if (this.startsAt > now) return false;
  if (this.endsAt && this.endsAt < now) return false;
  if (this.usageLimit.total > 0 && this.usageCount.total >= this.usageLimit.total) return false;
  return true;
});

couponSchema.virtual('remainingUses').get(function() {
  if (this.usageLimit.total === 0) return Infinity;
  return Math.max(0, this.usageLimit.total - this.usageCount.total);
});

couponSchema.set('toJSON', { virtuals: true });
couponSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Coupon', couponSchema);