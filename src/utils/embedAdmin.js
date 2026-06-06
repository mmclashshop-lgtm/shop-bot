const config = require('../config');
const { EmbedBuilderUtil } = require('./embedCore');

const { colors, emojis } = config;

function ticketCard(ticket, options = {}) {
  const priorityEmoji = EmbedBuilderUtil.getPriorityEmoji(ticket.priority);
  const statusEmoji = EmbedBuilderUtil.getTicketStatusEmoji(ticket.status);

  return EmbedBuilderUtil.createBase({
    title: `${statusEmoji} تذكرة #${ticket.ticketNumber}`,
    description: ticket.subject,
    color: EmbedBuilderUtil.getPriorityColor(ticket.priority),
    fields: [
      { name: `${emojis.user} مقدم الطلب`, value: `<@${ticket.userId}>`, inline: true },
      { name: '🏷️ النوع', value: EmbedBuilderUtil.getTicketTypeName(ticket.type), inline: true },
      { name: `${priorityEmoji} الأولوية`, value: EmbedBuilderUtil.getPriorityName(ticket.priority), inline: true },
      { name: `${statusEmoji} الحالة`, value: EmbedBuilderUtil.getTicketStatusName(ticket.status), inline: true },
      { name: '👤 المعين', value: ticket.assignedTo ? `<@${ticket.assignedTo}>` : 'غير معين', inline: true },
      { name: '📅 الإنشاء', value: `<t:${Math.floor(ticket.createdAt / 1000)}:R>`, inline: true },
    ],
  });
}

function reviewCard(review, options = {}) {
  const stars = '⭐'.repeat(review.rating) + '☆'.repeat(5 - review.rating);

  return EmbedBuilderUtil.createBase({
    title: `${stars} ${review.title || 'بدون عنوان'}`,
    description: review.comment || 'بدون تعليق',
    color: colors.gold,
    fields: [
      { name: `${emojis.user} المراجع`, value: review.isAnonymous ? 'مجهول' : `<@${review.reviewerId}>`, inline: true },
      { name: `${emojis.product} ${review.type === 'product' ? 'منتج' : 'خدمة'}`, value: review.itemName, inline: true },
      { name: '✅ مشتري موثق', value: review.isVerifiedPurchase ? 'نعم' : 'لا', inline: true },
    ],
    footer: { text: 'تاريخ المراجعة' },
    timestamp: review.createdAt,
  });
}

function commissionCard(commission, options = {}) {
  return EmbedBuilderUtil.createBase({
    title: '💸 عمولة',
    color: colors.gold,
    fields: [
      { name: '💰 المبلغ', value: `${commission.amount.toLocaleString()} ${config.currency.symbol}`, inline: true },
      { name: '📊 النسبة', value: `${Math.round(commission.rate * 100)}%`, inline: true },
      { name: '🏪 المتجر', value: commission.storeName || 'N/A', inline: true },
      { name: '👤 البائع', value: `<@${commission.sellerId}>`, inline: true },
      { name: '🏷️ نوع المتجر', value: EmbedBuilderUtil.getStoreTypeName(commission.storeType), inline: true },
    ],
  });
}

function walletCard(user, options = {}) {
  return EmbedBuilderUtil.createBase({
    title: `${emojis.wallet} محفظة ${options.username || 'المستخدم'}`,
    color: colors.gold,
    fields: [
      { name: `${emojis.money} الرصيد الحالي`, value: `${user.balance.toLocaleString()} ${config.currency.symbol}`, inline: true },
      { name: '📈 إجمالي الإنفاق', value: `${user.totalSpent.toLocaleString()} ${config.currency.symbol}`, inline: true },
      { name: '📉 إجمالي الأرباح', value: `${user.totalEarned.toLocaleString()} ${config.currency.symbol}`, inline: true },
      { name: '⭐ نقاط الولاء', value: user.loyaltyPoints.toLocaleString(), inline: true },
      { name: '🏆 مستوى الثقة', value: EmbedBuilderUtil.getTrustLevelName(user.trustLevel), inline: true },
    ],
    thumbnail: options.avatar,
  });
}

EmbedBuilderUtil.ticketCard = ticketCard;
EmbedBuilderUtil.reviewCard = reviewCard;
EmbedBuilderUtil.commissionCard = commissionCard;
EmbedBuilderUtil.walletCard = walletCard;

module.exports = { ticketCard, reviewCard, commissionCard, walletCard };
