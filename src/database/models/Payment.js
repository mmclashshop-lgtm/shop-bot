const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  paymentId: {
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
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null,
    index: true,
  },
  itemType: {
    type: String,
    enum: ['product', 'service'],
    required: true,
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  itemName: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  commissionRate: {
    type: Number,
    required: true,
    min: 0,
    max: 1,
  },
  commissionAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  sellerAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  platformAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    default: 'credits',
  },
  paymentMethod: {
    type: String,
    enum: ['probot_credits', 'wallet'],
    default: 'probot_credits',
  },
  status: {
    type: String,
    enum: ['pending', 'awaiting_verification', 'confirmed', 'completed', 'failed', 'expired', 'cancelled', 'disputed'],
    default: 'pending',
    index: true,
  },
  probotTransactionId: {
    type: String,
    default: null,
    sparse: true,
  },
  idempotencyKey: {
    type: String,
    default: null,
    unique: true,
    sparse: true,
  },
  referenceCode: {
    type: String,
    required: true,
    unique: true,
  },
  platformAccountId: {
    type: String,
    default: null,
  },
  verificationAttempts: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  verifiedAt: {
    type: Date,
    default: null,
  },
  verifiedBy: {
    type: String,
    default: null,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  cancelledAt: {
    type: Date,
    default: null,
  },
  cancelReason: {
    type: String,
    default: null,
  },
  metadata: {
    ip: String,
    userAgent: String,
    note: String,
  },
  fraudFlags: [{
    type: {
      type: String,
      enum: ['duplicate_txn', 'suspicious_amount', 'rapid_attempts', 'wrong_account', 'mismatched_reference'],
    },
    details: String,
    detectedAt: { type: Date, default: Date.now },
  }],
  auditTrail: [{
    action: {
      type: String,
      enum: ['created', 'verified', 'confirmed', 'completed', 'expired', 'cancelled', 'disputed', 'fraud_flagged'],
    },
    by: String,
    at: { type: Date, default: Date.now },
    details: String,
  }],
}, {
  timestamps: true,
});

  paymentSchema.index({ status: 1, createdAt: -1 });
  paymentSchema.index({ buyerId: 1, status: 1 });
  paymentSchema.index({ sellerId: 1, status: 1 });
  paymentSchema.index({ storeId: 1, status: 1 });
  paymentSchema.index({ status: 1, expiresAt: 1 });
  paymentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Payment', paymentSchema);
