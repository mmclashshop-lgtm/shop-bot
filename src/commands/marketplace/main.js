const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { Store, Product, Service, MarketplaceSettings, User, Order, Transaction, Review } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { formatCurrency, formatNumber } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('marketplace')
    .setDescription('إدارة الماركت بليس')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('إعداد قناة الماركت بليس')
        .addChannelOption(opt => opt.setName('channel').setDescription('القناة').setRequired(true))
        .addChannelOption(opt => opt.setName('category').setDescription('فئة المتاجر').setRequired(false))
        .addChannelOption(opt => opt.setName('log_channel').setDescription('قناة السجلات').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('update')
        .setDescription('تحديث الماركت بليس يدوياً')
    )
    .addSubcommand(sub =>
      sub.setName('feature')
        .setDescription('تمييز متجر')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
        .addIntegerOption(opt => opt.setName('days').setDescription('عدد الأيام').setMinValue(1).setMaxValue(30))
    )
    .addSubcommand(sub =>
      sub.setName('unfeature')
        .setDescription('إلغاء تمييز متجر')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('boost')
        .setDescription('ترقية متجر')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
        .addIntegerOption(opt => opt.setName('level').setDescription('مستوى الترقية').setMinValue(1).setMaxValue(5))
        .addIntegerOption(opt => opt.setName('days').setDescription('المدة بالأيام').setMinValue(1).setMaxValue(30))
    )
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('إحصائيات الماركت بليس')
    )
    .addSubcommand(sub =>
      sub.setName('top_stores')
        .setDescription('أفضل المتاجر')
        .addIntegerOption(opt => opt.setName('limit').setDescription('العدد').setMinValue(1).setMaxValue(20))
    )
    .addSubcommand(sub =>
      sub.setName('top_products')
        .setDescription('أفضل المنتجات')
        .addIntegerOption(opt => opt.setName('limit').setDescription('العدد').setMinValue(1).setMaxValue(20))
    )
    .addSubcommand(sub =>
      sub.setName('top_services')
        .setDescription('أفضل الخدمات')
        .addIntegerOption(opt => opt.setName('limit').setDescription('العدد').setMinValue(1).setMaxValue(20))
    ),

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    if (['setup', 'feature', 'unfeature', 'boost'].includes(subcommand)) {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '🚫 هذا الأمر للمشرفين فقط.', ephemeral: true });
      }
    }

    switch (subcommand) {
      case 'setup':
        await this.handleSetup(interaction, client);
        break;
      case 'update':
        await this.handleUpdate(interaction, client);
        break;
      case 'feature':
        await this.handleFeature(interaction, client);
        break;
      case 'unfeature':
        await this.handleUnfeature(interaction, client);
        break;
      case 'boost':
        await this.handleBoost(interaction, client);
        break;
      case 'stats':
        await this.handleStats(interaction, client);
        break;
      case 'top_stores':
        await this.handleTopStores(interaction, client);
        break;
      case 'top_products':
        await this.handleTopProducts(interaction, client);
        break;
      case 'top_services':
        await this.handleTopServices(interaction, client);
        break;
    }
  },

  async handleSetup(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.options.getChannel('channel');
    const category = interaction.options.getChannel('category');
    const logChannel = interaction.options.getChannel('log_channel');

    if (channel.type !== ChannelType.GuildText) {
      return interaction.editReply({ content: '❌ يجب أن تكون قناة نصية.' });
    }

    let settings = await MarketplaceSettings.findOne({ guildId: interaction.guildId }).lean();
    if (!settings) {
      settings = await MarketplaceSettings.create({ guildId: interaction.guildId });
    }

    settings.marketplaceChannelId = channel.id;
    if (category) settings.storeCategoryId = category.id;
    if (logChannel) settings.logChannelId = logChannel.id;
    await settings.save();

    if (client.marketplace) {
      client.marketplace.stop();
      await client.marketplace.initialize();
    }

    return interaction.editReply({
      content: `✅ تم إعداد الماركت بليس بنجاح!\n📢 القناة: ${channel}\n📂 الفئة: ${category || 'غير محددة'}\n📋 السجلات: ${logChannel || 'غير محددة'}`,
    });
  },

  async handleUpdate(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    if (!client.marketplace) {
      return interaction.editReply({ content: '❌ خدمة الماركت بليس غير مفعلة.' });
    }

    const settings = await MarketplaceSettings.findOne({ guildId: interaction.guildId }).lean();
    if (!settings) {
      return interaction.editReply({ content: '❌ الماركت بليس غير معد. استخدم /admin ← Marketplace.' });
    }

    await client.marketplace.updateMarketplace(settings);

    return interaction.editReply({ content: '✅ تم تحديث الماركت بليس بنجاح.' });
  },

  async handleFeature(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const days = interaction.options.getInteger('days') || 7;

    const store = await Store.findById(storeId.lean());
    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.' });
    }

    store.featuredUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    store.isFeatured = true;
    await store.save();

    return interaction.editReply({
      content: `✅ تم تمييز متجر **${store.name}** لمدة ${days} يوم.`,
    });
  },

  async handleUnfeature(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');

    const store = await Store.findById(storeId.lean());
    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.' });
    }

    store.featuredUntil = null;
    store.isFeatured = false;
    await store.save();

    return interaction.editReply({
      content: `✅ تم إلغاء تمييز متجر **${store.name}**.`,
    });
  },

  async handleBoost(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const level = interaction.options.getInteger('level') || 1;
    const days = interaction.options.getInteger('days') || 7;

    const store = await Store.findById(storeId.lean());
    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.' });
    }

    store.boostLevel = level;
    store.boostExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await store.save();

    return interaction.editReply({
      content: `✅ تم ترقية متجر **${store.name}** للمستوى ${level} لمدة ${days} يوم.`,
    });
  },

  async handleStats(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const [
      totalStores,
      activeStores,
      totalProducts,
      activeProducts,
      totalServices,
      activeServices,
      totalUsers,
      totalOrders,
      totalRevenue,
      totalCommission,
      avgRating,
    ] = await Promise.all([
      Store.countDocuments(),
      Store.countDocuments({ isActive: true, isSuspended: false }),
      Product.countDocuments(),
      Product.countDocuments({ isActive: true }),
      Service.countDocuments(),
      Service.countDocuments({ isActive: true }),
      User.countDocuments(),
      Order.countDocuments(),
      Order.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Transaction.aggregate([
        { $match: { type: 'commission', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Review.aggregate([
        { $match: { isHidden: false } },
        { $group: { _id: null, avg: { $avg: '$rating' } } },
      ]),
    ]);

    const embed = EmbedBuilderUtil.dashboardCard({
      totalStores,
      totalProducts,
      totalServices,
      totalSales: totalOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
      totalCommission: totalCommission[0]?.total || 0,
      totalUsers,
      totalOrders,
      averageRating: avgRating[0]?.avg || 0,
    }, { botAvatar: client.user.displayAvatarURL() });

    embed.addFields(
      { name: '🏪 متاجر نشطة', value: activeStores.toString(), inline: true },
      { name: '📦 منتجات نشطة', value: activeProducts.toString(), inline: true },
      { name: '💼 خدمات نشطة', value: activeServices.toString(), inline: true },
    );

    return interaction.editReply({ embeds: [embed] });
  },

  async handleTopStores(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const limit = interaction.options.getInteger('limit') || 10;

    const stores = await Store.find({ isActive: true, isSuspended: false }).lean()
      .sort({ 'stats.totalSales': -1, 'rating.average': -1 })
      .limit(limit)
      .lean();

    if (stores.length === 0) {
      return interaction.editReply({ content: '📭 لا توجد متاجر.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.store} أفضل ${stores.length} متاجر`)
      .setColor(config.colors.gold)
      .setDescription(stores.map((s, i) => `${i + 1}. **${s.name}** (${s.type}) - 🛒 ${s.stats.totalSales} - 💰 ${formatCurrency(s.stats.totalRevenue)} - ⭐ ${s.rating.average.toFixed(1)} (${s.rating.count})`).join('\n'))
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleTopProducts(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const limit = interaction.options.getInteger('limit') || 10;

    const products = await Product.find({ isActive: true }).lean()
      .sort({ soldCount: -1, 'rating.average': -1 })
      .limit(limit)
      .populate('storeId', 'name')
      .lean();

    if (products.length === 0) {
      return interaction.editReply({ content: '📭 لا توجد منتجات.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.product} أفضل ${products.length} منتجات`)
      .setColor(config.colors.gold)
      .setDescription(products.map((p, i) => `${i + 1}. **${p.name}** - ${formatCurrency(p.finalPrice)} - 🏪 ${p.storeId?.name} - 🛒 ${p.soldCount} - ⭐ ${p.rating.average.toFixed(1)}`).join('\n'))
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleTopServices(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const limit = interaction.options.getInteger('limit') || 10;

    const services = await Service.find({ isActive: true }).lean()
      .sort({ soldCount: -1, 'rating.average': -1 })
      .limit(limit)
      .populate('storeId', 'name')
      .lean();

    if (services.length === 0) {
      return interaction.editReply({ content: '📭 لا توجد خدمات.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.service} أفضل ${services.length} خدمات`)
      .setColor(config.colors.purple)
      .setDescription(services.map((s, i) => `${i + 1}. **${s.name}** - ${formatCurrency(s.finalPrice)} - 🏪 ${s.storeId?.name} - 🛒 ${s.soldCount} - ⭐ ${s.rating.average.toFixed(1)}`).join('\n'))
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
