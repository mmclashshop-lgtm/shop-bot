const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: true,
    unique: true,
  },
  buyerId: {
    type: String,
    required: true,
    index: true,
  },
  sellerId: {
    type: String,
    required: true,
    index: true,
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['product', 'service'],
    required: true,
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  itemName: {
    type: String,
    required: true,
  },
  itemImage: {
    type: String,
    default: null,
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1,
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0,
  },
  discount: {
    amount: { type: Number, default: 0 },
    code: String,
    percentage: { type: Number, default: 0 },
  },
  tax: {
    rate: { type: Number, required: true },
    amount: { type: Number, required: true },
  },
  platformFee: {
    rate: { type: Number, required: true },
    amount: { type: Number, required: true },
  },
  total: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    default: 'credits',
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'processing', 'delivered', 'completed', 'cancelled', 'refunded', 'disputed'],
    default: 'pending',
    index: true,
  },
  paymentMethod: {
    type: String,
    enum: ['wallet', 'credits', 'mixed', 'probot'],
    default: 'wallet',
  },
  paymentDetails: {
    transactionId: String,
    walletAmount: { type: Number, default: 0 },
    creditsAmount: { type: Number, default: 0 },
    paidAt: Date,
  },
  delivery: {
    type: {
      type: String,
      enum: ['instant', 'manual', 'digital', 'physical', 'service'],
      default: 'instant',
    },
    content: String,
    files: [{
      name: String,
      url: String,
    }],
    deliveredAt: Date,
    deliveredBy: String,
  },
  serviceDetails: {
    packageName: String,
    requirements: String,
    deadline: Date,
    startedAt: Date,
    completedAt: Date,
    revisionsUsed: { type: Number, default: 0 },
    revisionsAllowed: { type: Number, default: 0 },
  },
  review: {
    productId: mongoose.Schema.Types.ObjectId,
    serviceId: mongoose.Schema.Types.ObjectId,
    rating: Number,
    comment: String,
    createdAt: Date,
    isAnonymous: Boolean,
  },
  dispute: {
    isOpen: { type: Boolean, default: false },
    openedBy: String,
    openedAt: Date,
    reason: String,
    evidence: [String],
    status: { type: String, enum: ['open', 'in_review', 'resolved', 'closed'], default: 'open' },
    resolution: String,
    resolvedBy: String,
    resolvedAt: Date,
  },
  refund: {
    requested: { type: Boolean, default: false },
    requestedAt: Date,
    reason: String,
    amount: Number,
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'completed'], default: 'pending' },
    processedAt: Date,
    processedBy: String,
  },
  notes: {
    buyer: String,
    seller: String,
    admin: String,
  },
  metadata: {
    ip: String,
    userAgent: String,
    referrer: String,
  },
}, {
  timestamps: true,
});

orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ buyerId: 1, status: 1 });
orderSchema.index({ sellerId: 1, status: 1 });
orderSchema.index({ 'paymentDetails.transactionId': 1 });
orderSchema.index({ createdAt: -1, type: 1 });
orderSchema.index({ status: 1, sellerId: 1 });
orderSchema.index({ buyerId: 1, createdAt: -1 });
orderSchema.index({ storeId: 1, createdAt: -1 });
orderSchema.index({ storeId: 1, status: 1 });
orderSchema.index({ sellerId: 1, createdAt: -1 });

orderSchema.virtual('isPaid').get(function() {
  return ['paid', 'processing', 'delivered', 'completed'].includes(this.status);
});

orderSchema.virtual('canBeReviewed').get(function() {
  return this.status === 'completed' && !this.review;
});

orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Order', orderSchema);