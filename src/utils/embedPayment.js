const config = require('../config');
const { EmbedBuilderUtil } = require('./embedCore');

const { colors, emojis } = config;

function orderCard(order, options = {}) {
  const statusEmoji = EmbedBuilderUtil.getOrderStatusEmoji(order.status);
  const statusName = EmbedBuilderUtil.getOrderStatusName(order.status);

  return EmbedBuilderUtil.createBase({
    title: `${statusEmoji} طلب #${order.orderNumber}`,
    description: `**${order.itemName}** × ${order.quantity}`,
    color: EmbedBuilderUtil.getOrderStatusColor(order.status),
    fields: [
      { name: `${emojis.money} الإجمالي`, value: `${order.total.toLocaleString()} ${config.currency.symbol}`, inline: true },
      { name: '📊 الحالة', value: statusName, inline: true },
      { name: `${emojis.user} المشتري`, value: `<@${order.buyerId}>`, inline: true },
      { name: `${emojis.store} البائع`, value: `<@${order.sellerId}>`, inline: true },
      { name: '📅 التاريخ', value: `<t:${Math.floor(order.createdAt / 1000)}:F>`, inline: true },
    ],
    footer: { text: `نوع: ${order.type === 'product' ? 'منتج' : 'خدمة'}` },
  });
}

function paymentCard(payment, options = {}) {
  const statusColors = {
    pending: colors.warning, awaiting_verification: colors.info, confirmed: colors.success,
    completed: colors.success, failed: colors.error, expired: colors.error,
    cancelled: colors.error, disputed: colors.warning,
  };

  return EmbedBuilderUtil.createBase({
    title: `${emojis.money} دفعة #${payment.paymentId}`,
    color: statusColors[payment.status] || colors.primary,
    fields: [
      { name: '💰 المبلغ', value: `${payment.amount.toLocaleString()} ${config.currency.symbol}`, inline: true },
      { name: '📊 الحالة', value: EmbedBuilderUtil.getPaymentStatusName(payment.status), inline: true },
      { name: '📦 العنصر', value: payment.itemName || 'N/A', inline: true },
      { name: '💸 العمولة', value: `${Math.round(payment.commissionRate * 100)}% (${payment.commissionAmount.toLocaleString()} ${config.currency.symbol})`, inline: true },
      { name: '👤 البائع', value: `<@${payment.sellerId}>`, inline: true },
      { name: '🔗 كود المرجع', value: `\`${payment.referenceCode}\``, inline: true },
      { name: '⏳ ينتهي', value: payment.expiresAt ? `<t:${Math.floor(payment.expiresAt / 1000)}:R>` : 'N/A', inline: true },
    ],
    footer: payment.status === 'pending' ? { text: '🔄 حول المبلغ ثم تحقق عبر /admin ← Payments' } : undefined,
  });
}

function withdrawalCard(withdrawal, options = {}) {
  const statusColors = {
    pending: colors.warning, approved: colors.success, rejected: colors.error,
    processing: colors.info, completed: colors.success, cancelled: colors.error,
  };

  return EmbedBuilderUtil.createBase({
    title: `${emojis.money} سحب #${withdrawal.withdrawalId}`,
    color: statusColors[withdrawal.status] || colors.primary,
    fields: [
      { name: '💰 المبلغ', value: `${withdrawal.amount.toLocaleString()} ${config.currency.symbol}`, inline: true },
      { name: '💳 الطريقة', value: withdrawal.paymentMethod || 'N/A', inline: true },
      { name: '📊 الحالة', value: EmbedBuilderUtil.getWithdrawalStatusName(withdrawal.status), inline: true },
      { name: '📅 الطلب', value: withdrawal.requestedAt ? `<t:${Math.floor(withdrawal.requestedAt / 1000)}:F>` : 'N/A', inline: true },
      { name: '📝 التفاصيل', value: withdrawal.notes || 'بدون', inline: true },
    ],
  });
}

function aiResponse(title, response, options = {}) {
  return EmbedBuilderUtil.createBase({
    title: `${emojis.ai} ${title}`,
    description: response,
    color: colors.purple,
    footer: { text: `نموذج: ${options.model || 'Groq'} • رموز: ${options.tokens || 'N/A'}` },
  });
}

EmbedBuilderUtil.orderCard = orderCard;
EmbedBuilderUtil.paymentCard = paymentCard;
EmbedBuilderUtil.withdrawalCard = withdrawalCard;
EmbedBuilderUtil.aiResponse = aiResponse;

module.exports = { orderCard, paymentCard, withdrawalCard, aiResponse };
