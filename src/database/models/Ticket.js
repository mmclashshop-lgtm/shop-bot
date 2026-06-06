const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    required: true,
    unique: true,
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    default: null,
    index: true,
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null,
  },
  type: {
    type: String,
    enum: ['support', 'report', 'dispute', 'partnership', 'verification', 'technical', 'billing', 'other'],
    required: true,
    default: 'support',
  },
  subject: {
    type: String,
    required: true,
    maxlength: 200,
  },
  description: {
    type: String,
    required: true,
    maxlength: 3000,
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
  },
  status: {
    type: String,
    enum: ['open', 'waiting_user', 'waiting_staff', 'in_progress', 'resolved', 'closed'],
    default: 'open',
    index: true,
  },
  channelId: {
    type: String,
    default: null,
  },
  assignedTo: {
    type: String,
    default: null,
  },
  assignedAt: {
    type: Date,
    default: null,
  },
  firstResponseAt: {
    type: Date,
    default: null,
  },
  resolvedAt: {
    type: Date,
    default: null,
  },
  closedAt: {
    type: Date,
    default: null,
  },
  closedBy: {
    type: String,
    default: null,
  },
  closeReason: {
    type: String,
    default: null,
  },
  satisfactionRating: {
    rating: { type: Number, min: 1, max: 5 },
    comment: String,
    ratedAt: Date,
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
  }],
  messages: [{
    userId: String,
    username: String,
    content: { type: String, maxlength: 4000 },
    attachments: [{
      url: String,
      name: String,
      size: Number,
    }],
    isStaff: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  }],
  metadata: {
    ip: String,
    userAgent: String,
    source: { type: String, enum: ['command', 'button', 'mention', 'dm'], default: 'command' },
  },
}, {
  timestamps: true,
});

ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ status: 1, priority: -1, createdAt: 1 });
ticketSchema.index({ assignedTo: 1, status: 1 });
ticketSchema.index({ userId: 1, status: 1 });

ticketSchema.virtual('responseTime').get(function() {
  if (!this.firstResponseAt) return null;
  return this.firstResponseAt - this.createdAt;
});

ticketSchema.virtual('resolutionTime').get(function() {
  if (!this.resolvedAt) return null;
  return this.resolvedAt - this.createdAt;
});

ticketSchema.set('toJSON', { virtuals: true });
ticketSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Ticket', ticketSchema);