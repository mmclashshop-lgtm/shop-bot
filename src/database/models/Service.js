const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
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
    maxlength: 3000,
  },
  shortDescription: {
    type: String,
    maxlength: 300,
    default: '',
  },
  category: {
    type: String,
    required: true,
    enum: [
      'programming', 'design', 'translation', 'video_editing',
      'hosting', 'marketing', 'writing', 'music', 'other'
    ],
  },
  subcategory: {
    type: String,
    trim: true,
    default: '',
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  pricingModel: {
    type: String,
    enum: ['fixed', 'hourly', 'per_project', 'custom'],
    default: 'fixed',
  },
  deliveryTime: {
    type: Number,
    required: true,
    min: 1,
  },
  deliveryTimeUnit: {
    type: String,
    enum: ['hours', 'days', 'weeks'],
    default: 'days',
  },
  revisions: {
    type: Number,
    default: 2,
    min: 0,
  },
  images: [{
    url: String,
    isPrimary: { type: Boolean, default: false },
  }],
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
  }],
  requirements: {
    type: String,
    default: '',
  },
  whatYouGet: {
    type: String,
    default: '',
  },
  faq: [{
    question: String,
    answer: String,
  }],
  packages: [{
    name: { type: String, required: true },
    description: String,
    price: { type: Number, required: true, min: 0 },
    deliveryTime: { type: Number, default: 0 },
    deliveryTimeUnit: { type: String, enum: ['hours', 'days', 'weeks'], default: 'days' },
    revisions: { type: Number, default: 0 },
    features: [String],
    isPopular: { type: Boolean, default: false },
  }],
  soldCount: {
    type: Number,
    default: 0,
  },
  viewCount: {
    type: Number,
    default: 0,
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
  responseTime: {
    average: { type: Number, default: 0 },
    unit: { type: String, enum: ['minutes', 'hours'], default: 'hours' },
  },
  completionRate: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
  },
  onTimeDeliveryRate: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isFeatured: {
    type: Boolean,
    default: false,
  },
  featuredUntil: {
    type: Date,
    default: null,
  },
  discount: {
    percentage: { type: Number, default: 0, min: 0, max: 100 },
    startsAt: Date,
    endsAt: Date,
    code: String,
    maxUses: { type: Number, default: 0 },
    usedCount: { type: Number, default: 0 },
  },
  meta: {
    languages: [String],
    tools: [String],
    platforms: [String],
    frameworks: [String],
  },
}, {
  timestamps: true,
});

serviceSchema.index({ name: 'text', description: 'text', tags: 'text', category: 'text' });
serviceSchema.index({ price: 1 });
serviceSchema.index({ 'rating.average': -1 });
serviceSchema.index({ soldCount: -1 });
serviceSchema.index({ createdAt: -1 });
serviceSchema.index({ isActive: 1, isFeatured: 1 });
serviceSchema.index({ category: 1 });
serviceSchema.index({ 'discount.endsAt': 1 });
serviceSchema.index({ storeId: 1, isActive: 1, price: 1 });
serviceSchema.index({ category: 1, isActive: 1 });
serviceSchema.index({ isActive: 1, soldCount: -1 });
serviceSchema.index({ storeId: 1, isActive: 1, createdAt: -1 });
serviceSchema.index({ ownerId: 1, isActive: 1 });

serviceSchema.virtual('finalPrice').get(function() {
  if (this.discount && this.discount.percentage > 0) {
    const now = new Date();
    if ((!this.discount.startsAt || this.discount.startsAt <= now) &&
        (!this.discount.endsAt || this.discount.endsAt >= now)) {
      return this.price * (1 - this.discount.percentage / 100);
    }
  }
  return this.price;
});

serviceSchema.virtual('isOnSale').get(function() {
  if (!this.discount || this.discount.percentage === 0) return false;
  const now = new Date();
  return (!this.discount.startsAt || this.discount.startsAt <= now) &&
         (!this.discount.endsAt || this.discount.endsAt >= now);
});

serviceSchema.set('toJSON', { virtuals: true });
serviceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Service', serviceSchema);