const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema({
  commissionId: {
    type: String,
    required: true,
    unique: true,
  },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    required: true,
    index: true,
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null,
    index: true,
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true,
  },
  sellerId: {
    type: String,
    required: true,
    index: true,
  },
  storeType: {
    type: String,
    enum: ['free', 'vip', 'premium', 'verified'],
    required: true,
  },
  itemType: {
    type: String,
    enum: ['product', 'service'],
    required: true,
  },
  itemName: {
    type: String,
    required: true,
  },
  totalAmount: {
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
  status: {
    type: String,
    enum: ['pending', 'completed', 'reversed', 'cancelled'],
    default: 'pending',
    index: true,
  },
  processedAt: {
    type: Date,
    default: null,
  },
  reversedAt: {
    type: Date,
    default: null,
  },
  reverseReason: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

commissionSchema.index({ createdAt: -1 });
commissionSchema.index({ sellerId: 1, createdAt: -1 });
commissionSchema.index({ storeId: 1, createdAt: -1 });
commissionSchema.index({ status: 1, storeType: 1 });
commissionSchema.index({ createdAt: -1, storeType: 1 });

module.exports = mongoose.model('Commission', commissionSchema);
