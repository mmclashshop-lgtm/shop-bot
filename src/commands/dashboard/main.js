const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { Store, Product, Service, Order, Transaction, Review, User } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { formatCurrency, formatNumber } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const BalanceService = require('../../services/BalanceService');
const CommissionService = require('../../services/CommissionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('لوحة تحكم الماركت بليس')
    .addSubcommand(sub =>
      sub.setName('overview')
        .setDescription('نظرة عامة على الإحصائيات')
    )
    .addSubcommand(sub =>
      sub.setName('store')
        .setDescription('إحصائيات متجر محدد')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('seller')
        .setDescription('إحصائيات بائع')
        .addUserOption(opt => opt.setName('user').setDescription('البائع'))
    )
    .addSubcommand(sub =>
      sub.setName('revenue')
        .setDescription('تقرير الإيرادات')
        .addStringOption(opt => opt.setName('period').setDescription('الفترة').addChoices(
          { name: 'اليوم', value: 'day' },
          { name: 'الأسبوع', value: 'week' },
          { name: 'الشهر', value: 'month' },
          { name: 'السنة', value: 'year' }
        ))
    )
    .addSubcommand(sub =>
      sub.setName('top')
        .setDescription('الأعلى أداءً')
        .addStringOption(opt => opt.setName('type').setDescription('النوع').addChoices(
          { name: 'متاجر', value: 'stores' },
          { name: 'منتجات', value: 'products' },
          { name: 'خدمات', value: 'services' },
          { name: 'بائعين', value: 'sellers' }
        ).setRequired(true))
        .addIntegerOption(opt => opt.setName('limit').setDescription('العدد').setMinValue(1).setMaxValue(20))
    )
    .addSubcommand(sub =>
      sub.setName('export')
        .setDescription('تصدير تقرير')
        .addStringOption(opt => opt.setName('type').setDescription('نوع التقرير').setRequired(true).addChoices(
          { name: '📊 الطلبات', value: 'orders' },
          { name: '💰 المعاملات', value: 'transactions' },
          { name: '📦 المنتجات', value: 'products' },
        ))
        .addStringOption(opt => opt.setName('format').setDescription('صيغة التصدير').setRequired(true).addChoices(
          { name: 'CSV', value: 'csv' },
          { name: 'JSON', value: 'json' },
        ))
    )
    .addSubcommand(sub =>
      sub.setName('financial')
        .setDescription('التقرير المالي شامل العمولات والأرباح')
        .addStringOption(opt => opt.setName('period').setDescription('الفترة').addChoices(
          { name: 'هذا الشهر', value: 'month' },
          { name: 'هذا الأسبوع', value: 'week' },
          { name: 'اليوم', value: 'day' },
          { name: 'هذا العام', value: 'year' },
        ).setRequired(true))
    ),

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'overview':
        await this.handleOverview(interaction, client);
        break;
      case 'store':
        await this.handleStoreStats(interaction, client);
        break;
      case 'seller':
        await this.handleSellerStats(interaction, client);
        break;
      case 'revenue':
        await this.handleRevenueReport(interaction, client);
        break;
      case 'top':
        await this.handleTopPerformers(interaction, client);
        break;
      case 'export':
        await this.handleExport(interaction, client);
        break;
      case 'financial':
        await this.handleFinancial(interaction, client);
        break;
    }
  },

  async handleOverview(interaction, client) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 هذه اللوحة للمشرفين فقط.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const isAdmin = true;

    const Payment = require('../../database/models/Payment');
    const Withdrawal = require('../../database/models/Withdrawal');

    const [
      totalStores,
      activeStores,
      totalProducts,
      activeProducts,
      totalServices,
      activeServices,
      totalUsers,
      totalOrders,
      completedOrders,
      pendingOrders,
      totalRevenue,
      totalCommission,
      avgRating,
      recentOrders,
      recentReviews,
      paymentStats,
      withdrawalStats,
      platformEarningsTotal,
    ] = await Promise.all([
      Store.countDocuments(),
      Store.countDocuments({ isActive: true, isSuspended: false }),
      Product.countDocuments(),
      Product.countDocuments({ isActive: true }),
      Service.countDocuments(),
      Service.countDocuments({ isActive: true }),
      User.countDocuments(),
      Order.countDocuments(),
      Order.countDocuments({ status: 'completed' }),
      Order.countDocuments({ status: { $in: ['pending', 'paid', 'processing'] } }),
      Order.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Transaction.aggregate([{ $match: { type: 'commission', status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Review.aggregate([{ $match: { isHidden: false } }, { $group: { _id: null, avg: { $avg: '$rating' } } }]),
      Order.find({}).sort({ createdAt: -1 }).limit(5).lean(),
      Review.find({ isHidden: false }).sort({ createdAt: -1 }).limit(5).populate('itemId', 'name').lean(),
      Payment.aggregate([
        { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'expired']] }, 1, 0] } }, totalRevenue: { $sum: '$amount' }, totalCommission: { $sum: '$commissionAmount' } } },
      ]),
      Withdrawal.aggregate([
        { $group: { _id: null, total: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, totalAmount: { $sum: '$amount' } } },
      ]),
      User.aggregate([
        { $group: { _id: null, total: { $sum: { $ifNull: ['$platformEarnings', 0] } } } },
      ]),
    ]);

    const embed = EmbedBuilderUtil.dashboardCard({
      totalStores,
      totalProducts,
      totalServices,
      totalSales: completedOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
      totalCommission: totalCommission[0]?.total || 0,
      totalUsers,
      totalOrders,
      averageRating: avgRating[0]?.avg || 0,
    }, { botAvatar: client.user.displayAvatarURL() });

    const pStats = paymentStats[0] || { total: 0, completed: 0, failed: 0, totalRevenue: 0, totalCommission: 0 };
    const wStats = withdrawalStats[0] || { total: 0, pending: 0, completed: 0, totalAmount: 0 };
    const eStats = platformEarningsTotal[0] || { total: 0 };
    const paymentSuccessRate = pStats.total > 0 ? ((pStats.completed / pStats.total) * 100).toFixed(1) : 'N/A';

    embed.addFields(
      { name: '🏪 متاجر نشطة', value: activeStores.toString(), inline: true },
      { name: '📦 منتجات نشطة', value: activeProducts.toString(), inline: true },
      { name: '💼 خدمات نشطة', value: activeServices.toString(), inline: true },
      { name: '⏳ طلبات معلقة', value: pendingOrders.toString(), inline: true },
      { name: '✅ طلبات مكتملة', value: completedOrders.toString(), inline: true },
      { name: '📊 معدل التحويل', value: totalOrders > 0 ? `${((completedOrders / totalOrders) * 100).toFixed(1)}%` : '0%', inline: true },
    );

    embed.addFields(
      { name: '─────────────────', value: '**الإحصائيات المالية**', inline: false },
      { name: '💰 إيرادات المنصة', value: formatCurrency(pStats.totalRevenue || 0), inline: true },
      { name: '💸 إجمالي العمولات', value: formatCurrency(pStats.totalCommission || 0), inline: true },
      { name: '🏦 رصيد البائعين', value: formatCurrency(eStats.total || 0), inline: true },
      { name: '💳 المدفوعات', value: `${pStats.total} (نجاح ${paymentSuccessRate}%)`, inline: true },
      { name: '⏳ سحوبات معلقة', value: wStats.pending.toString(), inline: true },
      { name: '✅ سحوبات مكتملة', value: wStats.completed.toString(), inline: true },
    );

    if (recentOrders.length > 0) {
      embed.addFields({
        name: '📋 أحدث الطلبات',
        value: recentOrders.map(o => `• #${o.orderNumber} - ${formatCurrency(o.total)} - ${o.status}`).join('\n'),
        inline: false,
      });
    }

    if (recentReviews.length > 0) {
      embed.addFields({
        name: '⭐ أحدث التقييمات',
        value: recentReviews.map(r => `• ${'⭐'.repeat(r.rating)} **${r.itemName}** - ${r.comment?.substring(0, 50) || 'بدون تعليق'}`).join('\n'),
        inline: false,
      });
    }

    const { ActionRowBuilder } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dashboard_revenue')
        .setLabel('تقرير الإيرادات')
        .setEmoji(config.emojis.money)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('dashboard_top_stores')
        .setLabel('أفضل المتاجر')
        .setEmoji(config.emojis.store)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dashboard_top_products')
        .setLabel('أفضل المنتجات')
        .setEmoji(config.emojis.product)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dashboard_top_sellers')
        .setLabel('أفضل البائعين')
        .setEmoji(config.emojis.user)
        .setStyle(ButtonStyle.Secondary),
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  },

  async handleStoreStats(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const store = await Store.findById(storeId).lean();

    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.' });
    }

    const isOwner = store.ownerId === interaction.user.id;
    const isAdmin = interaction.memberPermissions.has('Administrator');

    if (!isOwner && !isAdmin) {
      return interaction.editReply({ content: '🚫 غير مصرح: يمكنك رؤية إحصائيات متاجرك فقط.' });
    }

    const [productsCount, servicesCount, ordersCount, completedOrders, totalRevenue, totalCommission, avgRating, topProducts, recentOrders] = await Promise.all([
      Product.countDocuments({ storeId: store._id, isActive: true }),
      Service.countDocuments({ storeId: store._id, isActive: true }),
      Order.countDocuments({ storeId: store._id }),
      Order.countDocuments({ storeId: store._id, status: 'completed' }),
      Order.aggregate([{ $match: { storeId: store._id, status: 'completed' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Transaction.aggregate([{ $match: { 'reference.storeId': store._id, type: 'commission', status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Review.aggregate([{ $match: { storeId: store._id, isHidden: false } }, { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }]),
      Product.find({ storeId: store._id, isActive: true }).sort({ soldCount: -1 }).limit(5).lean(),
      Order.find({ storeId: store._id }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.chart} إحصائيات ${store.name}`)
      .setColor(this.getStoreColor(store.type))
      .addFields(
        { name: '📦 منتجات', value: productsCount.toString(), inline: true },
        { name: '💼 خدمات', value: servicesCount.toString(), inline: true },
        { name: '🛒 إجمالي الطلبات', value: ordersCount.toString(), inline: true },
        { name: '✅ مكتملة', value: completedOrders.toString(), inline: true },
        { name: '💰 إجمالي الإيرادات', value: formatCurrency(totalRevenue[0]?.total || 0), inline: true },
        { name: '💸 العمولات المدفوعة', value: formatCurrency(totalCommission[0]?.total || 0), inline: true },
        { name: '⭐ التقييم', value: `${(avgRating[0]?.avg || 0).toFixed(1)} (${avgRating[0]?.count || 0})`, inline: true },
        { name: '👁️ المشاهدات', value: formatNumber(store.stats.totalViews), inline: true },
        { name: '📊 معدل التحويل', value: ordersCount > 0 ? `${((completedOrders / ordersCount) * 100).toFixed(1)}%` : '0%', inline: true },
      )
      .setTimestamp();

    if (topProducts.length > 0) {
      embed.addFields({
        name: '🏆 أفضل المنتجات',
        value: topProducts.map((p, i) => `${i + 1}. **${p.name}** - ${formatCurrency(p.finalPrice)} - 🛒 ${p.soldCount}`).join('\n'),
        inline: false,
      });
    }

    if (recentOrders.length > 0) {
      embed.addFields({
        name: '📋 أحدث الطلبات',
        value: recentOrders.map(o => `• #${o.orderNumber} - ${formatCurrency(o.total)} - ${o.status}`).join('\n'),
        inline: false,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },

  async handleSellerStats(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user') || interaction.user;

    if (targetUser.id !== interaction.user.id && !interaction.memberPermissions.has('Administrator')) {
      return interaction.editReply({ content: '🚫 يمكنك رؤية إحصائياتك فقط.' });
    }

    const user = await User.findOne({ discordId: targetUser.id }).lean();

    if (!user) {
      return interaction.editReply({ content: '❌ المستخدم غير مسجل.' });
    }

    const stores = await Store.find({ ownerId: targetUser.id, isActive: true }).lean();

    const [totalOrders, completedOrders, totalRevenue, avgRating, recentOrders] = await Promise.all([
      Order.countDocuments({ sellerId: targetUser.id }),
      Order.countDocuments({ sellerId: targetUser.id, status: 'completed' }),
      Order.aggregate([{ $match: { sellerId: targetUser.id, status: 'completed' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Review.aggregate([{ $match: { sellerId: targetUser.id, isHidden: false } }, { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }]),
      Order.find({ sellerId: targetUser.id }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    const platformEarnings = user.platformEarnings || 0;
    const totalEarned = user.totalEarned || 0;

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.user} إحصائيات البائع: ${targetUser.username}`)
      .setColor(this.getTrustColor(user.trustLevel))
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '🏆 مستوى الثقة', value: this.getTrustName(user.trustLevel), inline: true },
        { name: '🏪 عدد المتاجر', value: stores.length.toString(), inline: true },
        { name: '🛒 إجمالي الطلبات', value: totalOrders.toString(), inline: true },
        { name: '✅ مكتملة', value: completedOrders.toString(), inline: true },
        { name: '💰 إجمالي الأرباح', value: formatCurrency(totalRevenue[0]?.total || 0), inline: true },
        { name: '🏦 رصيد معلق', value: formatCurrency(platformEarnings), inline: true },
        { name: '📈 كل الأرباح', value: formatCurrency(totalEarned), inline: true },
        { name: '⭐ التقييم', value: `${(avgRating[0]?.avg || 0).toFixed(1)} (${avgRating[0]?.count || 0})`, inline: true },
        { name: '📝 التقييمات', value: user.stats.totalReviews.toString(), inline: true },
        { name: '📊 معدل الإنجاز', value: totalOrders > 0 ? `${((completedOrders / totalOrders) * 100).toFixed(1)}%` : '0%', inline: true },
      )
      .setTimestamp();

    if (stores.length > 0) {
      embed.addFields({
        name: '🏪 المتاجر',
        value: stores.map(s => `• **${s.name}** (${s.type}) - ${s.stats.totalSales} مبيعات - ${formatCurrency(s.stats.totalRevenue)}`).join('\n'),
        inline: false,
      });
    }

    if (recentOrders.length > 0) {
      embed.addFields({
        name: '📋 أحدث المبيعات',
        value: recentOrders.map(o => `• #${o.orderNumber} - ${formatCurrency(o.total)} - ${o.itemName}`).join('\n'),
        inline: false,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },

  async handleFinancial(interaction, client) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 التقرير المالي للمشرفين فقط.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const period = interaction.options.getString('period') || 'month';
    const now = new Date();
    let startDate;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
    }

    try {
      const monthlyRevenue = await BalanceService.getMonthlyRevenue(period);
      const topSellers = await BalanceService.getTopSellers(5);
      const topStores = await BalanceService.getTopStores(5);
      const totalPlatformEarnings = await User.aggregate([
        { $group: { _id: null, total: { $sum: '$platformEarnings' }, totalEarned: { $sum: '$totalEarned' } } },
      ]);

      const commissionSummary = await CommissionService.getCommissionSummary(startDate);

      const embed = new EmbedBuilder()
        .setTitle(`${config.emojis.chart} التقرير المالي (${period === 'day' ? 'اليوم' : period === 'week' ? 'الأسبوع' : period === 'month' ? 'الشهر' : 'السنة'})`)
        .setColor(config.colors.gold)
        .addFields(
          { name: '💰 صافي أرباح المنصة', value: formatCurrency(monthlyRevenue?.totalCommission || 0), inline: true },
          { name: '📦 إجمالي الأرباح', value: formatCurrency(totalPlatformEarnings[0]?.totalEarned || 0), inline: true },
          { name: '🏦 رصيد البائعين (معلق)', value: formatCurrency(totalPlatformEarnings[0]?.platformEarnings || 0), inline: true },
          { name: '💸 عمولات الفترة', value: formatCurrency(commissionSummary?.totalCommission || 0), inline: true },
          { name: '🏪 عدد المتاجر النشطة', value: formatNumber(commissionSummary?.storeCount || 0), inline: true },
          { name: '🛒 عدد العمليات', value: formatNumber(commissionSummary?.commissionCount || 0), inline: true },
        )
        .setTimestamp();

      if (topSellers.length > 0) {
        embed.addFields({
          name: '🏆 أفضل البائعين',
          value: topSellers.map((s, i) => `${i + 1}. <@${s.userId}> - أرباح: ${formatCurrency(s.totalEarnings)}`).join('\n'),
          inline: false,
        });
      }

      if (topStores.length > 0) {
        embed.addFields({
          name: '🏪 أفضل المتاجر إيراداً',
          value: topStores.map((s, i) => `${i + 1}. **${s.name}** - ${formatCurrency(s.totalEarnings)}`).join('\n'),
          inline: false,
        });
      }

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Financial report error', { error: error.message });
      return interaction.editReply({ content: `❌ خطأ: ${error.message}` });
    }
  },

  async handleRevenueReport(interaction, client) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 تقرير الإيرادات للمشرفين فقط.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const period = interaction.options.getString('period') || 'month';
    const now = new Date();
    let startDate, groupFormat;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        groupFormat = '%H:00';
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        groupFormat = '%Y-%m-%d';
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        groupFormat = '%Y-%m-%d';
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        groupFormat = '%Y-%m';
        break;
    }

    const [revenueByPeriod, commissionByPeriod, ordersByPeriod, topStoresByRevenue] = await Promise.all([
      Order.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format: groupFormat, date: '$createdAt' } }, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { type: 'commission', status: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format: groupFormat, date: '$createdAt' } }, commission: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format: groupFormat, date: '$createdAt' } }, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: '$storeId', revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
        { $lookup: { from: 'stores', localField: '_id', foreignField: '_id', as: 'store' } },
        { $unwind: '$store' },
        { $project: { storeName: '$store.name', type: '$store.type', revenue: 1, orders: 1 } },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const totalRevenue = revenueByPeriod.reduce((sum, r) => sum + r.revenue, 0);
    const totalCommission = commissionByPeriod.reduce((sum, c) => sum + c.commission, 0);
    const totalOrders = ordersByPeriod.reduce((sum, o) => sum + o.total, 0);
    const completedOrders = ordersByPeriod.reduce((sum, o) => sum + o.completed, 0);

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.chart} تقرير الإيرادات (${period})`)
      .setColor(config.colors.gold)
      .addFields(
        { name: '💰 إجمالي الإيرادات', value: formatCurrency(totalRevenue), inline: true },
        { name: '💸 إجمالي العمولات', value: formatCurrency(totalCommission), inline: true },
        { name: '📦 إجمالي الطلبات', value: formatNumber(totalOrders), inline: true },
        { name: '✅ مكتملة', value: formatNumber(completedOrders), inline: true },
        { name: '📊 معدل التحويل', value: totalOrders > 0 ? `${((completedOrders / totalOrders) * 100).toFixed(1)}%` : '0%', inline: true },
        { name: '📈 متوسط الطلب', value: completedOrders > 0 ? formatCurrency(totalRevenue / completedOrders) : '0', inline: true },
      );

    if (revenueByPeriod.length > 0) {
      embed.addFields({
        name: '📅 التفصيل حسب الفترة',
        value: revenueByPeriod.slice(-10).map(r => `• **${r._id}**: ${formatCurrency(r.revenue)} (${r.orders} طلب)`).join('\n'),
        inline: false,
      });
    }

    if (topStoresByRevenue.length > 0) {
      embed.addFields({
        name: '🏪 أعلى المتاجر إيراداً',
        value: topStoresByRevenue.map((s, i) => `${i + 1}. **${s.storeName}** (${s.type}) - ${formatCurrency(s.revenue)} - ${s.orders} طلب`).join('\n'),
        inline: false,
      });
    }

    embed.setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleTopPerformers(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const type = interaction.options.getString('type');
    const limit = interaction.options.getInteger('limit') || 10;

    let data = [];
    let title = '';
    let color = config.colors.primary;

    switch (type) {
      case 'stores':
        data = await Store.find({ isActive: true, isSuspended: false }).lean()
          .sort({ 'stats.totalRevenue': -1 })
          .limit(limit)
          .lean();
        title = `أفضل ${limit} متاجر إيراداً`;
        color = config.colors.gold;
        break;
      case 'products':
        data = await Product.find({ isActive: true }).lean()
          .sort({ soldCount: -1 })
          .limit(limit)
          .populate('storeId', 'name')
          .lean();
        title = `أفضل ${limit} منتجات مبيعاً`;
        color = config.colors.primary;
        break;
      case 'services':
        data = await Service.find({ isActive: true }).lean()
          .sort({ soldCount: -1 })
          .limit(limit)
          .populate('storeId', 'name')
          .lean();
        title = `أفضل ${limit} خدمات مبيعاً`;
        color = config.colors.purple;
        break;
      case 'sellers':
        data = await User.find({ 'stats.totalSales': { $gt: 0 } }).lean()
          .sort({ 'stats.totalSales': -1 })
          .limit(limit)
          .lean();
        title = `أفضل ${limit} بائعين`;
        color = config.colors.info;
        break;
    }

    if (data.length === 0) {
      return interaction.editReply({ content: '📭 لا توجد بيانات.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.chart} ${title}`)
      .setColor(color)
      .setTimestamp();

    if (type === 'stores') {
      embed.setDescription(data.map((d, i) => `${i + 1}. **${d.name}** (${d.type}) - 💰 ${formatCurrency(d.stats.totalRevenue)} - 🛒 ${d.stats.totalSales} - ⭐ ${d.rating.average.toFixed(1)}`).join('\n'));
    } else if (type === 'products') {
      embed.setDescription(data.map((d, i) => `${i + 1}. **${d.name}** - ${formatCurrency(d.finalPrice)} - 🏪 ${d.storeId?.name} - 🛒 ${d.soldCount}`).join('\n'));
    } else if (type === 'services') {
      embed.setDescription(data.map((d, i) => `${i + 1}. **${d.name}** - ${formatCurrency(d.finalPrice)} - 🏪 ${d.storeId?.name} - 🛒 ${d.soldCount}`).join('\n'));
    } else {
      embed.setDescription(data.map((d, i) => `${i + 1}. **${d.username}** (${this.getTrustName(d.trustLevel)}) - 🛒 ${d.stats.totalSales} - 💰 ${formatCurrency(d.totalEarned)} - ⭐ ${d.stats.averageRating.toFixed(1)}`).join('\n'));
    }

    return interaction.editReply({ embeds: [embed] });
  },

  async handleExport(interaction, client) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 هذا الأمر للمشرفين فقط.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const type = interaction.options.getString('type');
    const format = interaction.options.getString('format');
    const ExportUtil = require('../../utils/export');

    try {
      let data;
      let filename;
      let content;

      if (type === 'orders') {
        const { Order } = require('../../database/models');
        data = await Order.find({}).sort({ createdAt: -1 }).limit(1000).lean();
        content = ExportUtil.exportOrders(data);
        filename = `orders_${Date.now()}`;
      } else if (type === 'transactions') {
        const { Transaction } = require('../../database/models');
        data = await Transaction.find({}).sort({ createdAt: -1 }).limit(1000).lean();
        content = ExportUtil.exportTransactions(data);
        filename = `transactions_${Date.now()}`;
      } else if (type === 'products') {
        const { Product } = require('../../database/models');
        data = await Product.find({}).sort({ soldCount: -1 }).limit(1000).lean();
        content = ExportUtil.exportProducts(data);
        filename = `products_${Date.now()}`;
      }

      if (format === 'json') {
        content = ExportUtil.toJSON(data);
      }

      const attachment = ExportUtil.createAttachment(content, filename, format);
      await interaction.editReply({ content: `✅ تم تصدير ${data.length} سجل.`, files: [attachment] });
    } catch (error) {
      logger.error('Export error', { error: error.message });
      await interaction.editReply({ content: `❌ خطأ في التصدير: ${error.message}` });
    }
  },

  getStoreColor(type) {
    const colors = {
      free: 0x95A5A6,
      vip: 0x3498DB,
      premium: 0x9B59B6,
      verified: 0xF1C40F,
    };
    return colors[type] || config.colors.primary;
  },

  getTrustColor(level) {
    const colors = {
      none: 0x95A5A6,
      verified: 0x2ECC71,
      trusted: 0xF1C40F,
      premium: 0x9B59B6,
    };
    return colors[level] || colors.none;
  },

  getTrustName(level) {
    const names = {
      none: 'لا شيء',
      verified: 'موثق ✅',
      trusted: 'موثوق 🏆',
      premium: 'مميز 💎',
    };
    return names[level] || level;
  },
};
