const mongoose = require('mongoose');

const pendingActionSchema = new mongoose.Schema({
  nonce: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['withdraw', 'pay'],
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  targetUserId: {
    type: String,
    default: null,
  },
  amount: {
    type: Number,
    required: true,
  },
  method: {
    type: String,
    default: null,
  },
  details: {
    type: String,
    default: null,
  },
  note: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: { expireAfterSeconds: 300 },
  },
});

pendingActionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('PendingAction', pendingActionSchema);
