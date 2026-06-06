const mongoose = require('mongoose');

const alertLogSchema = new mongoose.Schema({
  alertId: { type: String, required: true, unique: true },
  category: { type: String, required: true, enum: [
    'mongodb', 'discord', 'ai', 'wallet', 'payment', 'withdrawal',
    'memory', 'cpu', 'error_rate', 'fraud', 'spam', 'webhook', 'system',
  ]},
  priority: { type: String, required: true, enum: ['critical', 'high', 'medium', 'low'] },
  status: { type: String, default: 'open', enum: ['open', 'acknowledged', 'resolved', 'ignored'] },
  title: { type: String, required: true },
  message: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed },
  threshold: { type: mongoose.Schema.Types.Mixed },
  source: { type: String, default: 'system' },
  acknowledgedBy: { type: String, default: '' },
  acknowledgedAt: { type: Date },
  resolvedBy: { type: String, default: '' },
  resolvedAt: { type: Date },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  occurrences: { type: Number, default: 1 },
  lastOccurrence: { type: Date },
}, { timestamps: true });

alertLogSchema.index({ category: 1, createdAt: -1 });
alertLogSchema.index({ priority: 1, status: 1 });
alertLogSchema.index({ status: 1, createdAt: -1 });
alertLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AlertLog', alertLogSchema);
