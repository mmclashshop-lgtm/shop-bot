const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: [
      'deposit', 'withdraw', 'purchase', 'sale', 'refund',
      'commission', 'bonus', 'penalty', 'transfer', 'fee',
      'loyalty_reward', 'referral_bonus', 'store_creation',
      'product_boost', 'featured_listing', 'verification_fee'
    ],
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled', 'reversed'],
    default: 'pending',
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    validate: {
      validator: function(v) { return Number.isFinite(v) && v !== 0; },
      message: 'Amount must be a finite non-zero number',
    },
  },
  currency: {
    type: String,
    enum: ['credits', 'usd', 'eur', 'sar', 'aed'],
    default: 'credits',
  },
  balanceBefore: {
    type: Number,
    required: true,
  },
  balanceAfter: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
    required: true,
    maxlength: 500,
  },
  reference: {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    userId: String,
    couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
  },
  metadata: {
    ip: String,
    userAgent: String,
    method: String,
    provider: String,
    transactionId: String,
    fee: { type: Number, min: 0 },
    netAmount: { type: Number, min: 0 },
  },
  relatedTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null,
  },
  processedBy: {
    type: String,
    default: 'system',
  },
  notes: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ userId: 1, type: 1 });
transactionSchema.index({ userId: 1, status: 1 });
transactionSchema.index({ 'reference.orderId': 1 });
transactionSchema.index({ createdAt: -1, type: 1 });
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ userId: 1, type: 1, status: 1 });
transactionSchema.index({ type: 1, status: 1, createdAt: -1 });
transactionSchema.index({ 'reference.storeId': 1, type: 1, status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);