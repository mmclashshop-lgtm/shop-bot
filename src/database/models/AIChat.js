const mongoose = require('mongoose');

const aiChatSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  guildId: {
    type: String,
    required: true,
    index: true,
  },
  channelId: {
    type: String,
    default: null,
  },
  title: {
    type: String,
    default: 'محادثة جديدة',
  },
  isPinned: {
    type: Boolean,
    default: false,
    index: true,
  },
  isFavorite: {
    type: Boolean,
    default: false,
    index: true,
  },
  type: {
    type: String,
    enum: ['general', 'product', 'store', 'buyer_assist', 'code', 'study', 'creative', 'translate', 'summarize'],
    default: 'general',
  },
  messages: [{
    role: {
      type: String,
      enum: ['system', 'user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: 4000,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  }],
  usage: {
    promptTokens: { type: Number, default: 0, min: 0 },
    completionTokens: { type: Number, default: 0, min: 0 },
    totalTokens: { type: Number, default: 0, min: 0 },
    cost: { type: Number, default: 0, min: 0 },
  },
  metadata: {
    model: String,
    temperature: { type: Number, min: 0, max: 2 },
    maxTokens: { type: Number, min: 1 },
    responseTime: { type: Number, min: 0 },
  },
  feedback: [{
    messageId: String,
    rating: Number,
    timestamp: { type: Date, default: Date.now }
  }],
  summary: {
    type: String,
    default: null,
  },
  context: mongoose.Schema.Types.Mixed,
}, {
  timestamps: true,
});

aiChatSchema.index({ userId: 1, guildId: 1, createdAt: -1 });
aiChatSchema.index({ userId: 1, guildId: 1, channelId: 1 }, { unique: true, partialFilterExpression: { channelId: { $ne: null } } });
aiChatSchema.index({ guildId: 1, type: 1 });
aiChatSchema.index({ createdAt: -1 });
aiChatSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

aiChatSchema.pre('save', function (next) {
  if (this.messages && this.messages.length > 100) {
    this.messages = this.messages.slice(-100);
  }
  next();
});

module.exports = mongoose.model('AIChat', aiChatSchema);