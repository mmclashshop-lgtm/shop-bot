const config = require('../config');
const { EmbedBuilderUtil } = require('./embedCore');

const { colors, emojis } = config;

function productCard(product, options = {}) {
  const price = product.finalPrice;
  const isOnSale = product.isOnSale && product.discount;
  const discount = isOnSale ? (product.discount?.percentage || 0) : 0;

  const fields = [
    { name: `${emojis.money} السعر`, value: `${price.toLocaleString()} ${config.currency.symbol}`, inline: true },
    { name: `${emojis.product} الفئة`, value: product.category, inline: true },
    { name: `${emojis.store} المتجر`, value: options.storeName || 'غير معروف', inline: true },
  ];

  if (product.stock !== -1) {
    fields.push({ name: '📦 المخزون', value: product.stock.toString(), inline: true });
  }

  if (isOnSale) {
    fields.unshift({
      name: '🔥 عرض',
      value: `خصم ${discount}% (كان ${product.price.toLocaleString()})`,
      inline: true,
    });
  }

  if (product.rating.count > 0) {
    fields.push({ name: `${emojis.star} التقييم`, value: `${product.rating.average.toFixed(1)} (${product.rating.count})`, inline: true });
  }

  return EmbedBuilderUtil.createBase({
    title: product.name,
    description: product.shortDescription || (product.description ? product.description.substring(0, 200) + '...' : 'لا يوجد وصف'),
    color: isOnSale ? colors.warning : colors.primary,
    image: product.images[0]?.url,
    fields,
    footer: { text: `معرف المنتج: ${product._id} • مبيعات: ${product.soldCount}` },
  });
}

function serviceCard(service, options = {}) {
  const price = service.finalPrice;
  const isOnSale = service.isOnSale;

  const fields = [
    { name: `${emojis.money} السعر`, value: `${price.toLocaleString()} ${config.currency.symbol}`, inline: true },
    { name: '📂 الفئة', value: EmbedBuilderUtil.getServiceCategoryName(service.category), inline: true },
    { name: '⏱️ وقت التسليم', value: `${service.deliveryTime} ${EmbedBuilderUtil.getTimeUnitName(service.deliveryTimeUnit)}`, inline: true },
    { name: '🔄 التعديلات', value: service.revisions.toString(), inline: true },
    { name: `${emojis.store} المتجر`, value: options.storeName || 'غير معروف', inline: true },
  ];

  if (isOnSale) {
    fields.unshift({
      name: '🔥 عرض',
      value: `خصم ${service.discount.percentage}%`,
      inline: true,
    });
  }

  if (service.rating.count > 0) {
    fields.push({ name: `${emojis.star} التقييم`, value: `${service.rating.average.toFixed(1)} (${service.rating.count})`, inline: true });
  }

  return EmbedBuilderUtil.createBase({
    title: `${emojis.service} ${service.name}`,
    description: service.shortDescription || (service.description ? service.description.substring(0, 200) + '...' : 'لا يوجد وصف'),
    color: isOnSale ? colors.warning : colors.purple,
    image: service.images[0]?.url,
    fields,
    footer: { text: `معرف الخدمة: ${service._id} • مبيعات: ${service.soldCount}` },
  });
}

EmbedBuilderUtil.productCard = productCard;
EmbedBuilderUtil.serviceCard = serviceCard;

module.exports = { productCard, serviceCard };
