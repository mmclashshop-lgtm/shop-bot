const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'store_create', 'store_update', 'store_delete',
      'product_create', 'product_update', 'product_delete',
      'product_purchase', 'service_order',
      'wallet_deposit', 'wallet_withdraw', 'wallet_transfer',
      'user_verify', 'user_trust_change', 'user_ban', 'user_unban',
      'coupon_create', 'coupon_update', 'coupon_delete',
      'ticket_create', 'ticket_close', 'ticket_assign',
      'review_create', 'review_delete', 'review_report',
      'marketplace_setup', 'marketplace_feature',
      'commission_change', 'settings_change',
      'admin_command', 'system',
      'payment_created', 'payment_verified', 'payment_confirmed', 'payment_auto_confirmed', 'payment_webhook_confirmed',
      'payment_completed', 'payment_cancelled', 'payment_expired',
      'payment_failed', 'payment_fraud_flagged',
      'withdrawal_requested', 'withdrawal_approved', 'withdrawal_rejected',
      'withdrawal_completed', 'withdrawal_cancelled',
      'commission_recorded', 'commission_reversed',
    ],
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  targetId: {
    type: String,
    default: null,
    index: true,
  },
  targetType: {
    type: String,
    enum: ['store', 'product', 'service', 'order', 'user', 'ticket', 'coupon', 'review', 'settings', 'payment', 'withdrawal', 'commission'],
    default: null,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ip: {
    type: String,
    default: null,
  },
  guildId: {
    type: String,
    default: null,
    index: true,
  },
  metadata: {
    userTag: String,
    channelId: String,
    commandName: String,
  },
}, {
  timestamps: true,
});

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, targetType: 1 });
auditLogSchema.index({ action: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
