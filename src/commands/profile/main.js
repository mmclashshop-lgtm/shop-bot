const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { PanelManager, NAV } = require('../../utils/PanelManager');
const config = require('../../config');
const { User, Store, Order, Review } = require('../../database/models');
const { formatCurrency, formatNumber } = require('../../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('👤 ملفك الشخصي وإحصائياتك'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    return this.showProfile(interaction);
  },

  async showProfile(interaction) {
    const user = await User.findOne({ discordId: interaction.user.id }).lean();
    if (!user) {
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('❌ غير مسجل', 'يرجى التسجيل أولاً.', config.colors.error)] });
    }
    const stores = await Store.find({ ownerId: interaction.user.id, isActive: true }).lean();
    const orders = await Order.countDocuments({ buyerId: interaction.user.id });
    const reviews = await Review.countDocuments({ reviewerId: interaction.user.id });

    const embed = new EmbedBuilder()
      .setTitle(`👤 ملف ${interaction.user.username}`)
      .setColor(config.colors.primary)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: '💰 رصيد المحفظة', value: formatCurrency(user.balance || 0), inline: true },
        { name: '🏦 أرباح المنصة', value: formatCurrency(user.platformEarnings || 0), inline: true },
        { name: '🎯 نقاط الولاء', value: formatNumber(user.loyaltyPoints || 0), inline: true },
        { name: '🏆 مستوى الثقة', value: user.trustLevel || 'جديد', inline: true },
        { name: '📦 الطلبات', value: orders.toString(), inline: true },
        { name: '⭐ التقييمات', value: reviews.toString(), inline: true },
        { name: '🏪 المتاجر', value: stores.length.toString(), inline: true },
        { name: '📊 إجمالي المشتريات', value: formatNumber(user.stats?.totalPurchases || 0), inline: true },
        { name: '📈 إجمالي المبيعات', value: formatNumber(user.stats?.totalSales || 0), inline: true },
        { name: '💵 إجمالي الإنفاق', value: formatCurrency(user.totalSpent || 0), inline: true },
        { name: '📈 إجمالي الأرباح', value: formatCurrency(user.totalEarned || 0), inline: true },
      )
      .setFooter({ text: `تم التسجيل: ${user.createdAt ? new Date(user.createdAt).toLocaleDateString('ar-SA') : 'N/A'}` })
      .setTimestamp();

    if (stores.length > 0) {
      const storeList = stores.map(s => `• **${s.name}** (${s.type}) — ${s.stats.totalSales} مبيعات`).join('\n');
      embed.addFields({ name: '🏪 متاجرك', value: storeList, inline: false });
    }

    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('profile_refresh', 'تحديث', '🔄', ButtonStyle.Secondary),
      NAV.close('profile'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async handleButton(interaction, client, action) {
    await PanelManager.defer(interaction);
    if (action === 'refresh') return this.showProfile(interaction);
    if (action === 'close') return interaction.deleteReply().catch(() => {});
    return this.showProfile(interaction);
  },
};
