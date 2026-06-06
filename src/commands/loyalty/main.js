const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { User, LoyaltyReward } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { formatNumber } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const fraudDetection = require('../../services/FraudDetectionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loyalty')
    .setDescription('نظام الولاء والنقاط')
    .addSubcommand(sub =>
      sub.setName('points')
        .setDescription('عرض نقاط الولاء')
        .addUserOption(opt => opt.setName('user').setDescription('المستخدم'))
    )
    .addSubcommand(sub =>
      sub.setName('rewards')
        .setDescription('عرض المكافآت المتاحة')
    )
    .addSubcommand(sub =>
      sub.setName('claim')
        .setDescription('استبدال نقاط بمكافأة')
        .addStringOption(opt => opt.setName('reward_id').setDescription('معرف المكافأة').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('history')
        .setDescription('سجل المكافآت المستلمة')
    )
    .addSubcommand(sub =>
      sub.setName('leaderboard')
        .setDescription('أعلى المستخدمين نقاطاً')
        .addIntegerOption(opt => opt.setName('limit').setDescription('العدد').setMinValue(1).setMaxValue(20))
    ),

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'points':
        await this.handlePoints(interaction, client);
        break;
      case 'rewards':
        await this.handleRewards(interaction, client);
        break;
      case 'claim':
        await this.handleClaim(interaction, client);
        break;
      case 'history':
        await this.handleHistory(interaction, client);
        break;
      case 'leaderboard':
        await this.handleLeaderboard(interaction, client);
        break;
    }
  },

  async handlePoints(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const user = await User.findOne({ discordId: targetUser.id }).lean();

    if (!user) {
      return interaction.editReply({ content: '❌ المستخدم غير مسجل.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.star} نقاط ولاء ${targetUser.username}`)
      .setColor(config.colors.gold)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '⭐ النقاط الحالية', value: formatNumber(user.loyaltyPoints), inline: true },
        { name: '📈 إجمالي النقاط المكتسبة', value: formatNumber(user.loyaltyPoints + (user.stats.totalPurchases * 10) + (user.stats.totalReviews * 5)), inline: true },
        { name: '🛍️ من المشتريات', value: formatNumber(user.stats.totalPurchases * 10), inline: true },
        { name: '📝 من التقييمات', value: formatNumber(user.stats.totalReviews * 5), inline: true },
        { name: '👥 من الإحالات', value: formatNumber((user.referrals?.length || 0) * 50), inline: true },
      )
      .setTimestamp();

    const rewards = config.loyalty.rewards;
    let nextReward = null;
    for (const [id, reward] of Object.entries(rewards)) {
      if (user.loyaltyPoints < reward.cost) {
        nextReward = { id, ...reward };
        break;
      }
    }

    if (nextReward) {
      embed.addFields({
        name: '🎁 المكافأة القادمة',
        value: `**${nextReward.name}** - ${formatNumber(nextReward.cost - user.loyaltyPoints)} نقطة متبقية`,
        inline: false,
      });
    } else {
      embed.addFields({
        name: '🎉 جميع المكافآت متاحة!',
        value: 'يمكنك استبدال النقاط بأي مكافأة',
        inline: false,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },

  async handleRewards(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const user = await User.findOne({ discordId: interaction.user.id }).lean();
    const userPoints = user?.loyaltyPoints || 0;

    const rewards = config.loyalty.rewards;
    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.gift} متجر المكافآت`)
      .setColor(config.colors.gold)
      .setDescription(`نقاطك الحالية: **${formatNumber(userPoints)}** ⭐`)
      .setTimestamp();

    for (const [id, reward] of Object.entries(rewards)) {
      const canAfford = userPoints >= reward.cost;
      const emoji = canAfford ? '✅' : '🔒';
      embed.addFields({
        name: `${emoji} ${reward.name}`,
        value: `**التكلفة:** ${formatNumber(reward.cost)} ⭐\n**النوع:** ${this.getRewardTypeName(reward.type)}\n**القيمة:** ${this.getRewardValue(reward)}\n**الوصف:** ${this.getRewardDescription(reward)}`,
        inline: true,
      });
    }

    const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('loyalty_claim_select')
        .setPlaceholder('اختر مكافأة للاستبدال...')
        .addOptions(
          Object.entries(rewards).map(([id, reward]) => 
            new StringSelectMenuOptionBuilder()
              .setLabel(`${reward.name} (${formatNumber(reward.cost)} ⭐)`)
              .setValue(id)
              .setDescription(`${this.getRewardTypeName(reward.type)} - ${this.getRewardValue(reward)}`)
              .setEmoji(userPoints >= reward.cost ? '✅' : '🔒')
          )
        )
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  },

  async handleClaim(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const rewardId = interaction.options.getString('reward_id');
    const reward = config.loyalty.rewards[rewardId];

    if (!reward) {
      return interaction.editReply({ content: '❌ مكافأة غير موجودة.' });
    }

    const user = await User.findOne({ discordId: interaction.user.id }).lean();
    if (!user) {
      return interaction.editReply({ content: '❌ يرجى التسجيل أولاً.' });
    }

    const fraudCheck = await fraudDetection.checkLoyaltyClaim(interaction.user.id, rewardId, interaction.guildId);
    if (fraudCheck.isFraud) {
      return interaction.editReply({ content: '🚫 تم حظر استبدال المكافأة لأسباب أمنية.' });
    }

    if (user.loyaltyPoints < reward.cost) {
      return interaction.editReply({
        content: `❌ نقاط غير كافية.\nمطلوب: ${formatNumber(reward.cost)} ⭐\nلديك: ${formatNumber(user.loyaltyPoints)} ⭐`,
      });
    }

    const existingReward = await LoyaltyReward.findOne({ userId: interaction.user.id, rewardId, status: 'claimed' }).lean();
    if (existingReward && reward.type !== 'discount') {
      return interaction.editReply({ content: '🚫 لقد استلمت هذه المكافأة مسبقاً.' });
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      user.loyaltyPoints -= reward.cost;
      await user.save({ session });

      const [loyaltyReward] = await LoyaltyReward.create([{
        userId: interaction.user.id,
        rewardId,
        name: reward.name,
        type: reward.type,
        value: reward.value,
        cost: reward.cost,
        status: 'claimed',
        expiresAt: reward.type === 'store_boost' ? new Date(Date.now() + reward.value * 24 * 60 * 60 * 1000) : null,
        metadata: {
          code: reward.type === 'discount' ? `LOYALTY${Date.now().toString(36).toUpperCase()}` : undefined,
          discountPercentage: reward.type === 'discount' ? reward.value : undefined,
          durationDays: reward.type === 'store_boost' ? reward.value : undefined,
        },
      }], { session });

      await session.commitTransaction();

      logger.info('Loyalty reward claimed', { userId: interaction.user.id, rewardId, cost: reward.cost });

      return interaction.editReply({
        content: `✅ تم استبدال **${reward.name}** بنجاح!\n💰 التكلفة: ${formatNumber(reward.cost)} ⭐\n🎁 رصيدك الجديد: ${formatNumber(user.loyaltyPoints)} ⭐\n📋 رمز المكافأة: ${loyaltyReward._id}`,
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error('Failed to claim loyalty reward', { userId: interaction.user.id, rewardId, error: error.message });
      return interaction.editReply({ content: '❌ حدث خطأ أثناء استبدال المكافأة. لم يتم خصم النقاط.' });
    } finally {
      await session.endSession();
    }
  },

  async handleHistory(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const rewards = await LoyaltyReward.find({ userId: interaction.user.id }).lean()
      .sort({ claimedAt: -1 })
      .limit(20)
      .lean();

    if (rewards.length === 0) {
      return interaction.editReply({ content: '📭 لم تستلم أي مكافآت بعد.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.chart} سجل مكافآتك`)
      .setColor(config.colors.gold)
      .setDescription(rewards.map(r => {
        const statusEmoji = r.status === 'used' ? '✅' : r.status === 'expired' ? '⏰' : '🎁';
        const date = `<t:${Math.floor(r.claimedAt / 1000)}:D>`;
        return `${statusEmoji} **${r.name}** - ${date} - ${r.status === 'used' ? 'مستخدمة' : r.status === 'expired' ? 'منتهية' : 'متاحة'}`;
      }).join('\n'))
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleLeaderboard(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const limit = interaction.options.getInteger('limit') || 10;

    const users = await User.find({ loyaltyPoints: { $gt: 0 } }).lean()
      .sort({ loyaltyPoints: -1 })
      .limit(limit)
      .lean();

    if (users.length === 0) {
      return interaction.editReply({ content: '📭 لا يوجد مستخدمون بنقاط ولاء.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.star} أعلى المستخدمين نقاط ولاء`)
      .setColor(config.colors.gold)
      .setDescription(users.map((u, i) => `${i + 1}. **${u.username}** - ${formatNumber(u.loyaltyPoints)} ⭐`).join('\n'))
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleSelectMenu(interaction, client, action) {
    if (action === 'claim_select') {
      const rewardId = interaction.values[0];
      await interaction.deferUpdate();
      const mockInteraction = Object.create(interaction);
      mockInteraction.options = { getString: () => rewardId };
      mockInteraction.deferred = true;
      mockInteraction.deferReply = () => Promise.resolve();
      mockInteraction.editReply = interaction.editReply.bind(interaction);
      return this.handleClaim(mockInteraction, client);
    }
  },

  getRewardTypeName(type) {
    const names = {
      discount: 'خصم',
      commission_waiver: 'إعفاء عمولة',
      store_boost: 'ترقية متجر',
      badge: 'شارة',
      custom: 'مخصص',
    };
    return names[type] || type;
  },

  getRewardValue(reward) {
    switch (reward.type) {
      case 'discount': return `${reward.value}%`;
      case 'commission_waiver': return `${reward.value} عملية`;
      case 'store_boost': return `${reward.value} أيام`;
      case 'badge': return reward.value;
      default: return JSON.stringify(reward.value);
    }
  },

  getRewardDescription(reward) {
    const descriptions = {
      discount: `خصم ${reward.value}% على أي عملية شراء`,
      commission_waiver: `إلغاء عمولة المنصة لـ ${reward.value} عملية`,
      store_boost: `ترقية متجرك للمميز لمدة ${reward.value} أيام`,
      badge: `الحصول على شارة ${reward.value} في ملفك الشخصي`,
    };
    return descriptions[reward.type] || 'مكافأة مخصصة';
  },
};
