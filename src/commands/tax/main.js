const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { MarketplaceSettings, Store, Transaction, User } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { formatCurrency, formatNumber } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tax')
    .setDescription('إدارة العمولات والضرائب')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('عرض إعدادات العمولات الحالية')
    )
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('تعديل نسبة عمولة')
        .addStringOption(opt => opt.setName('type').setDescription('نوع المتجر').setRequired(true).addChoices(
          { name: 'مجاني (Free)', value: 'free' },
          { name: 'VIP', value: 'vip' },
          { name: 'مميز (Premium)', value: 'premium' },
          { name: 'موثق (Verified)', value: 'verified' }
        ))
        .addNumberOption(opt => opt.setName('rate').setDescription('نسبة العمولة (0-1)').setRequired(true).setMinValue(0).setMaxValue(1))
    )
    .addSubcommand(sub =>
      sub.setName('account')
        .setDescription('تعيين حساب استلام العمولات')
        .addUserOption(opt => opt.setName('user').setDescription('المستخدم').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('fees')
        .setDescription('تعيين رسوم إنشاء المتاجر')
        .addNumberOption(opt => opt.setName('free').setDescription('رسوم مجاني').setMinValue(0))
        .addNumberOption(opt => opt.setName('vip').setDescription('رسوم VIP').setMinValue(0))
        .addNumberOption(opt => opt.setName('premium').setDescription('رسوم مميز').setMinValue(0))
        .addNumberOption(opt => opt.setName('verified').setDescription('رسوم موثق').setMinValue(0))
    )
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('إحصائيات العمولات')
        .addStringOption(opt => opt.setName('period').setDescription('الفترة').addChoices(
          { name: 'اليوم', value: 'day' },
          { name: 'الأسبوع', value: 'week' },
          { name: 'الشهر', value: 'month' },
          { name: 'الكل', value: 'all' }
        ))
    )
    .addSubcommand(sub =>
      sub.setName('collect')
        .setDescription('تحصيل العمولات المعلقة')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر (اختياري)'))
    ),

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'view':
        await this.handleView(interaction, client);
        break;
      case 'set':
        await this.handleSet(interaction, client);
        break;
      case 'account':
        await this.handleAccount(interaction, client);
        break;
      case 'fees':
        await this.handleFees(interaction, client);
        break;
      case 'stats':
        await this.handleStats(interaction, client);
        break;
      case 'collect':
        await this.handleCollect(interaction, client);
        break;
    }
  },

  async handleView(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    let settings = await MarketplaceSettings.findOne().lean();
    if (!settings) {
      settings = await MarketplaceSettings.create({ guildId: interaction.guildId });
    }

    const taxAccount = settings.taxAccountId ? await client.users.fetch(settings.taxAccountId).catch(() => null) : null;

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.settings} إعدادات العمولات`)
      .setColor(config.colors.primary)
      .addFields(
        { name: '🆓 مجاني', value: `${(settings.commissions.free * 100).toFixed(1)}%`, inline: true },
        { name: '💎 VIP', value: `${(settings.commissions.vip * 100).toFixed(1)}%`, inline: true },
        { name: '⭐ مميز', value: `${(settings.commissions.premium * 100).toFixed(1)}%`, inline: true },
        { name: '✅ موثق', value: `${(settings.commissions.verified * 100).toFixed(1)}%`, inline: true },
        { name: '💰 رسوم مجاني', value: formatCurrency(settings.storeCreationFee.free), inline: true },
        { name: '💰 رسوم VIP', value: formatCurrency(settings.storeCreationFee.vip), inline: true },
        { name: '💰 رسوم مميز', value: formatCurrency(settings.storeCreationFee.premium), inline: true },
        { name: '💰 رسوم موثق', value: formatCurrency(settings.storeCreationFee.verified), inline: true },
        { name: '🏦 حساب العمولات', value: taxAccount ? `${taxAccount.username} (${taxAccount.id})` : 'غير محدد', inline: false },
        { name: '📋 رسوم مميزة', value: `قائمة مميزة: ${formatCurrency(settings.featuredListingFee)}\nتوثيق: ${formatCurrency(settings.verificationFee)}`, inline: false },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleSet(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const type = interaction.options.getString('type');
    const rate = interaction.options.getNumber('rate');

    let settings = await MarketplaceSettings.findOne().lean();
    if (!settings) {
      settings = await MarketplaceSettings.create({ guildId: interaction.guildId });
    }

    settings.commissions[type] = rate;
    await settings.save();

    logger.info('Commission rate updated', { type, rate, by: interaction.user.id });

    return interaction.editReply({
      content: `✅ تم تحديث عمولة **${type}** إلى **${(rate * 100).toFixed(1)}%**.`,
    });
  },

  async handleAccount(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('user');

    let settings = await MarketplaceSettings.findOne().lean();
    if (!settings) {
      settings = await MarketplaceSettings.create({ guildId: interaction.guildId });
    }

    settings.taxAccountId = user.id;
    await settings.save();

    const taxUser = await User.findOne({ discordId: user.id }).lean();
    if (!taxUser) {
      await User.create({
        discordId: user.id,
        username: user.username,
        balance: 0,
      });
    }

    logger.info('Tax account updated', { accountId: user.id, by: interaction.user.id });

    return interaction.editReply({
      content: `✅ تم تعيين **${user.username}** كحساب استلام العمولات.`,
    });
  },

  async handleFees(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const free = interaction.options.getNumber('free');
    const vip = interaction.options.getNumber('vip');
    const premium = interaction.options.getNumber('premium');
    const verified = interaction.options.getNumber('verified');

    let settings = await MarketplaceSettings.findOne().lean();
    if (!settings) {
      settings = await MarketplaceSettings.create({ guildId: interaction.guildId });
    }

    if (free !== null) settings.storeCreationFee.free = free;
    if (vip !== null) settings.storeCreationFee.vip = vip;
    if (premium !== null) settings.storeCreationFee.premium = premium;
    if (verified !== null) settings.storeCreationFee.verified = verified;

    await settings.save();

    return interaction.editReply({
      content: '✅ تم تحديث رسوم إنشاء المتاجر.',
    });
  },

  async handleStats(interaction, client) {
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
      default:
        startDate = new Date(0);
    }

    const [totalCommission, byType, byStore, topStores, recentTransactions] = await Promise.all([
      Transaction.aggregate([
        { $match: { type: 'commission', status: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Transaction.aggregate([
        { $match: { type: 'commission', status: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: '$reference.storeId', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $lookup: { from: 'stores', localField: '_id', foreignField: '_id', as: 'store' } },
        { $unwind: '$store' },
        { $project: { storeName: '$store.name', type: '$store.type', total: 1, count: 1 } },
        { $sort: { total: -1 } },
      ]),
      Transaction.aggregate([
        { $match: { type: { $in: ['commission', 'sale'] }, status: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: '$reference.storeId', commission: { $sum: { $cond: [{ $eq: ['$type', 'commission'] }, '$amount', 0] } }, sales: { $sum: { $cond: [{ $eq: ['$type', 'sale'] }, '$amount', 0] } }, count: { $sum: 1 } } },
        { $lookup: { from: 'stores', localField: '_id', foreignField: '_id', as: 'store' } },
        { $unwind: '$store' },
        { $project: { storeName: '$store.name', type: '$store.type', commission: 1, sales: 1, count: 1 } },
        { $sort: { commission: -1 } },
        { $limit: 10 },
      ]),
      Store.find({ isActive: true, isSuspended: false }).lean()
        .sort({ 'stats.totalCommission': -1 })
        .limit(10)
        .select('name type stats.totalCommission stats.totalSales stats.totalRevenue')
        .lean(),
      Transaction.find({ type: 'commission', status: 'completed', createdAt: { $gte: startDate } }).lean()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('reference.storeId', 'name')
        .lean(),
    ]);

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.chart} إحصائيات العمولات (${period})`)
      .setColor(config.colors.gold)
      .addFields(
        { name: '💸 إجمالي العمولات', value: formatCurrency(totalCommission[0]?.total || 0), inline: true },
        { name: '📊 عدد العمليات', value: formatNumber(totalCommission[0]?.count || 0), inline: true },
      );

    if (byStore.length > 0) {
      embed.addFields({
        name: '🏪 أعلى المتاجر عمولة',
        value: byStore.slice(0, 5).map((s, i) => `${i + 1}. **${s.storeName}** (${s.type}) - ${formatCurrency(s.commission)} (${s.count} عملية)`).join('\n'),
        inline: false,
      });
    }

    if (topStores.length > 0) {
      embed.addFields({
        name: '🏆 أعلى المتاجر تراكمياً',
        value: topStores.map((s, i) => `${i + 1}. **${s.name}** (${s.type}) - ${formatCurrency(s.stats.totalCommission)} عمولة - ${s.stats.totalSales} مبيعات`).join('\n'),
        inline: false,
      });
    }

    if (recentTransactions.length > 0) {
      embed.addFields({
        name: '📋 أحدث عمليات التحصيل',
        value: recentTransactions.map(t => `• ${formatCurrency(t.amount)} من **${t.reference.storeId?.name || 'غير معروف'}** - <t:${Math.floor(t.createdAt / 1000)}:R>`).join('\n'),
        inline: false,
      });
    }

    embed.setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleCollect(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const settings = await MarketplaceSettings.findOne().lean();

    if (!settings?.taxAccountId) {
      return interaction.editReply({ content: '❌ لم يتم تعيين حساب استلام العمولات. استخدم /admin ← Settings.' });
    }

    const query = { type: 'sale', status: 'completed' };
    if (storeId) query['reference.storeId'] = storeId;

    const pendingSales = await Transaction.find(query).lean();

    let totalCollected = 0;
    let collectedCount = 0;

    for (const sale of pendingSales) {
      const commissionRate = sale.metadata?.commissionRate || 0.10;
      const commissionAmount = sale.amount * commissionRate;

      if (commissionAmount > 0) {
        const existingCommission = await Transaction.findOne({
          type: 'commission',
          'reference.orderId': sale.reference.orderId,
        }).lean();

        if (!existingCommission) {
          await Transaction.create({
            userId: settings.taxAccountId,
            type: 'commission',
            status: 'completed',
            amount: commissionAmount,
            currency: config.currency.code,
            balanceBefore: 0,
            balanceAfter: commissionAmount,
            description: `عمولة من بيع في ${sale.reference.storeId?.name || 'متجر'}`,
            reference: { orderId: sale.reference.orderId, storeId: sale.reference.storeId },
            metadata: { commissionRate, autoCollected: true },
          });

          totalCollected += commissionAmount;
          collectedCount++;
        }
      }
    }

    logger.info('Commission collection completed', { collectedCount, totalCollected, by: interaction.user.id });

    return interaction.editReply({
      content: `✅ تم تحصيل العمولات المعلقة.\n📊 العمليات المحصلة: ${collectedCount}\n💰 المبلغ الإجمالي: ${formatCurrency(totalCollected)}`,
    });
  },
};
