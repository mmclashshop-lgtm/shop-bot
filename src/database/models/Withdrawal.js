const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  withdrawalId: {
    type: String,
    required: true,
    unique: true,
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  fee: {
    type: Number,
    default: 0,
    min: 0,
  },
  netAmount: {
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
    enum: ['pending', 'approved', 'rejected', 'processing', 'completed', 'cancelled'],
    default: 'pending',
    index: true,
  },
  paymentMethod: {
    type: String,
    enum: ['probot_credits', 'bank', 'crypto', 'other'],
    default: 'probot_credits',
  },
  paymentDetails: {
    probotUserId: String,
    accountName: String,
    accountNumber: String,
    bankName: String,
    cryptoAddress: String,
    cryptoNetwork: String,
    notes: String,
  },
  balanceBefore: {
    type: Number,
    required: true,
  },
  balanceAfter: {
    type: Number,
    required: true,
  },
  requestedAt: {
    type: Date,
    default: Date.now,
  },
  processedAt: {
    type: Date,
    default: null,
  },
  processedBy: {
    type: String,
    default: null,
  },
  rejectionReason: {
    type: String,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  metadata: {
    ip: String,
    userAgent: String,
  },
  auditTrail: [{
    action: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'processing', 'completed', 'cancelled'],
    },
    by: String,
    at: { type: Date, default: Date.now },
    details: String,
  }],
}, {
  timestamps: true,
});

withdrawalSchema.index({ status: 1, createdAt: -1 });
withdrawalSchema.index({ userId: 1, status: 1 });
withdrawalSchema.index({ userId: 1, createdAt: -1 });
withdrawalSchema.index({ processedBy: 1, status: 1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
