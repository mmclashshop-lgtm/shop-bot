const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags } = require('discord.js');
const { Store, Product, Service, User } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { formatCurrency } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('البحث في الماركت بليس')
    .addStringOption(opt => opt.setName('query').setDescription('كلمة البحث').setRequired(true))
    .addStringOption(opt => opt.setName('type').setDescription('نوع البحث').addChoices(
      { name: 'الكل', value: 'all' },
      { name: 'متاجر', value: 'stores' },
      { name: 'منتجات', value: 'products' },
      { name: 'خدمات', value: 'services' },
      { name: 'بائعين', value: 'sellers' }
    ))
    .addStringOption(opt => opt.setName('category').setDescription('الفئة').setMaxLength(50))
    .addNumberOption(opt => opt.setName('min_price').setDescription('أقل سعر').setMinValue(0))
    .addNumberOption(opt => opt.setName('max_price').setDescription('أعلى سعر').setMinValue(0))
    .addStringOption(opt => opt.setName('sort').setDescription('الترتيب').addChoices(
      { name: 'الأكثر صلة', value: 'relevance' },
      { name: 'الأحدث', value: 'newest' },
      { name: 'الأقدم', value: 'oldest' },
      { name: 'الأعلى سعراً', value: 'price_desc' },
      { name: 'الأقل سعراً', value: 'price_asc' },
      { name: 'الأكثر مبيعاً', value: 'popular' },
      { name: 'الأعلى تقييماً', value: 'rating' }
    ))
    .addBooleanOption(opt => opt.setName('in_stock').setDescription('متوفر فقط'))
    .addBooleanOption(opt => opt.setName('on_sale').setDescription('بخصم فقط'))
    .addStringOption(opt => opt.setName('store_type').setDescription('نوع المتجر').addChoices(
      { name: 'مجاني', value: 'free' },
      { name: 'VIP', value: 'vip' },
      { name: 'مميز', value: 'premium' },
      { name: 'موثق', value: 'verified' }
    )),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const query = interaction.options.getString('query');
      const type = interaction.options.getString('type') || 'all';
      const category = interaction.options.getString('category');
      const minPrice = interaction.options.getNumber('min_price');
      const maxPrice = interaction.options.getNumber('max_price');
      const sort = interaction.options.getString('sort') || 'relevance';
      const inStock = interaction.options.getBoolean('in_stock') || false;
      const onSale = interaction.options.getBoolean('on_sale') || false;
      const storeType = interaction.options.getString('store_type');

      const results = await this.performSearch(query, type, {
        category,
        minPrice,
        maxPrice,
        sort,
        inStock,
        onSale,
        storeType,
      });

      if (results.total === 0) {
        return interaction.editReply({ content: '🔍 لا توجد نتائج مطابقة للبحث.' });
      }

      const embed = this.buildResultsEmbed(query, results, type);
      const components = this.buildSearchComponents(query, type, results);

      return interaction.editReply({ embeds: [embed], components });
    } catch (error) {
      logger.error('Search error', { error: error.message });
      return interaction.editReply({ content: '❌ حدث خطأ أثناء البحث.' });
    }
  },

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  sanitizeSearchQuery(query) {
    if (typeof query !== 'string' || query.length < 1) return '';
    const maxLength = 100;
    const truncated = query.trim().slice(0, maxLength);
    if (/[<>]/.test(truncated)) return truncated.replace(/[<>]/g, '');
    return truncated;
  },

  async performSearch(query, type, filters) {
    const sanitized = this.sanitizeSearchQuery(query);
    if (!sanitized) return { stores: [], products: [], services: [], sellers: [], total: 0 };
    const escapedQuery = this.escapeRegex(sanitized);
    const nameRegex = new RegExp(escapedQuery, 'i');
    const results = { stores: [], products: [], services: [], sellers: [], total: 0 };

    const storeQuery = { isActive: true, isSuspended: false };
    const productQuery = { isActive: true };
    const serviceQuery = { isActive: true };

    if (filters.category) {
      productQuery.category = new RegExp(this.escapeRegex(filters.category), 'i');
      serviceQuery.category = filters.category;
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const priceFilter = {};
      if (filters.minPrice !== undefined) priceFilter.$gte = filters.minPrice;
      if (filters.maxPrice !== undefined) priceFilter.$lte = filters.maxPrice;
      productQuery.price = priceFilter;
      productQuery.finalPrice = priceFilter;
      serviceQuery.price = priceFilter;
      serviceQuery.finalPrice = priceFilter;
    }

    if (filters.inStock) {
      productQuery.$or = [{ stock: -1 }, { stock: { $gt: 0 } }];
    }

    if (filters.onSale) {
      productQuery['discount.percentage'] = { $gt: 0 };
      productQuery['discount.endsAt'] = { $gte: new Date() };
      serviceQuery['discount.percentage'] = { $gt: 0 };
      serviceQuery['discount.endsAt'] = { $gte: new Date() };
    }

    if (filters.storeType) {
      storeQuery.type = filters.storeType;
      const matchedStores = await Store.find({ type: filters.storeType }).select('_id').lean();
      const storeIds = matchedStores.map(s => s._id);
      productQuery.storeId = { $in: storeIds };
      serviceQuery.storeId = { $in: storeIds };
    }

    let sortOption = {};
    switch (filters.sort) {
      case 'newest': sortOption = { createdAt: -1 }; break;
      case 'oldest': sortOption = { createdAt: 1 }; break;
      case 'price_desc': sortOption = { price: -1 }; break;
      case 'price_asc': sortOption = { price: 1 }; break;
      case 'popular': sortOption = { soldCount: -1 }; break;
      case 'rating': sortOption = { 'rating.average': -1, 'rating.count': -1 }; break;
      default: sortOption = { createdAt: -1 };
    }

    const limit = 20;
    const nameFilter = { name: nameRegex };

    if (type === 'all' || type === 'stores') {
      const stores = await Store.find({ ...storeQuery, ...nameFilter }).lean()
        .sort(sortOption)
        .limit(limit)
        .lean();
      results.stores = stores;
      results.total += stores.length;
    }

    if (type === 'all' || type === 'products') {
      const products = await Product.find({ ...productQuery, ...nameFilter }).lean()
        .populate('storeId', 'name type')
        .sort(sortOption)
        .limit(limit)
        .lean();
      results.products = products;
      results.total += products.length;
    }

    if (type === 'all' || type === 'services') {
      const services = await Service.find({ ...serviceQuery, ...nameFilter }).lean()
        .populate('storeId', 'name type')
        .sort(sortOption)
        .limit(limit)
        .lean();
      results.services = services;
      results.total += services.length;
    }

    if (type === 'all' || type === 'sellers') {
      const sellers = await User.find({ username: nameRegex, trustLevel: { $ne: 'none' } }).lean()
        .sort({ 'stats.averageRating': -1, 'stats.totalSales': -1 })
        .limit(limit)
        .lean();
      results.sellers = sellers;
      results.total += sellers.length;
    }

    return results;
  },

  buildResultsEmbed(query, results, type) {
    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.search} نتائج البحث: "${query}"`)
      .setColor(config.colors.primary)
      .setDescription(`تم العثور على **${results.total}** نتيجة`)
      .setTimestamp();

    if (results.stores.length > 0 && (type === 'all' || type === 'stores')) {
      embed.addFields({
        name: `${config.emojis.store} متاجر (${results.stores.length})`,
        value: results.stores.slice(0, 5).map((s, i) => `${i + 1}. **${s.name}** - ${s.type} - ⭐ ${s.rating.average.toFixed(1)} (${s.rating.count}) - 🛒 ${s.stats.totalSales}`).join('\n'),
        inline: false,
      });
    }

    if (results.products.length > 0 && (type === 'all' || type === 'products')) {
      embed.addFields({
        name: `${config.emojis.product} منتجات (${results.products.length})`,
        value: results.products.slice(0, 5).map((p, i) => `${i + 1}. **${p.name}** - ${formatCurrency(p.finalPrice)} - ${p.storeId?.name || 'غير معروف'} - 🛒 ${p.soldCount}`).join('\n'),
        inline: false,
      });
    }

    if (results.services.length > 0 && (type === 'all' || type === 'services')) {
      embed.addFields({
        name: `${config.emojis.service} خدمات (${results.services.length})`,
        value: results.services.slice(0, 5).map((s, i) => `${i + 1}. **${s.name}** - ${formatCurrency(s.finalPrice)} - ${s.storeId?.name || 'غير معروف'} - 🛒 ${s.soldCount}`).join('\n'),
        inline: false,
      });
    }

    if (results.sellers.length > 0 && (type === 'all' || type === 'sellers')) {
      embed.addFields({
        name: `${config.emojis.user} بائعين (${results.sellers.length})`,
        value: results.sellers.slice(0, 5).map((s, i) => `${i + 1}. **${s.username}** - ${s.trustLevel} - ⭐ ${s.stats.averageRating.toFixed(1)} - 🛒 ${s.stats.totalSales}`).join('\n'),
        inline: false,
      });
    }

    return embed;
  },

  buildSearchComponents(query, type, results) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');

    const components = [];

    const filterRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`search_filter_stores_${encodeURIComponent(query)}`)
        .setLabel('متاجر')
        .setEmoji(config.emojis.store)
        .setStyle(type === 'stores' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`search_filter_products_${encodeURIComponent(query)}`)
        .setLabel('منتجات')
        .setEmoji(config.emojis.product)
        .setStyle(type === 'products' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`search_filter_services_${encodeURIComponent(query)}`)
        .setLabel('خدمات')
        .setEmoji(config.emojis.service)
        .setStyle(type === 'services' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`search_filter_sellers_${encodeURIComponent(query)}`)
        .setLabel('بائعين')
        .setEmoji(config.emojis.user)
        .setStyle(type === 'sellers' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`search_filter_all_${encodeURIComponent(query)}`)
        .setLabel('الكل')
        .setEmoji(config.emojis.search)
        .setStyle(type === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
    components.push(filterRow);

    const sortRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`search_sort_${encodeURIComponent(query)}`)
        .setPlaceholder('ترتيب النتائج...')
        .addOptions([
          new StringSelectMenuOptionBuilder().setLabel('الأكثر صلة').setValue('relevance').setEmoji('🎯'),
          new StringSelectMenuOptionBuilder().setLabel('الأحدث').setValue('newest').setEmoji('🆕'),
          new StringSelectMenuOptionBuilder().setLabel('الأعلى سعراً').setValue('price_desc').setEmoji('💰'),
          new StringSelectMenuOptionBuilder().setLabel('الأقل سعراً').setValue('price_asc').setEmoji('💵'),
          new StringSelectMenuOptionBuilder().setLabel('الأكثر مبيعاً').setValue('popular').setEmoji('🔥'),
          new StringSelectMenuOptionBuilder().setLabel('الأعلى تقييماً').setValue('rating').setEmoji('⭐'),
        ])
    );
    components.push(sortRow);

    return components;
  },

  async handleSelectMenu(interaction, client, action) {
    if (action.startsWith('sort_')) {
      const query = decodeURIComponent(action.replace('sort_', ''));
      const sort = interaction.values[0];

      await interaction.deferUpdate();

      const newInteraction = Object.create(interaction);
      newInteraction.options = {
        getString: (k) => k === 'query' ? query : (k === 'sort' ? sort : null),
        getBoolean: () => false,
        getNumber: () => null,
      };
      newInteraction.deferReply = () => Promise.resolve();
      newInteraction.editReply = interaction.editReply.bind(interaction);

      return this.execute(newInteraction, client);
    }

    if (action.startsWith('filter_')) {
      const parts = action.split('_');
      const filterType = parts[1];
      const query = decodeURIComponent(parts.slice(2).join('_'));

      await interaction.deferUpdate();

      const newInteraction = Object.create(interaction);
      newInteraction.options = {
        getString: (k) => k === 'query' ? query : (k === 'type' ? filterType : null),
        getBoolean: () => false,
        getNumber: () => null,
      };
      newInteraction.deferReply = () => Promise.resolve();
      newInteraction.editReply = interaction.editReply.bind(interaction);

      return this.execute(newInteraction, client);
    }
  },

  async handleButton(interaction, client, action) {
    if (action.startsWith('filter_')) {
      const parts = action.split('_');
      const filterType = parts[1];
      const query = decodeURIComponent(parts.slice(2).join('_'));

      await interaction.deferUpdate();

      const newInteraction = Object.create(interaction);
      newInteraction.options = {
        getString: (k) => k === 'query' ? query : (k === 'type' ? filterType : null),
        getBoolean: () => false,
        getNumber: () => null,
      };
      newInteraction.deferReply = () => Promise.resolve();
      newInteraction.editReply = interaction.editReply.bind(interaction);

      return this.execute(newInteraction, client);
    }

    await interaction.deferUpdate().catch(() => {});
    return interaction.editReply({ content: '❌ إجراء غير معروف.', flags: MessageFlags.Ephemeral });
  },
};
