const config = require('../config');
const { EmbedBuilderUtil } = require('./embedCore');

const { colors, emojis } = config;

function storeCard(store, options = {}) {
  const commissionRate = (store.commissionRate || 0) * 100;
  const trustEmoji = EmbedBuilderUtil.getTrustEmoji(options.ownerTrustLevel);
  const stats = store.stats || {};
  const rating = store.rating || {};

  const embed = EmbedBuilderUtil.createBase({
    title: `${emojis.store} ${store.name}`,
    description: store.description || '',
    color: EmbedBuilderUtil.getStoreColor(store.type),
    thumbnail: store.image,
    image: store.banner,
    fields: [
      { name: `${emojis.user} المالك`, value: `<@${store.ownerId}>`, inline: true },
      { name: `${emojis.product} المنتجات`, value: (stats.totalProducts || 0).toString(), inline: true },
      { name: `${emojis.money} المبيعات`, value: (stats.totalSales || 0).toString(), inline: true },
      { name: `${emojis.star} التقييم`, value: `${(rating.average || 0).toFixed(1)} (${rating.count || 0})`, inline: true },
      { name: `${emojis.money} العمولة`, value: `${commissionRate}%`, inline: true },
      { name: `${emojis.store} النوع`, value: EmbedBuilderUtil.getStoreTypeName(store.type), inline: true },
    ],
    footer: { text: `معرف المتجر: ${store._id}` },
  });

  if (trustEmoji) {
    embed.spliceFields(0, 0, { name: 'الثقة', value: trustEmoji, inline: true });
  }

  if (store.isFeatured) {
    embed.addFields({ name: '✨ مميز', value: 'نعم', inline: true });
  }

  return embed;
}

function dashboardCard(stats, options = {}) {
  return EmbedBuilderUtil.createBase({
    title: `${emojis.chart} لوحة تحكم Market AI`,
    color: colors.primary,
    fields: [
      { name: `${emojis.store} إجمالي المتاجر`, value: stats.totalStores.toLocaleString(), inline: true },
      { name: `${emojis.product} إجمالي المنتجات`, value: stats.totalProducts.toLocaleString(), inline: true },
      { name: `${emojis.service} إجمالي الخدمات`, value: stats.totalServices.toLocaleString(), inline: true },
      { name: `${emojis.money} إجمالي المبيعات`, value: stats.totalSales.toLocaleString(), inline: true },
      { name: '💵 إجمالي الأرباح', value: `${stats.totalRevenue.toLocaleString()} ${config.currency.symbol}`, inline: true },
      { name: '💸 إجمالي العمولات', value: `${stats.totalCommission.toLocaleString()} ${config.currency.symbol}`, inline: true },
      { name: `${emojis.user} إجمالي المستخدمين`, value: stats.totalUsers.toLocaleString(), inline: true },
      { name: '📦 إجمالي الطلبات', value: stats.totalOrders.toLocaleString(), inline: true },
      { name: `${emojis.star} متوسط التقييم`, value: stats.averageRating.toFixed(1), inline: true },
    ],
    thumbnail: options.botAvatar,
  });
}

function marketplaceCard(data, options = {}) {
  const embed = EmbedBuilderUtil.createBase({
    title: `${emojis.store} Marketplace - ${options.guildName}`,
    description: 'أفضل المتاجر والمنتجات والخدمات في مكان واحد',
    color: colors.primary,
    image: options.banner,
  });

  if (data.featuredStores?.length) {
    embed.addFields({
      name: '✨ المتاجر المميزة',
      value: data.featuredStores.map(s => `• **${s.name}** - ${s.stats.totalSales} مبيعات ⭐ ${s.rating.average.toFixed(1)}`).join('\n'),
      inline: false,
    });
  }

  if (data.trendingProducts?.length) {
    embed.addFields({
      name: '🔥 المنتجات الرائجة',
      value: data.trendingProducts.map(p => `• **${p.name}** - ${p.finalPrice.toLocaleString()} ${config.currency.symbol} 📦 ${p.soldCount}`).join('\n'),
      inline: false,
    });
  }

  if (data.newProducts?.length) {
    embed.addFields({
      name: '🆕 أحدث المنتجات',
      value: data.newProducts.map(p => `• **${p.name}** - ${p.finalPrice.toLocaleString()} ${config.currency.symbol}`).join('\n'),
      inline: false,
    });
  }

  if (data.topRated?.length) {
    embed.addFields({
      name: '⭐ الأعلى تقييماً',
      value: data.topRated.map(i => `• **${i.name}** - ⭐ ${i.rating.average.toFixed(1)} (${i.rating.count})`).join('\n'),
      inline: false,
    });
  }

  embed.setFooter({ text: `آخر تحديث • ${data.totalStores} متجر • ${data.totalProducts} منتج` });

  return embed;
}

EmbedBuilderUtil.storeCard = storeCard;
EmbedBuilderUtil.dashboardCard = dashboardCard;
EmbedBuilderUtil.marketplaceCard = marketplaceCard;

module.exports = { storeCard, dashboardCard, marketplaceCard };
