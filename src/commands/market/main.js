const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { PanelManager, NAV } = require('../../utils/PanelManager');
const config = require('../../config');
const { formatCurrency, formatNumber, calculateCommission } = require('../../utils/helpers');
const { Store, Product, Service, User } = require('../../database/models');
const productCmd = require('../product/main');
const serviceCmd = require('../service/main');
const { EmbedBuilderUtil } = require('../../utils/embeds');

const COLORS = { stores: 0xF1C40F, products: 0x3498DB, services: 0x9B59B6, search: 0x2ECC71, wallet: 0xE67E22, reviews: 0x1ABC9C, loyalty: 0xE91E63 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('market')
    .setDescription('🏪 سوق المتاجر والمنتجات والخدمات'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    return this.showHome(interaction);
  },

  async showHome(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🏪 Market — السوق')
      .setDescription('مرحباً بك في السوق! اختر قسمًا من الأزرار أدناه.')
      .setColor(config.colors.primary)
      .addFields(
        { name: '🏪 المتاجر', value: 'تصفح وإدارة المتاجر', inline: true },
        { name: '📦 المنتجات', value: 'شراء وإدارة المنتجات', inline: true },
        { name: '💼 الخدمات', value: 'طلب وإدارة الخدمات', inline: true },
        { name: '🔍 البحث', value: 'ابحث في السوق', inline: true },
        { name: '💰 المحفظة', value: 'رصيدك ومعاملاتك', inline: true },
        { name: '⭐ التقييمات', value: 'التقييمات والمراجعات', inline: true },
        { name: '🎁 الولاء', value: 'نقاط الولاء والمكافآت', inline: true },
      )
      .setFooter({ text: 'استخدم الأزرار للتنقل' })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('market_stores', 'المتاجر', '🏪', ButtonStyle.Primary),
      PanelManager.panelButton('market_products', 'المنتجات', '📦', ButtonStyle.Primary),
      PanelManager.panelButton('market_services', 'الخدمات', '💼', ButtonStyle.Primary),
      PanelManager.panelButton('market_search', 'بحث', '🔍', ButtonStyle.Success),
      PanelManager.panelButton('market_wallet', 'المحفظة', '💰', ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('market_review', 'التقييمات', '⭐', ButtonStyle.Secondary),
      PanelManager.panelButton('market_loyalty', 'الولاء', '🎁', ButtonStyle.Secondary),
      NAV.close('market'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row, row2] });
  },

  async handleButton(interaction, client, action) {
    const modalActions = ['store_create'];
    const delegationActions = ['wallet_balance', 'wallet_deposit', 'wallet_transfer', 'wallet_history', 'wallet_withdraw', 'search_execute'];
    const needsFreshInteraction = [...modalActions, ...delegationActions];
    if (!needsFreshInteraction.includes(action) && !action.startsWith('review_') && !action.startsWith('loyalty_')) {
      await PanelManager.defer(interaction);
    }
    switch (action) {
      case 'home': return this.showHome(interaction);
      case 'close': return interaction.deleteReply().catch(() => {});
      case 'refresh': return this.showHome(interaction);
      case 'stores': return this.showStoresMenu(interaction, client);
      case 'products': return this.showProductsMenu(interaction, client);
      case 'services': return this.showServicesMenu(interaction, client);
      case 'search': return this.showSearchMenu(interaction, client);
      case 'wallet': return this.showWalletMenu(interaction, client);
      case 'review': return this.showReviewMenu(interaction, client);
      case 'loyalty': return this.showLoyaltyMenu(interaction, client);
      case 'marketplace_create_store':
        await PanelManager.defer(interaction);
        const storeCmd = require('../store/create');
        return storeCmd.handleCreate(interaction, client);
      case 'marketplace_services': return this.showServicesMenu(interaction, client);
      case 'marketplace_products': return this.showProductsMenu(interaction, client);
      case 'marketplace_stores': return this.showStoresMenu(interaction, client);
      case 'marketplace_refresh': return this.showHome(interaction);
      case 'marketplace_category_filter': return this.showHome(interaction);
      default: {
        if (action.startsWith('store_')) return this.handleStoreAction(interaction, client, action);
        if (action.startsWith('prod_')) return this.handleProductAction(interaction, client, action);
        if (action.startsWith('serv_')) return this.handleServiceAction(interaction, client, action);
        if (action.startsWith('search_')) return this.handleSearchAction(interaction, client, action);
        if (action.startsWith('wallet_')) return this.handleWalletAction(interaction, client, action);
        if (action.startsWith('review_')) return this.handleReviewAction(interaction, client, action);
        if (action.startsWith('loyalty_')) return this.handleLoyaltyAction(interaction, client, action);
        if (action.startsWith('marketplace_')) return this.showHome(interaction);
        return this.showHome(interaction);
      }
    }
  },

  async handleSelectMenu(interaction, client, action) {
    const value = interaction.values[0];
    if (action === 'store_list') return this.showStoreDetail(interaction, client, value);
    if (action === 'product_list') return this.showProductDetail(interaction, client, value);
    if (action === 'service_list') return this.showServiceDetail(interaction, client, value);
    if (action === 'wallet_history') return this.showWalletHistory(interaction, client, value);
    return this.showHome(interaction);
  },

  async showStoresMenu(interaction, client) {
    const stores = await Store.find({ isActive: true, isSuspended: false }).sort({ 'stats.totalSales': -1 }).limit(25).lean();
    const myStores = await Store.find({ ownerId: interaction.user.id }).lean();
    const embed = PanelManager.embed('🏪 المتاجر', `اختر متجراً أو إجراءً من القائمة.`, COLORS.stores, {
      fields: [
        { name: '📊 إجمالي المتاجر', value: stores.length.toString(), inline: true },
        { name: '🏪 متاجرك', value: myStores.length.toString(), inline: true },
      ],
    });
    const menu = new StringSelectMenuBuilder().setCustomId('market_store_list').setPlaceholder('تصفح المتاجر...');
    for (const s of stores.slice(0, 25)) {
      menu.addOptions({ label: s.name.substring(0, 100), value: s._id.toString(), description: `${s.type} • ${s.stats.totalSales} مبيعات`, emoji: '🏪' });
    }
    const row1 = new ActionRowBuilder().addComponents(menu);
    const row2 = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('market_my_stores', 'متاجري', '👤', ButtonStyle.Primary),
      PanelManager.panelButton('market_store_create', 'إنشاء متجر', '➕', ButtonStyle.Success),
      NAV.back('market'), NAV.home('market'), NAV.close('market'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row1, row2] });
  },

  async showProductsMenu(interaction, client) {
    const recent = await Product.find({ isActive: true }).sort({ createdAt: -1 }).limit(10).lean();
    const embed = PanelManager.embed('📦 المنتجات', 'تصفح المنتجات أو قم بإدارة منتجاتك.', COLORS.products);
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('market_prod_browse', 'تصفح المنتجات', '🔍', ButtonStyle.Primary),
      PanelManager.panelButton('market_prod_mine', 'منتجاتي', '📦', ButtonStyle.Primary),
      PanelManager.panelButton('market_prod_buy', 'شراء منتج', '🛒', ButtonStyle.Success),
      PanelManager.panelButton('market_prod_featured', 'مميزة', '⭐', ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
      NAV.back('market'), NAV.home('market'), NAV.refresh('market', 'products'), NAV.close('market'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row, row2] });
  },

  async showServicesMenu(interaction, client) {
    const embed = PanelManager.embed('💼 الخدمات', 'تصفح الخدمات أو قم بإدارة خدماتك.', COLORS.services);
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('market_serv_browse', 'تصفح الخدمات', '🔍', ButtonStyle.Primary),
      PanelManager.panelButton('market_serv_mine', 'خدماتي', '💼', ButtonStyle.Primary),
      PanelManager.panelButton('market_serv_order', 'طلب خدمة', '📝', ButtonStyle.Success),
      PanelManager.panelButton('market_serv_featured', 'مميزة', '⭐', ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
      NAV.back('market'), NAV.home('market'), NAV.refresh('market', 'services'), NAV.close('market'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row, row2] });
  },

  async showSearchMenu(interaction, client) {
    const embed = PanelManager.embed('🔍 البحث في السوق', 'ابحث عن منتجات، خدمات، أو متاجر.\nمن لوحة السوق → قسم البحث.', COLORS.search);
    const row = new ActionRowBuilder().addComponents(
      NAV.back('market'), NAV.home('market'), NAV.close('market'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showWalletMenu(interaction, client) {
    const user = await User.findOne({ discordId: interaction.user.id }).lean();
    const balance = user?.balance || 0;
    const earnings = user?.platformEarnings || 0;
    const embed = PanelManager.embed('💰 المحفظة', `رصيدك الحالي`, COLORS.wallet, {
      fields: [
        { name: '💳 رصيد المحفظة', value: formatCurrency(balance), inline: true },
        { name: '🏦 أرباح المنصة', value: formatCurrency(earnings), inline: true },
      ],
    });
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('market_wallet_balance', 'الرصيد', '💰', ButtonStyle.Primary),
      PanelManager.panelButton('market_wallet_deposit', 'إيداع', '📥', ButtonStyle.Success),
      PanelManager.panelButton('market_wallet_transfer', 'تحويل', '💸', ButtonStyle.Primary),
      PanelManager.panelButton('market_wallet_history', 'المعاملات', '📋', ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('market_wallet_withdraw', 'سحب', '🏧', ButtonStyle.Danger),
      NAV.back('market'), NAV.home('market'), NAV.close('market'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row, row2] });
  },

  async showReviewMenu(interaction, client) {
    const embed = PanelManager.embed('⭐ التقييمات', 'التقييمات والمراجعات.', COLORS.reviews);
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('market_review_mine', 'تقييماتي', '⭐', ButtonStyle.Primary),
      PanelManager.panelButton('market_review_create', 'كتابة تقييم', '✍️', ButtonStyle.Success),
      PanelManager.panelButton('market_review_list', 'جميع التقييمات', '📋', ButtonStyle.Secondary),
      NAV.back('market'), NAV.home('market'), NAV.close('market'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showLoyaltyMenu(interaction, client) {
    const embed = PanelManager.embed('🎁 نظام الولاء', 'نقاط الولاء والمكافآت.', COLORS.loyalty);
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('market_loyalty_points', 'نقاطي', '🎯', ButtonStyle.Primary),
      PanelManager.panelButton('market_loyalty_rewards', 'المكافآت', '🎁', ButtonStyle.Primary),
      PanelManager.panelButton('market_loyalty_claim', 'استبدال', '🔄', ButtonStyle.Success),
      PanelManager.panelButton('market_loyalty_top', 'المتصدرين', '🏆', ButtonStyle.Secondary),
      NAV.back('market'), NAV.home('market'), NAV.close('market'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async handleStoreAction(interaction, client, action) {
    if (action === 'store_create') {
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: '📝 لإنشاء متجر جديد، استخدم الأمر /store create', flags: MessageFlags.Ephemeral });
      }
      const storeCmd = require('../store/create');
      return storeCmd.handleCreate(interaction, client);
    }
    if (action === 'my_stores') {
      const stores = await Store.find({ ownerId: interaction.user.id }).lean();
      if (stores.length === 0) return PanelManager.update(interaction, { embeds: [PanelManager.embed('📭 لا توجد متاجر', 'لم تقم بإنشاء أي متجر بعد.', config.colors.warning)] });
      const embed = PanelManager.embed('🏪 متاجرك', stores.map((s, i) => `${i + 1}. **${s.name}** — ${s.type} — ${s.stats.totalSales} مبيعات`).join('\n'), COLORS.stores);
      const row = PanelManager.navRow('market', { state: 'my_stores' });
      return PanelManager.update(interaction, { embeds: [embed], components: [row] });
    }
    return this.showStoresMenu(interaction, client);
  },

  async showStoreDetail(interaction, client, storeId) {
    const store = await Store.findById(storeId).populate('ownerId', 'username').lean();
    if (!store) return PanelManager.update(interaction, { embeds: [PanelManager.embed('❌ متجر غير موجود', '', config.colors.error)] });
    const storeCmd = require('../store/create');
    const mock = Object.create(interaction);
    mock.options = { getString: () => storeId };
    mock.deferred = true;
    mock.deferReply = () => Promise.resolve();
    mock.editReply = (content) => PanelManager.update(interaction, content);
    return storeCmd.handleInfo(mock, client);
  },

  async handleProductAction(interaction, client, action) {
    if (action === 'prod_browse') {
      const products = await Product.find({ isActive: true }).sort({ soldCount: -1 }).limit(25).lean();
      const menu = new StringSelectMenuBuilder().setCustomId('market_product_list').setPlaceholder('اختر منتجاً...');
      for (const p of products.slice(0, 25)) {
        menu.addOptions({ label: p.name.substring(0, 100), value: p._id.toString(), description: `${formatCurrency(p.finalPrice)} • ${p.soldCount} مبيعات`, emoji: '📦' });
      }
      const embed = PanelManager.embed('📦 تصفح المنتجات', `إجمالي: ${products.length} منتج`, COLORS.products);
      const row1 = new ActionRowBuilder().addComponents(menu);
      const row2 = PanelManager.navRow('market', { state: 'prod_browse' });
      return PanelManager.update(interaction, { embeds: [embed], components: [row1, row2] });
    }
    if (action === 'prod_buy') {
      return productCmd.handleBuy(interaction, client);
    }
    if (action === 'prod_featured') {
      const products = await Product.find({ isActive: true, isFeatured: true }).sort({ soldCount: -1 }).limit(10).lean();
      const embed = PanelManager.embed('⭐ منتجات مميزة', products.length > 0 ? products.map((p, i) => `${i + 1}. **${p.name}** — ${formatCurrency(p.finalPrice)}`).join('\n') : '📭 لا توجد منتجات مميزة.', COLORS.products);
      const row = PanelManager.navRow('market', { state: 'prod_featured' });
      return PanelManager.update(interaction, { embeds: [embed], components: [row] });
    }
    return this.showProductsMenu(interaction, client);
  },

  async showProductDetail(interaction, client, productId) {
    const product = await Product.findById(productId).populate('storeId', 'name').lean();
    if (!product) return;
    const embed = EmbedBuilderUtil.productCard(product, { storeName: product.storeId?.name });
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton(`market_prod_buy_${productId}`, 'شراء', '🛒', ButtonStyle.Success),
      NAV.back('market'), NAV.home('market'), NAV.close('market'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async handleServiceAction(interaction, client, action) {
    if (action === 'serv_browse') {
      const services = await Service.find({ isActive: true }).sort({ soldCount: -1 }).limit(25).lean();
      const menu = new StringSelectMenuBuilder().setCustomId('market_service_list').setPlaceholder('اختر خدمة...');
      for (const s of services.slice(0, 25)) {
        menu.addOptions({ label: s.name.substring(0, 100), value: s._id.toString(), description: `${formatCurrency(s.finalPrice)} • ${s.soldCount} طلبات`, emoji: '💼' });
      }
      const embed = PanelManager.embed('💼 تصفح الخدمات', `إجمالي: ${services.length} خدمة`, COLORS.services);
      const row1 = new ActionRowBuilder().addComponents(menu);
      const row2 = PanelManager.navRow('market', { state: 'serv_browse' });
      return PanelManager.update(interaction, { embeds: [embed], components: [row1, row2] });
    }
    if (action === 'serv_order') {
      return serviceCmd.handleOrder(interaction, client);
    }
    return this.showServicesMenu(interaction, client);
  },

  async showServiceDetail(interaction, client, serviceId) {
    const service = await Service.findById(serviceId).populate('storeId', 'name').lean();
    if (!service) return;
    const embed = EmbedBuilderUtil.serviceCard(service, { storeName: service.storeId?.name });
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton(`market_serv_order_${serviceId}`, 'طلب', '📝', ButtonStyle.Success),
      NAV.back('market'), NAV.home('market'), NAV.close('market'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async handleSearchAction(interaction, client, action) {
    if (action === 'search_execute') {
      const searchCmd = require('../search/main');
      return searchCmd.execute(interaction, client);
    }
    return this.showSearchMenu(interaction, client);
  },

  async handleWalletAction(interaction, client, action) {
    const walletCmd = require('../wallet/main');
    if (action === 'wallet_balance') return walletCmd.execute(interaction, client);
    if (action === 'wallet_deposit') return walletCmd.handleDeposit(interaction, client);
    if (action === 'wallet_transfer') return walletCmd.handlePay(interaction, client);
    if (action === 'wallet_history') return walletCmd.handleHistory(interaction, client);
    if (action === 'wallet_withdraw') return walletCmd.execute(interaction, client);
    return this.showWalletMenu(interaction, client);
  },

  async handleReviewAction(interaction, client, action) {
    const reviewCmd = require('../review/main');
    if (action === 'review_mine') {
      const mock = Object.create(interaction);
      mock.options = { getString: () => 'user', getUser: () => interaction.user };
      mock.deferred = true;
      mock.deferReply = () => Promise.resolve();
      mock.editReply = (c) => PanelManager.update(interaction, { embeds: Array.isArray(c) ? c : [c] });
      return reviewCmd.handleList(mock, client);
    }
    if (action === 'review_create') {
      const mock = Object.create(interaction);
      mock.options = { getString: () => null };
      mock.deferred = true;
      mock.deferReply = () => Promise.resolve();
      return reviewCmd.handleCreate(mock, client);
    }
    return this.showReviewMenu(interaction, client);
  },

  async handleLoyaltyAction(interaction, client, action) {
    const loyaltyCmd = require('../loyalty/main');
    if (action === 'loyalty_points') {
      const mock = Object.create(interaction);
      mock.options = { getUser: () => interaction.user };
      mock.deferred = true;
      mock.deferReply = () => Promise.resolve();
      mock.editReply = (c) => PanelManager.update(interaction, { embeds: Array.isArray(c) ? c : [c] });
      return loyaltyCmd.handlePoints(mock, client);
    }
    if (action === 'loyalty_rewards') return loyaltyCmd.handleRewards(interaction, client);
    if (action === 'loyalty_claim') return loyaltyCmd.handleClaim(interaction, client);
    return this.showLoyaltyMenu(interaction, client);
  },
};
