const { EmbedBuilder, Colors } = require('discord.js');
const config = require('../config');

const { colors, emojis } = config;

class EmbedBuilderUtil {
  static createBase(options = {}) {
    const embed = new EmbedBuilder()
      .setColor(options.color || colors.primary)
      .setTimestamp();

    if (options.title) embed.setTitle(options.title);
    if (options.description) embed.setDescription(String(options.description));
    if (options.footer) embed.setFooter(options.footer);
    if (options.image) embed.setImage(options.image);
    if (options.thumbnail) embed.setThumbnail(options.thumbnail);
    if (options.author) embed.setAuthor(options.author);
    if (options.fields) embed.addFields(options.fields);

    return embed;
  }

  static success(title, description, options = {}) {
    return this.createBase({
      title: `${emojis.success} ${title}`,
      description,
      color: colors.success,
      ...options,
    });
  }

  static error(title, description, options = {}) {
    return this.createBase({
      title: `${emojis.error} ${title}`,
      description,
      color: colors.error,
      ...options,
    });
  }

  static warning(title, description, options = {}) {
    return this.createBase({
      title: `${emojis.warning} ${title}`,
      description,
      color: colors.warning,
      ...options,
    });
  }

  static info(title, description, options = {}) {
    return this.createBase({
      title: `${emojis.info} ${title}`,
      description,
      color: colors.info,
      ...options,
    });
  }

  static loading(title, description, options = {}) {
    return this.createBase({
      title: `${emojis.refresh} ${title}`,
      description,
      color: colors.info,
      ...options,
    });
  }

  static storeCard(store, options = {}) {
    const commissionRate = (store.commissionRate || 0) * 100;
    const trustEmoji = this.getTrustEmoji(options.ownerTrustLevel);
    const stats = store.stats || {};
    const rating = store.rating || {};

    const embed = this.createBase({
      title: `${emojis.store} ${store.name}`,
      description: store.description || '',
      color: this.getStoreColor(store.type),
      thumbnail: store.image,
      image: store.banner,
      fields: [
        { name: `${emojis.user} المالك`, value: `<@${store.ownerId}>`, inline: true },
        { name: `${emojis.product} المنتجات`, value: (stats.totalProducts || 0).toString(), inline: true },
        { name: `${emojis.money} المبيعات`, value: (stats.totalSales || 0).toString(), inline: true },
        { name: `${emojis.star} التقييم`, value: `${(rating.average || 0).toFixed(1)} (${rating.count || 0})`, inline: true },
        { name: `${emojis.money} العمولة`, value: `${commissionRate}%`, inline: true },
        { name: `${emojis.store} النوع`, value: this.getStoreTypeName(store.type), inline: true },
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

  static productCard(product, options = {}) {
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

    return this.createBase({
      title: product.name,
      description: product.shortDescription || (product.description ? product.description.substring(0, 200) + '...' : 'لا يوجد وصف'),
      color: isOnSale ? colors.warning : colors.primary,
      image: product.images[0]?.url,
      fields,
      footer: { text: `معرف المنتج: ${product._id} • مبيعات: ${product.soldCount}` },
    });
  }

  static serviceCard(service, options = {}) {
    const price = service.finalPrice;
    const isOnSale = service.isOnSale;

    const fields = [
      { name: `${emojis.money} السعر`, value: `${price.toLocaleString()} ${config.currency.symbol}`, inline: true },
      { name: '📂 الفئة', value: this.getServiceCategoryName(service.category), inline: true },
      { name: '⏱️ وقت التسليم', value: `${service.deliveryTime} ${this.getTimeUnitName(service.deliveryTimeUnit)}`, inline: true },
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

    return this.createBase({
      title: `${emojis.service} ${service.name}`,
      description: service.shortDescription || (service.description ? service.description.substring(0, 200) + '...' : 'لا يوجد وصف'),
      color: isOnSale ? colors.warning : colors.purple,
      image: service.images[0]?.url,
      fields,
      footer: { text: `معرف الخدمة: ${service._id} • مبيعات: ${service.soldCount}` },
    });
  }

  static orderCard(order, options = {}) {
    const statusEmoji = this.getOrderStatusEmoji(order.status);
    const statusName = this.getOrderStatusName(order.status);

    return this.createBase({
      title: `${statusEmoji} طلب #${order.orderNumber}`,
      description: `**${order.itemName}** × ${order.quantity}`,
      color: this.getOrderStatusColor(order.status),
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

  static walletCard(user, options = {}) {
    return this.createBase({
      title: `${emojis.wallet} محفظة ${options.username || 'المستخدم'}`,
      color: colors.gold,
      fields: [
        { name: `${emojis.money} الرصيد الحالي`, value: `${user.balance.toLocaleString()} ${config.currency.symbol}`, inline: true },
        { name: '📈 إجمالي الإنفاق', value: `${user.totalSpent.toLocaleString()} ${config.currency.symbol}`, inline: true },
        { name: '📉 إجمالي الأرباح', value: `${user.totalEarned.toLocaleString()} ${config.currency.symbol}`, inline: true },
        { name: '⭐ نقاط الولاء', value: user.loyaltyPoints.toLocaleString(), inline: true },
        { name: '🏆 مستوى الثقة', value: this.getTrustLevelName(user.trustLevel), inline: true },
      ],
      thumbnail: options.avatar,
    });
  }

  static dashboardCard(stats, options = {}) {
    return this.createBase({
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

  static aiResponse(title, response, options = {}) {
    return this.createBase({
      title: `${emojis.ai} ${title}`,
      description: response,
      color: colors.purple,
      footer: { text: `نموذج: ${options.model || 'Groq'} • رموز: ${options.tokens || 'N/A'}` },
    });
  }

  static ticketCard(ticket, options = {}) {
    const priorityEmoji = this.getPriorityEmoji(ticket.priority);
    const statusEmoji = this.getTicketStatusEmoji(ticket.status);

    return this.createBase({
      title: `${statusEmoji} تذكرة #${ticket.ticketNumber}`,
      description: ticket.subject,
      color: this.getPriorityColor(ticket.priority),
      fields: [
        { name: `${emojis.user} مقدم الطلب`, value: `<@${ticket.userId}>`, inline: true },
        { name: '🏷️ النوع', value: this.getTicketTypeName(ticket.type), inline: true },
        { name: `${priorityEmoji} الأولوية`, value: this.getPriorityName(ticket.priority), inline: true },
        { name: `${statusEmoji} الحالة`, value: this.getTicketStatusName(ticket.status), inline: true },
        { name: '👤 المعين', value: ticket.assignedTo ? `<@${ticket.assignedTo}>` : 'غير معين', inline: true },
        { name: '📅 الإنشاء', value: `<t:${Math.floor(ticket.createdAt / 1000)}:R>`, inline: true },
      ],
    });
  }

  static reviewCard(review, options = {}) {
    const stars = '⭐'.repeat(review.rating) + '☆'.repeat(5 - review.rating);

    return this.createBase({
      title: `${stars} ${review.title || 'بدون عنوان'}`,
      description: review.comment || 'بدون تعليق',
      color: colors.gold,
      fields: [
        { name: `${emojis.user} المراجع`, value: review.isAnonymous ? 'مجهول' : `<@${review.reviewerId}>`, inline: true },
        { name: `${emojis.product} ${review.type === 'product' ? 'منتج' : 'خدمة'}`, value: review.itemName, inline: true },
        { name: '✅ مشتري موثق', value: review.isVerifiedPurchase ? 'نعم' : 'لا', inline: true },
      ],
      footer: { text: `تاريخ المراجعة` },
      timestamp: review.createdAt,
    });
  }

  static marketplaceCard(data, options = {}) {
    const embed = this.createBase({
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

  static getStoreColor(type) {
    const typeColors = {
      free: 0x95A5A6,
      vip: 0x3498DB,
      premium: 0x9B59B6,
      verified: 0xF1C40F,
    };
    return typeColors[type] || colors.primary;
  }

  static getStoreTypeName(type) {
    const names = {
      free: 'مجاني',
      vip: 'VIP',
      premium: 'مميز',
      verified: 'موثق',
    };
    return names[type] || type;
  }

  static getTrustEmoji(level) {
    const emojis = {
      none: '',
      verified: '✅',
      trusted: '🏆',
      premium: '💎',
    };
    return emojis[level] || '';
  }

  static getTrustLevelName(level) {
    const names = {
      none: 'لا شيء',
      verified: 'موثق ✅',
      trusted: 'موثوق 🏆',
      premium: 'مميز 💎',
    };
    return names[level] || level;
  }

  static getServiceCategoryName(category) {
    const names = {
      programming: '💻 برمجة',
      design: '🎨 تصميم',
      translation: '🌐 ترجمة',
      video_editing: '🎬 مونتاج',
      hosting: '☁️ استضافة',
      marketing: '📢 تسويق',
      writing: '✍️ كتابة',
      music: '🎵 موسيقى',
      other: '📦 أخرى',
    };
    return names[category] || category;
  }

  static getTimeUnitName(unit) {
    const names = {
      hours: 'ساعة',
      days: 'يوم',
      weeks: 'أسبوع',
    };
    return names[unit] || unit;
  }

  static getOrderStatusEmoji(status) {
    const emojis = {
      pending: '⏳',
      paid: '✅',
      processing: '🔄',
      delivered: '📦',
      completed: '🎉',
      cancelled: '❌',
      refunded: '💸',
      disputed: '⚠️',
    };
    return emojis[status] || '❓';
  }

  static getOrderStatusName(status) {
    const names = {
      pending: 'في الانتظار',
      paid: 'مدفوع',
      processing: 'قيد المعالجة',
      delivered: 'تم التسليم',
      completed: 'مكتمل',
      cancelled: 'ملغي',
      refunded: 'مسترد',
      disputed: 'متنازع عليه',
    };
    return names[status] || status;
  }

  static getOrderStatusColor(status) {
    const statusColors = {
      pending: 0xF39C12,
      paid: 0x3498DB,
      processing: 0x9B59B6,
      delivered: 0x2ECC71,
      completed: 0x2ECC71,
      cancelled: 0xE74C3C,
      refunded: 0xE74C3C,
      disputed: 0xE67E22,
    };
    return statusColors[status] || colors.primary;
  }

  static getPriorityEmoji(priority) {
    const emojis = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      urgent: '🔴',
    };
    return emojis[priority] || '⚪';
  }

  static getPriorityColor(priority) {
    const priorityColors = {
      low: 0x2ECC71,
      medium: 0xF39C12,
      high: 0xE67E22,
      urgent: 0xE74C3C,
    };
    return priorityColors[priority] || colors.primary;
  }

  static getPriorityName(priority) {
    const names = {
      low: 'منخفضة',
      medium: 'متوسطة',
      high: 'عالية',
      urgent: 'عاجلة',
    };
    return names[priority] || priority;
  }

  static getTicketStatusEmoji(status) {
    const emojis = {
      open: '🟢',
      waiting_user: '🟡',
      waiting_staff: '🟠',
      in_progress: '🔵',
      resolved: '✅',
      closed: '🔴',
    };
    return emojis[status] || '⚪';
  }

  static getTicketStatusName(status) {
    const names = {
      open: 'مفتوحة',
      waiting_user: 'بانتظار المستخدم',
      waiting_staff: 'بانتظار الدعم',
      in_progress: 'قيد العمل',
      resolved: 'محلولة',
      closed: 'مغلقة',
    };
    return names[status] || status;
  }

  static getTicketTypeName(type) {
    const names = {
      support: 'دعم فني',
      report: 'بلاغ',
      dispute: 'نزاع',
      partnership: 'شراكة',
      verification: 'توثيق',
      technical: 'تقني',
      billing: 'فوترة',
      other: 'أخرى',
    };
    return names[type] || type;
  }

  static paymentCard(payment, options = {}) {
    const statusColors = {
      pending: colors.warning,
      awaiting_verification: colors.info,
      confirmed: colors.success,
      completed: colors.success,
      failed: colors.error,
      expired: colors.error,
      cancelled: colors.error,
      disputed: colors.warning,
    };
    return this.createBase({
      title: `${emojis.money} دفعة #${payment.paymentId}`,
      color: statusColors[payment.status] || colors.primary,
      fields: [
        { name: '💰 المبلغ', value: `${payment.amount.toLocaleString()} ${config.currency.symbol}`, inline: true },
        { name: '📊 الحالة', value: this.getPaymentStatusName(payment.status), inline: true },
        { name: '📦 العنصر', value: payment.itemName || 'N/A', inline: true },
        { name: '💸 العمولة', value: `${Math.round(payment.commissionRate * 100)}% (${payment.commissionAmount.toLocaleString()} ${config.currency.symbol})`, inline: true },
        { name: '👤 البائع', value: `<@${payment.sellerId}>`, inline: true },
        { name: '🔗 كود المرجع', value: `\`${payment.referenceCode}\``, inline: true },
        { name: '⏳ ينتهي', value: payment.expiresAt ? `<t:${Math.floor(payment.expiresAt / 1000)}:R>` : 'N/A', inline: true },
      ],
      footer: payment.status === 'pending' ? { text: '🔄 حول المبلغ ثم تحقق عبر /admin ← Payments' } : undefined,
    });
  }

  static withdrawalCard(withdrawal, options = {}) {
    const statusColors = {
      pending: colors.warning,
      approved: colors.success,
      rejected: colors.error,
      processing: colors.info,
      completed: colors.success,
      cancelled: colors.error,
    };
    return this.createBase({
      title: `${emojis.money} سحب #${withdrawal.withdrawalId}`,
      color: statusColors[withdrawal.status] || colors.primary,
      fields: [
        { name: '💰 المبلغ', value: `${withdrawal.amount.toLocaleString()} ${config.currency.symbol}`, inline: true },
        { name: '💳 الطريقة', value: withdrawal.paymentMethod || 'N/A', inline: true },
        { name: '📊 الحالة', value: this.getWithdrawalStatusName(withdrawal.status), inline: true },
        { name: '📅 الطلب', value: withdrawal.requestedAt ? `<t:${Math.floor(withdrawal.requestedAt / 1000)}:F>` : 'N/A', inline: true },
        { name: '📝 التفاصيل', value: withdrawal.notes || 'بدون', inline: true },
      ],
    });
  }

  static commissionCard(commission, options = {}) {
    return this.createBase({
      title: '💸 عمولة',
      color: colors.gold,
      fields: [
        { name: '💰 المبلغ', value: `${commission.amount.toLocaleString()} ${config.currency.symbol}`, inline: true },
        { name: '📊 النسبة', value: `${Math.round(commission.rate * 100)}%`, inline: true },
        { name: '🏪 المتجر', value: commission.storeName || 'N/A', inline: true },
        { name: '👤 البائع', value: `<@${commission.sellerId}>`, inline: true },
        { name: '🏷️ نوع المتجر', value: this.getStoreTypeName(commission.storeType), inline: true },
      ],
    });
  }

  static getPaymentStatusName(status) {
    const names = {
      pending: '⏳ في انتظار الدفع',
      awaiting_verification: '🔍 قيد المراجعة',
      confirmed: '✅ تم التأكيد',
      completed: '✅ مكتملة',
      failed: '❌ فشلت',
      expired: '⏰ منتهية',
      cancelled: '🚫 ملغية',
      disputed: '⚠️ متنازع عليها',
    };
    return names[status] || status;
  }

  static getWithdrawalStatusName(status) {
    const names = {
      pending: '⏳ معلق',
      approved: '✅ تمت الموافقة',
      rejected: '❌ مرفوض',
      processing: '🔄 قيد المعالجة',
      completed: '✅ مكتمل',
      cancelled: '🚫 ملغي',
    };
    return names[status] || status;
  }
}

module.exports = { EmbedBuilderUtil };