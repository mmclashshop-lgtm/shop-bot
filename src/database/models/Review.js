const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true,
    index: true,
  },
  reviewerId: {
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
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  title: {
    type: String,
    maxlength: 200,
    default: '',
  },
  comment: {
    type: String,
    maxlength: 2000,
    default: '',
  },
  pros: {
    type: String,
    maxlength: 1000,
    default: '',
  },
  cons: {
    type: String,
    maxlength: 1000,
    default: '',
  },
  images: [{
    url: String,
    caption: String,
  }],
  isVerifiedPurchase: {
    type: Boolean,
    default: true,
  },
  isAnonymous: {
    type: Boolean,
    default: false,
  },
  isHidden: {
    type: Boolean,
    default: false,
  },
  hiddenReason: {
    type: String,
    default: null,
  },
  hiddenBy: {
    type: String,
    default: null,
  },
  hiddenAt: {
    type: Date,
    default: null,
  },
  sellerReply: {
    comment: String,
    repliedAt: Date,
  },
  helpfulVotes: {
    type: Number,
    default: 0,
  },
  unhelpfulVotes: {
    type: Number,
    default: 0,
  },
  votes: [{
    userId: String,
    vote: { type: Number, enum: [1, -1] },
    votedAt: { type: Date, default: Date.now },
  }],
  reportedBy: [{
    userId: String,
    reason: String,
    reportedAt: { type: Date, default: Date.now },
  }],
  isReported: {
    type: Boolean,
    default: false,
  },
  metadata: {
    ip: String,
    userAgent: String,
    orderValue: Number,
    deliveryTime: Number,
  },
}, {
  timestamps: true,
});

reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ storeId: 1, rating: -1 });
reviewSchema.index({ itemId: 1, rating: -1 });
reviewSchema.index({ reviewerId: 1, createdAt: -1 });
reviewSchema.index({ isHidden: 1, isReported: 1 });
reviewSchema.index({ sellerId: 1, isHidden: 1 });
reviewSchema.index({ itemId: 1, type: 1, isHidden: 1 });
reviewSchema.index({ storeId: 1, isHidden: 1, createdAt: -1 });

reviewSchema.virtual('helpfulPercentage').get(function() {
  const total = this.helpfulVotes + this.unhelpfulVotes;
  if (total === 0) return 0;
  return Math.round((this.helpfulVotes / total) * 100);
});

reviewSchema.set('toJSON', { virtuals: true });
reviewSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Review', reviewSchema);