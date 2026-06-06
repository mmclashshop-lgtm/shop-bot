const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
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
    maxlength: 2000,
  },
  shortDescription: {
    type: String,
    maxlength: 300,
    default: '',
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  originalPrice: {
    type: Number,
    default: null,
  },
  currency: {
    type: String,
    default: 'credits',
    enum: ['credits', 'usd', 'eur', 'sar'],
  },
  images: [{
    url: String,
    isPrimary: { type: Boolean, default: false },
  }],
  category: {
    type: String,
    required: true,
    trim: true,
  },
  subcategory: {
    type: String,
    trim: true,
    default: '',
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
  }],
  stock: {
    type: Number,
    default: -1,
    min: -1,
  },
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
  attributes: [{
    name: String,
    value: String,
  }],
  variations: [{
    name: String,
    options: [{
      value: String,
      priceModifier: { type: Number, default: 0 },
      stock: { type: Number, default: -1 },
      sku: String,
    }],
  }],
  deliveryType: {
    type: String,
    enum: ['instant', 'manual', 'digital', 'physical', 'service'],
    default: 'instant',
  },
  deliveryContent: {
    type: String,
    default: '',
  },
  deliveryFiles: [{
    name: String,
    url: String,
    size: Number,
  }],
  requirements: {
    type: String,
    default: '',
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
  seo: {
    title: String,
    description: String,
    keywords: [String],
  },
  meta: {
    weight: Number,
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
    },
    brand: String,
    sku: String,
    barcode: String,
  },
}, {
  timestamps: true,
});

productSchema.index({ name: 'text', description: 'text', tags: 'text', category: 'text' });
productSchema.index({ price: 1 });
productSchema.index({ 'rating.average': -1 });
productSchema.index({ soldCount: -1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ 'discount.endsAt': 1 });
productSchema.index({ storeId: 1, isActive: 1, price: 1 });
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ isActive: 1, soldCount: -1 });
productSchema.index({ category: 1, isActive: 1, soldCount: -1 });
productSchema.index({ storeId: 1, isActive: 1, soldCount: -1 });
productSchema.index({ storeId: 1, isActive: 1, createdAt: -1 });
productSchema.index({ ownerId: 1, isActive: 1 });

productSchema.virtual('finalPrice').get(function() {
  if (this.discount && this.discount.percentage > 0) {
    const now = new Date();
    if ((!this.discount.startsAt || this.discount.startsAt <= now) &&
        (!this.discount.endsAt || this.discount.endsAt >= now)) {
      return this.price * (1 - this.discount.percentage / 100);
    }
  }
  return this.price;
});

productSchema.virtual('isOnSale').get(function() {
  if (!this.discount || this.discount.percentage === 0) return false;
  const now = new Date();
  return (!this.discount.startsAt || this.discount.startsAt <= now) &&
         (!this.discount.endsAt || this.discount.endsAt >= now);
});

productSchema.virtual('isInStock').get(function() {
  return this.stock === -1 || this.stock > 0;
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);