const cron = require('node-cron');
const { Store, Product, Service, MarketplaceSettings } = require('\.\./database/models');
const { EmbedBuilderUtil } = require('../utils/embeds');
const { logger } = require('../utils/logger');
const CacheHelper = require('../cache/cacheHelper');

class MarketplaceService {
  constructor(client) {
    this.client = client;
    this.jobs = new Map();
    this.isRunning = false;
  }

  async initialize() {
    try {
      const settings = await MarketplaceSettings.findOne().lean();
      if (!settings || !settings.marketplace.autoUpdate) {
        logger.info('Marketplace: Auto-update disabled');
        return;
      }

      if (!settings.marketplaceChannelId) {
        logger.warn('Marketplace: No marketplace channel configured');
        return;
      }

      this.startAutoUpdate(settings);
      logger.info('Marketplace: Auto-update started');
    } catch (error) {
      logger.error('Marketplace: Initialization failed', { error: error.message });
    }
  }

  startAutoUpdate(settings) {
    const intervalMs = settings.marketplace.updateInterval;
    const intervalMinutes = Math.max(1, Math.floor(intervalMs / 60000));

    const cronExpression = `*/${intervalMinutes} * * * *`;

    const job = cron.schedule(cronExpression, async () => {
      await this.updateMarketplace(settings);
    });

    this.jobs.set(settings.guildId, job);
    job.start();

    this.updateMarketplace(settings);
  }

  async updateMarketplace(settings) {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const channel = await this.client.channels.fetch(settings.marketplaceChannelId).catch(() => null);
      if (!channel) {
        logger.warn('Marketplace: Channel not found', { channelId: settings.marketplaceChannelId });
        return;
      }

      const data = await this.fetchMarketplaceData(settings);
      const embed = EmbedBuilderUtil.marketplaceCard(data, {
        guildName: channel.guild?.name || 'Market AI',
        banner: settings.marketplaceBanner,
      });

      const components = this.createMarketplaceComponents();

      let message;
      if (settings.marketplaceMessageId) {
        message = await channel.messages.fetch(settings.marketplaceMessageId).catch(() => null);
      }

      if (message) {
        await message.edit({ embeds: [embed], components }).catch(err => {
          logger.error('Marketplace: Failed to edit message', { error: err.message });
        });
      } else {
        message = await channel.send({ embeds: [embed], components }).catch(err => {
          logger.error('Marketplace: Failed to send message', { error: err.message });
        });

        if (message) {
          await MarketplaceSettings.findByIdAndUpdate(settings._id, {
            marketplaceMessageId: message.id,
          });
        }
      }

      logger.info('Marketplace: Updated successfully');
    } catch (error) {
      logger.error('Marketplace: Update failed', { error: error.message });
    } finally {
      this.isRunning = false;
    }
  }

  async fetchMarketplaceData(settings) {
    const cacheKey = CacheHelper.generateKey('marketplace', 'data', settings?.guildId || 'global');

    return CacheHelper.getOrFetch(cacheKey, async () => {
      const [featuredStores, trendingProducts, newProducts, topRated] = await Promise.all([
        this.getFeaturedStores(settings),
        this.getTrendingProducts(settings),
        this.getNewProducts(settings),
        this.getTopRated(settings),
      ]);

      return {
        featuredStores,
        trendingProducts,
        newProducts,
        topRated,
        totalStores: await Store.countDocuments({ isActive: true }),
        totalProducts: await Product.countDocuments({ isActive: true }),
        updatedAt: new Date().toISOString(),
      };
    }, 300);
  }

  async getFeaturedStores(settings) {
    return Store.find({
      isActive: true,
      isSuspended: false,
      $or: [
        { featuredUntil: { $gt: new Date() } },
        { type: { $in: ['verified', 'premium'] } },
      ],
    })
      .sort({ 'stats.totalSales': -1, 'rating.average': -1 })
      .limit(settings.marketplace.maxFeaturedStores)
      .lean();
  }

  async getTrendingProducts(settings) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    return Product.find({
      isActive: true,
      createdAt: { $gte: weekAgo },
    }).lean()
      .sort({ soldCount: -1, viewCount: -1 })
      .limit(settings.marketplace.maxTrendingProducts)
      .populate('storeId', 'name')
      .lean();
  }

  async getNewProducts(settings) {
    return Product.find({ isActive: true }).lean()
      .sort({ createdAt: -1 })
      .limit(settings.marketplace.maxNewProducts)
      .populate('storeId', 'name')
      .lean();
  }

  async getTopRated(settings) {
    const stores = await Store.find({
      isActive: true,
      isSuspended: false,
      'rating.count': { $gte: 5 },
    }).lean()
      .sort({ 'rating.average': -1, 'rating.count': -1 })
      .limit(settings.marketplace.maxTopRated)
      .lean();

    const products = await Product.find({
      isActive: true,
      'rating.count': { $gte: 3 },
    }).lean()
      .sort({ 'rating.average': -1, 'rating.count': -1 })
      .limit(settings.marketplace.maxTopRated)
      .populate('storeId', 'name')
      .lean();

    return [...stores.map(s => ({ ...s, type: 'store' })), ...products.map(p => ({ ...p, type: 'product' }))]
      .sort((a, b) => b.rating.average - a.rating.average || b.rating.count - a.rating.count)
      .slice(0, settings.marketplace.maxTopRated);
  }

  createMarketplaceComponents() {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
    const config = require('../config');

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('marketplace_refresh')
        .setLabel('تحديث')
        .setEmoji(config.emojis.refresh)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('marketplace_stores')
        .setLabel('المتاجر')
        .setEmoji(config.emojis.store)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('marketplace_products')
        .setLabel('المنتجات')
        .setEmoji(config.emojis.product)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('marketplace_services')
        .setLabel('الخدمات')
        .setEmoji(config.emojis.service)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('marketplace_create_store')
        .setLabel('إنشاء متجر')
        .setEmoji(config.emojis.plus)
        .setStyle(ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('marketplace_category_filter')
        .setPlaceholder('تصفية حسب الفئة...')
        .addOptions([
          new StringSelectMenuOptionBuilder().setLabel('جميع الفئات').setValue('all').setEmoji('📦'),
          new StringSelectMenuOptionBuilder().setLabel('برمجة').setValue('programming').setEmoji('💻'),
          new StringSelectMenuOptionBuilder().setLabel('تصميم').setValue('design').setEmoji('🎨'),
          new StringSelectMenuOptionBuilder().setLabel('ترجمة').setValue('translation').setEmoji('🌐'),
          new StringSelectMenuOptionBuilder().setLabel('مونتاج').setValue('video_editing').setEmoji('🎬'),
          new StringSelectMenuOptionBuilder().setLabel('استضافة').setValue('hosting').setEmoji('☁️'),
          new StringSelectMenuOptionBuilder().setLabel('تسويق').setValue('marketing').setEmoji('📢'),
          new StringSelectMenuOptionBuilder().setLabel('كتابة').setValue('writing').setEmoji('✍️'),
        ])
    );

    return [row1, row2];
  }

  async handleInteraction(interaction) {
    const { customId } = interaction;

    if (customId === 'marketplace_refresh') {
      const settings = await MarketplaceSettings.findOne({ guildId: interaction.guildId }).lean();
      if (settings) {
        await interaction.deferUpdate();
        await this.updateMarketplace(settings);
        await interaction.followUp({ content: '✅ تم تحديث الماركت بليس', ephemeral: true });
      }
    } else if (customId === 'marketplace_stores') {
      await this.showStoresList(interaction);
    } else if (customId === 'marketplace_products') {
      await this.showProductsList(interaction);
    } else if (customId === 'marketplace_services') {
      await this.showServicesList(interaction);
    } else if (customId === 'marketplace_create_store') {
      await interaction.showModal(this.createStoreModal());
    } else if (customId === 'marketplace_category_filter') {
      await this.filterByCategory(interaction);
    }
  }

  async showStoresList(interaction) {
    const stores = await Store.find({ isActive: true, isSuspended: false }).lean()
      .sort({ 'stats.totalSales': -1 })
      .limit(10)
      .lean();

    const { EmbedBuilder } = require('discord.js');
    const config = require('../config');

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.store} أفضل المتاجر`)
      .setColor(config.colors.primary)
      .setDescription(stores.map((s, i) => `${i + 1}. **${s.name}** - ${s.stats.totalSales} مبيعات - ⭐ ${s.rating.average.toFixed(1)}`).join('\n') || 'لا توجد متاجر')
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  async showProductsList(interaction) {
    const products = await Product.find({ isActive: true }).lean()
      .sort({ soldCount: -1 })
      .limit(10)
      .populate('storeId', 'name')
      .lean();

    const { EmbedBuilder } = require('discord.js');
    const config = require('../config');

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.product} المنتجات الرائجة`)
      .setColor(config.colors.primary)
      .setDescription(products.map((p, i) => `${i + 1}. **${p.name}** - ${p.finalPrice.toLocaleString()} ${config.currency.symbol} - ${p.storeId?.name || 'غير معروف'}`).join('\n') || 'لا توجد منتجات')
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  async showServicesList(interaction) {
    const services = await Service.find({ isActive: true }).lean()
      .sort({ soldCount: -1 })
      .limit(10)
      .populate('storeId', 'name')
      .lean();

    const { EmbedBuilder } = require('discord.js');
    const config = require('../config');

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.service} الخدمات الرائجة`)
      .setColor(config.colors.purple)
      .setDescription(services.map((s, i) => `${i + 1}. **${s.name}** - ${s.finalPrice.toLocaleString()} ${config.currency.symbol} - ${s.storeId?.name || 'غير معروف'}`).join('\n') || 'لا توجد خدمات')
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  async filterByCategory(interaction) {
    const category = interaction.values[0];
    let products;

    if (category === 'all') {
      products = await Product.find({ isActive: true }).sort({ soldCount: -1 }).limit(10).populate('storeId', 'name').lean();
    } else {
      products = await Product.find({ isActive: true, category }).sort({ soldCount: -1 }).limit(10).populate('storeId', 'name').lean();
    }

    const { EmbedBuilder } = require('discord.js');
    const config = require('../config');

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.product} منتجات فئة: ${category}`)
      .setColor(config.colors.primary)
      .setDescription(products.map((p, i) => `${i + 1}. **${p.name}** - ${p.finalPrice.toLocaleString()} ${config.currency.symbol} - ${p.storeId?.name || 'غير معروف'}`).join('\n') || 'لا توجد منتجات')
      .setTimestamp();

    await interaction.update({ embeds: [embed] });
  }

  stop() {
    for (const [guildId, job] of this.jobs) {
      job.stop();
    }
    this.jobs.clear();
    logger.info('Marketplace: All jobs stopped');
  }

  destroy() {
    this.stop();
    this.client = null;
  }
}

module.exports = MarketplaceService;
