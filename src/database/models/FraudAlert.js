const mongoose = require('mongoose');

const fraudAlertSchema = new mongoose.Schema({
  alertId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  guildId: { type: String, default: null },
  type: {
    type: String,
    required: true,
    enum: [
      'double_spend', 'rapid_transfer', 'suspicious_withdrawal',
      'multiple_failed_payments', 'fake_payment_verification',
      'coupon_abuse', 'loyalty_abuse', 'account_farming',
      'bot_activity', 'multi_account', 'suspicious_amount',
    ],
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'suspicious', 'high_risk', 'fraud'],
    default: 'warning',
  },
  riskScore: { type: Number, required: true, min: 0, max: 100, default: 0 },
  description: { type: String, required: true, maxlength: 1000 },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  metadata: {
    ipAddress: { type: String },
    userAgent: { type: String },
    sessionId: { type: String },
    relatedTransactionIds: [{ type: String }],
    relatedUserIds: [{ type: String }],
    geoLocation: { type: String },
    archived: { type: Boolean, default: false },
  },
  resolved: { type: Boolean, default: false, index: true },
  resolvedAt: { type: Date },
  resolvedBy: { type: String },
  resolution: { type: String, enum: ['false_positive', 'confirmed', 'ignored', 'action_taken'] },
  actionTaken: { type: String, maxlength: 500 },
  notifiedAdmins: { type: Boolean, default: false },
}, {
  timestamps: true,
});

fraudAlertSchema.index({ userId: 1, guildId: 1, createdAt: -1 });
fraudAlertSchema.index({ userId: 1, type: 1, createdAt: -1 });
fraudAlertSchema.index({ userId: 1, resolved: 1, createdAt: -1 });
fraudAlertSchema.index({ type: 1, severity: 1, createdAt: -1 });
fraudAlertSchema.index({ resolved: 1, createdAt: -1 });
fraudAlertSchema.index({ riskScore: -1, createdAt: -1 });
fraudAlertSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

module.exports = mongoose.model('FraudAlert', fraudAlertSchema);
