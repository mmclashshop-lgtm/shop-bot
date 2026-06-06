const mongoose = require('mongoose');
const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { Store, User, MarketplaceSettings } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { validateStoreCreate } = require('../../utils/validation');
const { generateReferralCode, formatCurrency } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('store')
    .setDescription('إدارة المتاجر')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('إنشاء متجر جديد')
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('تعديل متجر')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
        .addStringOption(opt => opt.setName('name').setDescription('اسم المتجر').setMaxLength(100))
        .addStringOption(opt => opt.setName('description').setDescription('وصف المتجر').setMaxLength(2000))
        .addStringOption(opt => opt.setName('image').setDescription('صورة المتجر (رابط)'))
        .addStringOption(opt => opt.setName('banner').setDescription('بانر المتجر (رابط)'))
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('حذف متجر')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('معلومات المتجر')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر'))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('قائمة متاجرك')
    )
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('إحصائيات المتجر')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
    ),

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'create':
        await this.handleCreate(interaction, client);
        break;
      case 'edit':
        await this.handleEdit(interaction, client);
        break;
      case 'delete':
        await this.handleDelete(interaction, client);
        break;
      case 'info':
        await this.handleInfo(interaction, client);
        break;
      case 'list':
        await this.handleList(interaction, client);
        break;
      case 'stats':
        await this.handleStats(interaction, client);
        break;
    }
  },

  async handleCreate(interaction, client) {
    const user = await User.findOne({ discordId: interaction.user.id }).lean();
    if (!user) {
      return interaction.reply({ content: '❌ يرجى التسجيل أولاً باستخدام /register', ephemeral: true });
    }

    const settings = await MarketplaceSettings.findOne().lean();
    const userStores = await Store.countDocuments({ ownerId: interaction.user.id, isActive: true });

    if (userStores >= (settings?.storeLimits?.maxPerUser || config.limits.maxStoresPerUser)) {
      return interaction.reply({
        content: `❌ وصلت للحد الأقصى للمتاجر (${settings?.storeLimits?.maxPerUser || config.limits.maxStoresPerUser}).`,
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('store_create_modal')
      .setTitle('إنشاء متجر جديد');

    const nameInput = new TextInputBuilder()
      .setCustomId('store_name')
      .setLabel('اسم المتجر')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: متجر البرمجة الاحترافي')
      .setRequired(true)
      .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('store_description')
      .setLabel('وصف المتجر')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('وصف ما يقدمه متجرك، تخصصك، ولماذا يشتري العملاء منك...')
      .setRequired(true)
      .setMaxLength(2000);

    const imageInput = new TextInputBuilder()
      .setCustomId('store_image')
      .setLabel('صورة المتجر (رابط مباشر)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://example.com/store-image.png')
      .setRequired(false)
      .setMaxLength(500);

    const bannerInput = new TextInputBuilder()
      .setCustomId('store_banner')
      .setLabel('بانر المتجر (رابط مباشر)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://example.com/store-banner.png')
      .setRequired(false)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(imageInput),
      new ActionRowBuilder().addComponents(bannerInput)
    );

    await interaction.showModal(modal).catch(() => {});
  },

  async handleModalSubmit(interaction, client) {
    if (interaction.customId !== 'store_create_modal') return;

    await interaction.deferReply({ ephemeral: true });

    try {
      const data = {
        name: interaction.fields.getTextInputValue('store_name'),
        description: interaction.fields.getTextInputValue('store_description'),
        image: interaction.fields.getTextInputValue('store_image') || null,
        banner: interaction.fields.getTextInputValue('store_banner') || null,
      };

      const validated = validateStoreCreate(data);

      const settings = await MarketplaceSettings.findOne().lean();
      const creationFee = settings?.storeCreationFee?.free || 0;

      const session = await mongoose.startSession();
      session.startTransaction();

      let store;
      let user;

      try {
        user = await User.findOne({ discordId: interaction.user.id }).session(session.lean());
        if (user.balance < creationFee) {
          await session.abortTransaction();
          return interaction.editReply({
            content: `❌ رصيد غير كافٍ. رسوم إنشاء المتجر: ${creationFee} ${config.currency.symbol}`,
          });
        }

        if (creationFee > 0) {
          user.balance -= creationFee;
          await user.save({ session });
        }

        [store] = await Store.create([{
          ownerId: interaction.user.id,
          name: validated.name,
          description: validated.description,
          image: validated.image,
          banner: validated.banner,
          type: 'free',
        }], { session });

        user.stats.totalStores = (user.stats.totalStores || 0) + 1;
        await user.save({ session });

        await session.commitTransaction();
      } catch (txError) {
        await session.abortTransaction();
        throw txError;
      } finally {
        session.endSession();
      }

      const category = await this.createStoreCategory(interaction.guild, store, client);
      store.categoryId = category.id;

      const channels = await this.createStoreChannels(category, store, interaction.user.id);
      store.channels = channels;

      await store.save();

      const storeCard = await this.publishStoreCard(interaction.guild, store, client);
      store.messageId = storeCard.messageId;
      store.channelId = storeCard.channelId;
      await store.save();

      logger.info('Store created', { storeId: store._id, ownerId: interaction.user.id });

      return interaction.editReply({
        content: `✅ تم إنشاء متجرك بنجاح!\n🏪 **${store.name}**\n📂 الفئة: ${category.name}\n💰 رسوم الإنشاء: ${creationFee} ${config.currency.symbol}`,
        ephemeral: true,
      });
    } catch (error) {
      logger.error('Store creation error', { error: error.message, userId: interaction.user.id });
      return interaction.editReply({
        content: `❌ حدث خطأ: ${error.message}`,
      });
    }
  },

  async createStoreCategory(guild, store, client) {
    const settings = await MarketplaceSettings.findOne().lean();
    let parentCategory = null;

    if (settings?.storeCategoryId) {
      parentCategory = guild.channels.cache.get(settings.storeCategoryId);
    }

    return guild.channels.create({
      name: `🏪 ${store.name}`,
      type: ChannelType.GuildCategory,
      parent: parentCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone, allow: ['ViewChannel'] },
        { id: store.ownerId, allow: ['ViewChannel', 'ManageChannels', 'ManageMessages'] },
        { id: client.user.id, allow: ['ViewChannel', 'ManageChannels', 'ManageMessages', 'SendMessages', 'EmbedLinks', 'AttachFiles'] },
      ],
    });
  },

  async createStoreChannels(category, store, ownerId) {
    const channels = {};

    const infoChannel = await category.children.create({
      name: '📢┃معلومات-المتجر',
      type: ChannelType.GuildText,
      topic: `معلومات متجر ${store.name}`,
      permissionOverwrites: [
        { id: category.guild.roles.everyone, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] },
        { id: ownerId, allow: ['ViewChannel', 'SendMessages', 'ManageMessages'] },
      ],
    });
    channels.info = infoChannel.id;

    const productsChannel = await category.children.create({
      name: '🛒┃المنتجات',
      type: ChannelType.GuildText,
      topic: `منتجات متجر ${store.name}`,
      permissionOverwrites: [
        { id: category.guild.roles.everyone, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] },
        { id: ownerId, allow: ['ViewChannel', 'SendMessages', 'ManageMessages'] },
      ],
    });
    channels.products = productsChannel.id;

    const reviewsChannel = await category.children.create({
      name: '⭐┃التقييمات',
      type: ChannelType.GuildText,
      topic: `تقييمات متجر ${store.name}`,
      permissionOverwrites: [
        { id: category.guild.roles.everyone, allow: ['ViewChannel', 'ReadMessageHistory', 'SendMessages'] },
        { id: ownerId, allow: ['ViewChannel', 'SendMessages', 'ManageMessages'] },
      ],
    });
    channels.reviews = reviewsChannel.id;

    const supportChannel = await category.children.create({
      name: '🎫┃الدعم',
      type: ChannelType.GuildText,
      topic: `دعم متجر ${store.name}`,
      permissionOverwrites: [
        { id: category.guild.roles.everyone, allow: ['ViewChannel', 'ReadMessageHistory', 'SendMessages'] },
        { id: ownerId, allow: ['ViewChannel', 'SendMessages', 'ManageMessages'] },
      ],
    });
    channels.support = supportChannel.id;

    const statsChannel = await category.children.create({
      name: '📊┃الإحصائيات',
      type: ChannelType.GuildText,
      topic: `إحصائيات متجر ${store.name}`,
      permissionOverwrites: [
        { id: category.guild.roles.everyone, deny: ['ViewChannel'] },
        { id: ownerId, allow: ['ViewChannel', 'ReadMessageHistory'] },
      ],
    });
    channels.stats = statsChannel.id;

    return channels;
  },

  async publishStoreCard(guild, store, client) {
    const settings = await MarketplaceSettings.findOne().lean();
    let targetChannel = null;

    if (settings?.marketplaceChannelId) {
      targetChannel = guild.channels.cache.get(settings.marketplaceChannelId);
    }

    if (!targetChannel) {
      targetChannel = guild.channels.cache.find(c => c.name === 'marketplace' || c.name === 'السوق');
    }

    if (!targetChannel) {
      targetChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(client.user).has('SendMessages'));
    }

    if (!targetChannel) {
      throw new Error('No suitable channel found for store card');
    }

    const owner = await client.users.fetch(store.ownerId).catch(() => null);
    const ownerUser = await User.findOne({ discordId: store.ownerId }).lean();
    const embed = EmbedBuilderUtil.storeCard(store, {
      storeName: store.name,
      ownerTrustLevel: ownerUser?.trustLevel,
    });

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`store_visit_${store._id}`)
        .setLabel('زيارة المتجر')
        .setEmoji(config.emojis.arrowRight)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guild.id}/${store.channels.info}`),
      new ButtonBuilder()
        .setCustomId(`store_products_${store._id}`)
        .setLabel('المنتجات')
        .setEmoji(config.emojis.product)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`store_reviews_${store._id}`)
        .setLabel('التقييمات')
        .setEmoji(config.emojis.star)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`store_support_${store._id}`)
        .setLabel('الدعم')
        .setEmoji(config.emojis.ticket)
        .setStyle(ButtonStyle.Secondary)
    );

    const message = await targetChannel.send({ embeds: [embed], components: [row] });

    return { messageId: message.id, channelId: targetChannel.id };
  },

  async handleEdit(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const store = await Store.findById(storeId.lean());

    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.' });
    }

    if (store.ownerId !== interaction.user.id) {
      return interaction.editReply({ content: '🚫 غير مصرح: يمكنك تعديل متاجرك فقط.' });
    }

    const updates = {};
    if (interaction.options.getString('name')) updates.name = interaction.options.getString('name');
    if (interaction.options.getString('description')) updates.description = interaction.options.getString('description');
    if (interaction.options.getString('image')) updates.image = interaction.options.getString('image');
    if (interaction.options.getString('banner')) updates.banner = interaction.options.getString('banner');

    Object.assign(store, updates);
    await store.save();

    if (store.channelId && store.messageId) {
      const channel = client.channels.cache.get(store.channelId);
      if (channel) {
        const message = await channel.messages.fetch(store.messageId).catch(() => null);
        if (message) {
    const ownerUser = await User.findOne({ discordId: store.ownerId }).lean();
          const embed = EmbedBuilderUtil.storeCard(store, { ownerTrustLevel: ownerUser?.trustLevel });
          await message.edit({ embeds: [embed] }).catch(() => {});
        }
      }
    }

    return interaction.editReply({ content: '✅ تم تحديث المتجر بنجاح.' });
  },

  async handleDelete(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const store = await Store.findById(storeId).lean();

    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.' });
    }

    if (store.ownerId !== interaction.user.id) {
      return interaction.editReply({ content: '🚫 غير مصرح: يمكنك حذف متاجرك فقط.' });
    }

    const category = store.categoryId ? interaction.guild.channels.cache.get(store.categoryId) : null;
    if (category) {
      for (const channel of category.children.values()) {
        await channel.delete().catch(() => {});
      }
      await category.delete().catch(() => {});
    }

    await Store.findByIdAndDelete(storeId);

    return interaction.editReply({ content: '✅ تم حذف المتجر وقنواته بنجاح.' });
  },

  async handleInfo(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    let storeId = interaction.options.getString('store_id');
    if (!storeId) {
      const store = await Store.findOne({ ownerId: interaction.user.id }).lean();
      if (!store) {
        return interaction.editReply({ content: '❌ ليس لديك متجر. استخدم /market ← Stores ← Create لإنشاء واحد.' });
      }
      storeId = store._id.toString();
    }

    const store = await Store.findById(storeId).lean();
    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.' });
    }

    const owner = await client.users.fetch(store.ownerId).catch(() => null);
    const ownerUser = await User.findOne({ discordId: store.ownerId }).lean();
    const embed = EmbedBuilderUtil.storeCard(store, { ownerTrustLevel: ownerUser?.trustLevel });

    embed.addFields(
      { name: '📅 تاريخ الإنشاء', value: `<t:${Math.floor(store.createdAt / 1000)}:F>`, inline: true },
      { name: '🔗 معرف المتجر', value: store._id.toString(), inline: true }
    );

    if (owner) {
      embed.setAuthor({ name: owner.username, iconURL: owner.displayAvatarURL() });
    }

    return interaction.editReply({ embeds: [embed] });
  },

  async handleList(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const stores = await Store.find({ ownerId: interaction.user.id, isActive: true }).lean()
      .sort({ createdAt: -1 })
      .lean();

    if (stores.length === 0) {
      return interaction.editReply({ content: '📭 لا تملك أي متاجر. استخدم /market ← Stores ← Create لإنشاء أول متجر.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.store} متاجرك (${stores.length})`)
      .setColor(config.colors.primary)
      .setDescription(stores.map((s, i) => `${i + 1}. **${s.name}** - ${s.type} - ${s.stats.totalSales} مبيعات - ⭐ ${s.rating.average.toFixed(1)}`).join('\n'))
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleStats(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const store = await Store.findById(storeId).lean();

    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.' });
    }

    if (store.ownerId !== interaction.user.id) {
      return interaction.editReply({ content: '🚫 غير مصرح: يمكنك رؤية إحصائيات متاجرك فقط.' });
    }

    const { Product, Order, Review } = require('../../database/models');

    const [productsCount, ordersCount, totalRevenue, avgRating, recentOrders] = await Promise.all([
      Product.countDocuments({ storeId: store._id, isActive: true }),
      Order.countDocuments({ storeId: store._id }),
      Order.aggregate([
        { $match: { storeId: store._id, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Review.aggregate([
        { $match: { storeId: store._id, isHidden: false } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
      Order.find({ storeId: store._id }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.chart} إحصائيات ${store.name}`)
      .setColor(config.colors.primary)
      .addFields(
        { name: `${config.emojis.product} المنتجات`, value: productsCount.toString(), inline: true },
        { name: `${config.emojis.money} الطلبات`, value: ordersCount.toString(), inline: true },
        { name: '💵 إجمالي الأرباح', value: `${(totalRevenue[0]?.total || 0).toLocaleString()} ${config.currency.symbol}`, inline: true },
        { name: `${config.emojis.star} التقييم`, value: `${(avgRating[0]?.avg || 0).toFixed(1)} (${avgRating[0]?.count || 0})`, inline: true },
        { name: '💸 العمولة المدفوعة', value: `${store.stats.totalCommission.toLocaleString()} ${config.currency.symbol}`, inline: true },
        { name: '👁️ المشاهدات', value: store.stats.totalViews.toLocaleString(), inline: true },
      )
      .setTimestamp();

    if (recentOrders.length > 0) {
      embed.addFields({
        name: '📋 أحدث الطلبات',
        value: recentOrders.map(o => `• #${o.orderNumber} - ${o.total.toLocaleString()} ${config.currency.symbol} - ${o.status}`).join('\n'),
        inline: false,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },

  async handleButton(interaction, client, action) {
    if (action.startsWith('visit_')) {
      await interaction.deferUpdate();
      const storeId = action.replace('visit_', '');
      const store = await Store.findById(storeId).lean();
      if (!store) return interaction.editReply({ content: '❌ المتجر غير موجود.', flags: MessageFlags.Ephemeral });
      return interaction.editReply({
        content: `🏪 متجر **${store.name}**: <#${store.channels.info}>`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action.startsWith('products_')) {
      await interaction.deferUpdate();
      const storeId = action.replace('products_', '');
      const store = await Store.findById(storeId).lean();
      if (!store) return interaction.editReply({ content: '❌ المتجر غير موجود.', flags: MessageFlags.Ephemeral });
      const { Product } = require('../../database/models');
      const products = await Product.find({ storeId: store._id, isActive: true }).sort({ createdAt: -1 }).limit(10).lean();
      const embed = new EmbedBuilder()
        .setTitle(`📦 منتجات ${store.name}`)
        .setColor(config.colors.primary)
        .setDescription(products.length > 0
          ? products.map((p, i) => `${i + 1}. **${p.name}** — ${formatCurrency(p.price)}`).join('\n')
          : '📭 لا توجد منتجات متاحة.')
        .setTimestamp();
      return interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (action.startsWith('reviews_')) {
      await interaction.deferUpdate();
      const storeId = action.replace('reviews_', '');
      const store = await Store.findById(storeId).lean();
      if (!store) return interaction.editReply({ content: '❌ المتجر غير موجود.', flags: MessageFlags.Ephemeral });
      const { Review } = require('../../database/models');
      const reviews = await Review.find({ storeId: store._id, isHidden: false }).sort({ createdAt: -1 }).limit(10).lean();
      const rating = store.rating?.average ? `⭐ ${store.rating.average.toFixed(1)} (${store.rating.count} تقييم)` : '⭐ لا توجد تقييمات بعد';
      const embed = new EmbedBuilder()
        .setTitle(`⭐ تقييمات ${store.name}`)
        .setColor(config.colors.primary)
        .addFields(
          { name: '📊 متوسط التقييم', value: rating, inline: false },
          { name: '📝 أحدث التقييمات', value: reviews.length > 0
            ? reviews.map((r, i) => `${i + 1}. {"⭐".repeat(r.rating)} — ${r.comment?.substring(0, 100) || 'لا يوجد تعليق'}`).join('\n')
            : 'لا توجد تقييمات بعد.', inline: false }
        )
        .setTimestamp();
      return interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (action.startsWith('support_')) {
      await interaction.deferUpdate();
      const storeId = action.replace('support_', '');
      const store = await Store.findById(storeId).lean();
      if (!store) return interaction.editReply({ content: '❌ المتجر غير موجود.', flags: MessageFlags.Ephemeral });
      if (store.channels?.support) {
        return interaction.editReply({ content: `🎫 للدعم الفني، تواصل مع: <#${store.channels.support}>`, flags: MessageFlags.Ephemeral });
      }
      return interaction.editReply({ content: '📩 يرجى مراسلة صاحب المتجر مباشرة للحصول على الدعم.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate().catch(() => {});
    return interaction.editReply({ content: '❌ إجراء غير معروف.', flags: MessageFlags.Ephemeral });
  },
};
