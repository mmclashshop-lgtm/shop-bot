const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const { User, Store, Order, Review, MarketplaceSettings } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { formatNumber } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const mongoose = require('mongoose');
const auditService = require('../../services/AuditService');

function generateCorrelationId() {
  return `corr_${Date.now().toString(36)}_${require('crypto').randomBytes(6).toString('hex')}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trust')
    .setDescription('نظام الثقة والسمعة')
    .addSubcommand(sub =>
      sub.setName('verify')
        .setDescription('توثيق متجر/بائع (إدارة)')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
        .addStringOption(opt => opt.setName('level').setDescription('مستوى الثقة').addChoices(
          { name: 'موثق', value: 'verified' },
          { name: 'موثوق', value: 'trusted' },
          { name: 'مميز', value: 'premium' }
        ).setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('unverify')
        .setDescription('إلغاء توثيق متجر/بائع (إدارة)')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('profile')
        .setDescription('عرض ملف الثقة')
        .addUserOption(opt => opt.setName('user').setDescription('المستخدم'))
    )
    .addSubcommand(sub =>
      sub.setName('leaderboard')
        .setDescription('أعلى البائعين ثقة')
        .addIntegerOption(opt => opt.setName('limit').setDescription('العدد').setMinValue(1).setMaxValue(20))
    )
    .addSubcommand(sub =>
      sub.setName('requirements')
        .setDescription('متطلبات كل مستوى ثقة')
    ),

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    if (['verify', 'unverify'].includes(subcommand)) {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '🚫 هذا الأمر للمشرفين فقط.', ephemeral: true });
      }
    }

    switch (subcommand) {
      case 'verify':
        await this.handleVerify(interaction, client);
        break;
      case 'unverify':
        await this.handleUnverify(interaction, client);
        break;
      case 'profile':
        await this.handleProfile(interaction, client);
        break;
      case 'leaderboard':
        await this.handleLeaderboard(interaction, client);
        break;
      case 'requirements':
        await this.handleRequirements(interaction, client);
        break;
    }
  },

  async handleVerify(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const level = interaction.options.getString('level');

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const store = await Store.findById(storeId).session(session.lean());
      if (!store) {
        await session.abortTransaction();
        return interaction.editReply({ content: '❌ المتجر غير موجود.' });
      }

      if (level !== 'premium') {
        const stats = await this.getSellerStats(store.ownerId);
        const req = level === 'verified'
          ? { minSales: 10, minRating: 4.0, minAge: 7, name: 'موثق' }
          : { minSales: 50, minRating: 4.5, minAge: 30, name: 'موثوق' };

        const missing = [];
        if (stats.completedSales < req.minSales)
          missing.push(`• **${req.minSales}** عملية بيع مكتملة (لديك **${stats.completedSales}**)`);
        if (stats.averageRating < req.minRating)
          missing.push(`• تقييم **${req.minRating.toFixed(1)}** فأكثر (تقييمك **${stats.averageRating.toFixed(1)}**)`);
        if (stats.accountAgeDays < req.minAge)
          missing.push(`• عمر الحساب **${req.minAge}** يوم فأكثر (عمر الحساب **${stats.accountAgeDays}** يوم)`);

        if (missing.length > 0) {
          await session.abortTransaction();
          return interaction.editReply({
            content: `❌ **لا يمكن رفع الثقة إلى "${req.name}" - المتطلبات غير مكتملة:**\n${missing.join('\n')}\n\nيرجى تحقيق جميع المتطلبات ثم المحاولة مرة أخرى.`,
          });
        }
      }

      store.type = level;
      await store.save({ session });

      const seller = await User.findOne({ discordId: store.ownerId }).session(session.lean());
      if (seller) {
        seller.trustLevel = level;
        seller.trustBadge = level;
        await seller.save({ session });
      }

      const settings = await MarketplaceSettings.findOne().session(session.lean());
      const verificationFee = settings?.verificationFee || 25000;

      if (verificationFee > 0 && seller) {
        const balanceBefore = seller.balance;
        const updated = await User.findOneAndUpdate(
          { discordId: store.ownerId, balance: { $gte: verificationFee } },
          { $inc: { balance: -verificationFee } },
          { new: true, session }
        );
        if (!updated) {
          await session.abortTransaction();
          return interaction.editReply({ content: `❌ رصيد غير كافٍ لرسوم التوثيق (${verificationFee.toLocaleString()} كريدت).` });
        }

        const { Transaction } = require('../../database/models');
        await Transaction.create([{
          userId: store.ownerId,
          type: 'verification_fee',
          status: 'completed',
          amount: -verificationFee,
          currency: config.currency.code,
          balanceBefore: balanceBefore,
          balanceAfter: updated.balance,
          description: `رسوم توثيق المتجر - مستوى ${level}`,
          reference: { storeId: store._id },
        }], { session });
      }

      await session.commitTransaction();

      logger.info('Store verified', { storeId, level, by: interaction.user.id });
      const correlationId = generateCorrelationId();

      await auditService.log('trust_level_changed', interaction.user.id, {
        targetId: storeId,
        targetType: 'store',
        details: {
          storeId,
          storeName: store.name,
          oldLevel: store.type,
          newLevel: level,
          verificationFee,
          sellerId: store.ownerId,
          changedBy: interaction.user.id,
          correlationId,
        },
        guildId: interaction.guildId,
        metadata: { commandName: 'trust verify' },
      });

      return interaction.editReply({
        content: `✅ تم توثيق متجر **${store.name}** كمستوى **${level}**.\n💰 تم خصم ${verificationFee} ${config.currency.symbol} كرسوم توثيق.`,
      });
    } catch (error) {
      await session.abortTransaction();
      logger.error('Verification failed', { storeId, level, error: error.message });
      return interaction.editReply({ content: '❌ حدث خطأ أثناء التوثيق. تم إلغاء العملية.' });
    } finally {
      session.endSession();
    }
  },

  async handleUnverify(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const store = await Store.findById(storeId).session(session.lean());
      if (!store) {
        await session.abortTransaction();
        return interaction.editReply({ content: '❌ المتجر غير موجود.' });
      }

      store.type = 'free';
      await store.save({ session });

      const seller = await User.findOne({ discordId: store.ownerId }).session(session.lean());
      if (seller) {
        seller.trustLevel = 'none';
        seller.trustBadge = null;
        await seller.save({ session });
      }

      await session.commitTransaction();

      logger.info('Store unverified', { storeId, by: interaction.user.id });
      const correlationId = generateCorrelationId();

      await auditService.log('trust_level_changed', interaction.user.id, {
        targetId: storeId,
        targetType: 'store',
        details: {
          storeId,
          storeName: store.name,
          oldLevel: store.type,
          newLevel: 'free',
          sellerId: store.ownerId,
          changedBy: interaction.user.id,
          correlationId,
        },
        guildId: interaction.guildId,
        metadata: { commandName: 'trust unverify' },
      });

      return interaction.editReply({ content: `✅ تم إلغاء توثيق متجر **${store.name}**.` });
    } catch (error) {
      await session.abortTransaction();
      logger.error('Unverify failed', { storeId, error: error.message });
      return interaction.editReply({ content: '❌ حدث خطأ أثناء إلغاء التوثيق.' });
    } finally {
      session.endSession();
    }
  },

  async handleProfile(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const user = await User.findOne({ discordId: targetUser.id }).lean();

    if (!user) {
      return interaction.editReply({ content: '❌ المستخدم غير مسجل.' });
    }

    const stores = await Store.find({ ownerId: targetUser.id, isActive: true }).lean();

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.user} ملف ثقة ${targetUser.username}`)
      .setColor(this.getTrustColor(user.trustLevel))
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '🏆 مستوى الثقة', value: this.getTrustName(user.trustLevel), inline: true },
        { name: '⭐ متوسط التقييم', value: user.stats.averageRating.toFixed(1), inline: true },
        { name: '📝 عدد التقييمات', value: user.stats.totalReviews.toString(), inline: true },
        { name: '🛒 إجمالي المبيعات', value: user.stats.totalSales.toString(), inline: true },
        { name: '🛍️ إجمالي المشتريات', value: user.stats.totalPurchases.toString(), inline: true },
        { name: '🏪 عدد المتاجر', value: stores.length.toString(), inline: true },
      )
      .setTimestamp();

    if (stores.length > 0) {
      embed.addFields({
        name: '🏪 متاجرك',
        value: stores.map(s => `• **${s.name}** (${s.type}) - ${s.stats.totalSales} مبيعات`).join('\n'),
        inline: false,
      });
    }

    const trustInfo = this.getTrustRequirements(user.trustLevel);
    if (trustInfo) {
      embed.addFields({
        name: '📋 متطلبات المستوى القادم',
        value: trustInfo,
        inline: false,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },

  async handleLeaderboard(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const limit = interaction.options.getInteger('limit') || 10;

    const users = await User.find({ trustLevel: { $ne: 'none' } }).lean()
      .sort({ 'stats.averageRating': -1, 'stats.totalSales': -1, 'stats.totalReviews': -1 })
      .limit(limit)
      .lean();

    if (users.length === 0) {
      return interaction.editReply({ content: '📭 لا يوجد بائعون موثقون.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.trusted} قائمة أعلى البائعين ثقة`)
      .setColor(config.colors.gold)
      .setDescription(users.map((u, i) => {
        const trustEmoji = this.getTrustEmoji(u.trustLevel);
        return `${i + 1}. ${trustEmoji} **${u.username}** - ${this.getTrustName(u.trustLevel)} - ⭐ ${u.stats.averageRating.toFixed(1)} (${u.stats.totalReviews}) - 🛒 ${u.stats.totalSales}`;
      }).join('\n'))
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleRequirements(interaction, client) {
    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.settings} متطلبات مستويات الثقة`)
      .setColor(config.colors.primary)
      .addFields(
        { name: '✅ موثق (Verified)', value: '• 10 عمليات بيع مكتملة\n• تقييم 4.0+\n• متجر عمره 7+ أيام\n• لا يوجد مخالفات\n• رسوم: 25,000 كريدت', inline: false },
        { name: '🏆 موثوق (Trusted)', value: '• 50 عملية بيع مكتملة\n• تقييم 4.5+\n• متجر عمره 30+ يوم\n• لا يوجد مخالفات\n• رسوم: 25,000 كريدت', inline: false },
        { name: '💎 مميز (Premium)', value: '• مراجعة يدوية من الإدارة\n• لا توجد متطلبات تلقائية\n• يتطلب سمعة ممتازة ومساهمة فعالة', inline: false },
      )
      .setFooter({ text: 'يتم المراجعة يدوياً من قبل الإدارة' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
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
      none: 'لا شيء ⚪',
      verified: 'موثق ✅',
      trusted: 'موثوق 🏆',
      premium: 'مميز 💎',
    };
    return names[level] || level;
  },

  getTrustEmoji(level) {
    const emojis = {
      none: '⚪',
      verified: '✅',
      trusted: '🏆',
      premium: '💎',
    };
    return emojis[level] || '⚪';
  },

  getTrustRequirements(currentLevel) {
    const requirements = {
      none: 'للحصول على **موثق**: 10 مبيعات + تقييم 4.0+ + 7 أيام + لا مخالفات',
      verified: 'للحصول على **موثوق**: 50 مبيعة + تقييم 4.5+ + 30 يوم + لا مخالفات',
      trusted: 'للحصول على **مميز**: مراجعة يدوية من الإدارة',
      premium: 'أعلى مستوى! 🎉',
    };
    return requirements[currentLevel] || '';
  },

  async getSellerStats(userId) {
    const completedSales = await Order.countDocuments({ sellerId: userId, status: 'completed' });

    const ratingResult = await Review.aggregate([
      { $match: { sellerId: userId } },
      { $group: { _id: null, averageRating: { $avg: '$rating' } } },
    ]);
    const averageRating = ratingResult.length > 0 ? ratingResult[0].averageRating : 0;

    const user = await User.findOne({ discordId: userId }).select('createdAt').lean();
    const accountAgeDays = user
      ? Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return { completedSales, averageRating, accountAgeDays };
  },
};
