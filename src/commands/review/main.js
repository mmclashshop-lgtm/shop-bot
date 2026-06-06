const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { Order, Review, Store, Product, Service, User } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { validateReviewCreate } = require('../../utils/validation');
const { formatCurrency } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const auditService = require('../../services/AuditService');
const fraudDetection = require('../../services/FraudDetectionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('نظام التقييمات')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('كتابة تقييم لطلب مكتمل')
        .addStringOption(opt => opt.setName('order_id').setDescription('معرف الطلب').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('تعديل تقييمك')
        .addStringOption(opt => opt.setName('review_id').setDescription('معرف التقييم').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('حذف تقييمك')
        .addStringOption(opt => opt.setName('review_id').setDescription('معرف التقييم').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('عرض تقييمات منتج/متجر')
        .addStringOption(opt => opt.setName('type').setDescription('النوع').setRequired(true).addChoices(
          { name: 'منتج', value: 'product' },
          { name: 'خدمة', value: 'service' },
          { name: 'متجر', value: 'store' }
        ))
        .addStringOption(opt => opt.setName('id').setDescription('المعرف').setRequired(true))
        .addIntegerOption(opt => opt.setName('page').setDescription('الصفحة').setMinValue(1))
    )
    .addSubcommand(sub =>
      sub.setName('reply')
        .setDescription('الرد على تقييم (للبائع)')
        .addStringOption(opt => opt.setName('review_id').setDescription('معرف التقييم').setRequired(true))
        .addStringOption(opt => opt.setName('comment').setDescription('الرد').setRequired(true).setMaxLength(1000))
    )
    .addSubcommand(sub =>
      sub.setName('vote')
        .setDescription('التصويت على فائدة التقييم')
        .addStringOption(opt => opt.setName('review_id').setDescription('معرف التقييم').setRequired(true))
        .addStringOption(opt => opt.setName('vote').setDescription('نوع التصويت').setRequired(true).addChoices(
          { name: 'مفيد', value: 'helpful' },
          { name: 'غير مفيد', value: 'unhelpful' }
        ))
    )
    .addSubcommand(sub =>
      sub.setName('report')
        .setDescription('الإبلاغ عن تقييم')
        .addStringOption(opt => opt.setName('review_id').setDescription('معرف التقييم').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('السبب').setRequired(true).setMaxLength(500))
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
      case 'list':
        await this.handleList(interaction, client);
        break;
      case 'reply':
        await this.handleReply(interaction, client);
        break;
      case 'vote':
        await this.handleVote(interaction, client);
        break;
      case 'report':
        await this.handleReport(interaction, client);
        break;
    }
  },

  async handleCreate(interaction, client) {
    const orderId = interaction.options.getString('order_id');
    const order = await Order.findById(orderId).populate('storeId').lean();

    if (!order) {
      return interaction.reply({ content: '❌ الطلب غير موجود.', ephemeral: true });
    }

    if (order.buyerId !== interaction.user.id) {
      return interaction.reply({ content: '🚫 يمكنك تقييم طلباتك فقط.', ephemeral: true });
    }

    // Prevent self-review (buyer cannot review their own store)
    if (order.sellerId === interaction.user.id) {
      return interaction.reply({ content: '🚫 لا يمكنك تقييم متجرك الخاص.', ephemeral: true });
    }

    if (!order.canBeReviewed) {
      return interaction.reply({ content: '🚫 لا يمكن تقييم هذا الطلب (لم يكتمل أو تم تقييمه مسبقاً).', ephemeral: true });
    }

    // Check for existing review for this order
    const existingReview = await Review.findOne({ orderId: order._id }).lean();
    if (existingReview) {
      return interaction.reply({ content: '🚫 تم تقييم هذا الطلب مسبقاً.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`review_create_modal_${orderId}`)
      .setTitle(`تقييم: ${order.itemName}`);

    const ratingInput = new TextInputBuilder()
      .setCustomId('rating')
      .setLabel('التقييم (1-5)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('5')
      .setRequired(true)
      .setMaxLength(1);

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('العنوان')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: منتج ممتاز وسريع التسليم')
      .setRequired(false)
      .setMaxLength(200);

    const commentInput = new TextInputBuilder()
      .setCustomId('comment')
      .setLabel('التعليق')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('شارك تجربتك مع المنتج/الخدمة...')
      .setRequired(false)
      .setMaxLength(2000);

    const prosInput = new TextInputBuilder()
      .setCustomId('pros')
      .setLabel('المميزات (اختياري)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('ما أعجبك في المنتج/الخدمة')
      .setRequired(false)
      .setMaxLength(1000);

    const consInput = new TextInputBuilder()
      .setCustomId('cons')
      .setLabel('العيوب (اختياري)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('ما يمكن تحسينه')
      .setRequired(false)
      .setMaxLength(1000);

    modal.addComponents(
      new ActionRowBuilder().addComponents(ratingInput),
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(commentInput),
      new ActionRowBuilder().addComponents(prosInput),
      new ActionRowBuilder().addComponents(consInput)
    );

    await interaction.showModal(modal).catch(() => {});
  },

  async handleModalSubmit(interaction, client) {
    if (!interaction.customId.startsWith('review_create_modal_')) {
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: '❌ خطأ: النموذج غير معروف', components: [] }).catch(() => {});
        } else {
          await interaction.reply({ content: '❌ خطأ: النموذج غير معروف', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const orderId = interaction.customId.replace('review_create_modal_', '');
      const order = await Order.findById(orderId).populate('storeId'.lean());

      if (!order || order.buyerId !== interaction.user.id || !order.canBeReviewed) {
        return interaction.editReply({ content: '❌ لا يمكن تقييم هذا الطلب.' });
      }

      // Prevent self-review
      if (order.sellerId === interaction.user.id) {
        return interaction.editReply({ content: '🚫 لا يمكنك تقييم متجرك الخاص.' });
      }

      // Check for existing review
      const existingReview = await Review.findOne({ orderId: order._id }).lean();
      if (existingReview) {
        return interaction.editReply({ content: '🚫 تم تقييم هذا الطلب مسبقاً.' });
      }

      const fraudCheck = await fraudDetection.checkReview(interaction.user.id, orderId, interaction.guildId);
      if (fraudCheck.isFraud) {
        return interaction.editReply({ content: '🚫 تم حظر التقييم لأسباب أمنية.' });
      }

      const data = {
        rating: parseInt(interaction.fields.getTextInputValue('rating')),
        title: interaction.fields.getTextInputValue('title') || '',
        comment: interaction.fields.getTextInputValue('comment') || '',
        pros: interaction.fields.getTextInputValue('pros') || '',
        cons: interaction.fields.getTextInputValue('cons') || '',
      };

      const validated = validateReviewCreate(data);

      const review = await Review.create({
        orderId: order._id,
        reviewerId: interaction.user.id,
        sellerId: order.sellerId,
        storeId: order.storeId,
        type: order.type,
        itemId: order.itemId,
        itemName: order.itemName,
        ...validated,
        isVerifiedPurchase: true,
      });

      order.review = {
        productId: order.type === 'product' ? order.itemId : undefined,
        serviceId: order.type === 'service' ? order.itemId : undefined,
        rating: review.rating,
        comment: review.comment,
        createdAt: new Date(),
        isAnonymous: review.isAnonymous,
      };
      await order.save();

      await this.updateRatings(order, review);

      const buyer = await User.findOne({ discordId: interaction.user.id }).lean();
      if (buyer) {
        buyer.loyaltyPoints += 5;
        buyer.stats.totalReviews++;
        await buyer.save();
      }

      logger.info('Review created', { reviewId: review._id, orderId: order._id, rating: review.rating });

      return interaction.editReply({
        content: `✅ تم نشر تقييمك بنجاح!\n⭐ التقييم: ${'⭐'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}\n🎁 حصلت على 5 نقاط ولاء!`,
      });
    } catch (error) {
      logger.error('Review creation error', { error: error.message });
      return interaction.editReply({ content: `❌ حدث خطأ: ${error.message}` });
    }
  },

  async updateRatings(order, review) {
    const { Store, Product, Service } = require('../../database/models');

    const store = await Store.findById(order.storeId.lean());
    if (store) {
      const allReviews = await Review.find({ storeId: store._id, isHidden: false }).lean();
      const totalRating = allReviews.reduce((sum, r) => sum + r.rating, 0);
      const count = allReviews.length;
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      allReviews.forEach(r => distribution[r.rating]++);

      store.rating = { average: count > 0 ? totalRating / count : 0, count, distribution };
      await store.save();
    }

    if (order.type === 'product') {
      const product = await Product.findById(order.itemId.lean());
      if (product) {
        const allReviews = await Review.find({ itemId: product._id, type: 'product', isHidden: false }).lean();
        const totalRating = allReviews.reduce((sum, r) => sum + r.rating, 0);
        const count = allReviews.length;
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        allReviews.forEach(r => distribution[r.rating]++);

        product.rating = { average: count > 0 ? totalRating / count : 0, count, distribution };
        await product.save();
      }
    } else {
      const service = await Service.findById(order.itemId.lean());
      if (service) {
        const allReviews = await Review.find({ itemId: service._id, type: 'service', isHidden: false }).lean();
        const totalRating = allReviews.reduce((sum, r) => sum + r.rating, 0);
        const count = allReviews.length;
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        allReviews.forEach(r => distribution[r.rating]++);

        service.rating = { average: count > 0 ? totalRating / count : 0, count, distribution };
        await service.save();
      }
    }

    const seller = await User.findOne({ discordId: order.sellerId }).lean();
    if (seller) {
      const allSellerReviews = await Review.find({ sellerId: seller.discordId, isHidden: false }).lean();
      const totalRating = allSellerReviews.reduce((sum, r) => sum + r.rating, 0);
      const count = allSellerReviews.length;
      seller.stats.averageRating = count > 0 ? totalRating / count : 0;
      seller.stats.totalReviews = count;
      await seller.save();
    }
  },

  async handleEdit(interaction, client) {
    const reviewId = interaction.options.getString('review_id');
    const review = await Review.findById(reviewId).lean();

    if (!review) {
      return interaction.reply({ content: '❌ التقييم غير موجود.', ephemeral: true });
    }

    if (review.reviewerId !== interaction.user.id) {
      return interaction.reply({ content: '🚫 يمكنك تعديل تقييماتك فقط.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`review_edit_modal_${reviewId}`)
      .setTitle('تعديل التقييم');

    const ratingInput = new TextInputBuilder()
      .setCustomId('rating')
      .setLabel('التقييم (1-5)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('5')
      .setRequired(true)
      .setMaxLength(1)
      .setValue(review.rating.toString());

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('العنوان')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: منتج ممتاز')
      .setRequired(false)
      .setMaxLength(200)
      .setValue(review.title);

    const commentInput = new TextInputBuilder()
      .setCustomId('comment')
      .setLabel('التعليق')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('شارك تجربتك...')
      .setRequired(false)
      .setMaxLength(2000)
      .setValue(review.comment);

    modal.addComponents(
      new ActionRowBuilder().addComponents(ratingInput),
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(commentInput)
    );

    await interaction.showModal(modal).catch(() => {});
  },

  async handleDelete(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const reviewId = interaction.options.getString('review_id');
    const review = await Review.findById(reviewId).lean();

    if (!review) {
      return interaction.editReply({ content: '❌ التقييم غير موجود.' });
    }

    if (review.reviewerId !== interaction.user.id) {
      const user = await User.findOne({ discordId: interaction.user.id }).lean();
      if (!user || user.trustLevel !== 'premium') {
        return interaction.editReply({ content: '🚫 غير مصرح.' });
      }
    }

    await auditService.log('review_deleted', interaction.user.id, {
      targetId: reviewId,
      targetType: 'review',
      details: {
        reviewId,
        reviewerId: review.reviewerId,
        sellerId: review.sellerId,
        rating: review.rating,
        title: review.title,
        orderId: review.orderId,
        timestamp: new Date(),
      },
    });

    await Review.findByIdAndDelete(reviewId);

    const order = await Order.findById(review.orderId.lean());
    if (order) {
      order.review = undefined;
      await order.save();
    }

    await this.updateRatingsAfterDelete(review);

    return interaction.editReply({ content: '✅ تم حذف التقييم.' });
  },

  async updateRatingsAfterDelete(review) {
    await this.updateRatings({ storeId: review.storeId, sellerId: review.sellerId, type: review.type, itemId: review.itemId }, review);
  },

  async handleList(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const type = interaction.options.getString('type');
    const id = interaction.options.getString('id');
    const page = interaction.options.getInteger('page') || 1;
    const limit = 5;
    const skip = (page - 1) * limit;

    let query = { isHidden: false };
    let targetName = '';

    if (type === 'store') {
      query.storeId = id;
      const store = await Store.findById(id).lean();
      targetName = store?.name || 'متجر';
    } else if (type === 'product') {
      query.itemId = id;
      query.type = 'product';
      const product = await Product.findById(id).lean();
      targetName = product?.name || 'منتج';
    } else {
      query.itemId = id;
      query.type = 'service';
      const service = await Service.findById(id).lean();
      targetName = service?.name || 'خدمة';
    }

    const [reviews, total] = await Promise.all([
      Review.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Review.countDocuments(query),
    ]);

    if (reviews.length === 0) {
      return interaction.editReply({ content: `📭 لا توجد تقييمات لـ ${targetName}.` });
    }

    const totalPages = Math.ceil(total / limit);

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.star} تقييمات ${targetName}`)
      .setColor(config.colors.gold)
      .setDescription(reviews.map((r, i) => {
        const stars = '⭐'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
        const reviewer = r.isAnonymous ? 'مجهول' : `<@${r.reviewerId}>`;
        const verified = r.isVerifiedPurchase ? ' ✅' : '';
        const reply = r.sellerReply ? `\n💬 **رد البائع:** ${r.sellerReply.comment}` : '';
        return `${skip + i + 1}. ${stars} **${r.title || 'بدون عنوان'}**\n${r.comment.substring(0, 200)}${reply}\n— ${reviewer}${verified}`;
      }).join('\n\n'))
      .setFooter({ text: `صفحة ${page}/${totalPages} • إجمالي: ${total}` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleReply(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const reviewId = interaction.options.getString('review_id');
    const comment = interaction.options.getString('comment');

    const review = await Review.findById(reviewId).populate('storeId'.lean());

    if (!review) {
      return interaction.editReply({ content: '❌ التقييم غير موجود.' });
    }

    const store = review.storeId;
    if (store.ownerId !== interaction.user.id) {
      return interaction.editReply({ content: '🚫 يمكنك الرد على تقييمات متاجرك فقط.' });
    }

    if (review.sellerReply) {
      return interaction.editReply({ content: '🚫 تم الرد على هذا التقييم مسبقاً.' });
    }

    review.sellerReply = { comment, repliedAt: new Date() };
    await review.save();

    return interaction.editReply({ content: '✅ تم إضافة ردك على التقييم.' });
  },

  async handleVote(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const reviewId = interaction.options.getString('review_id');
    const voteType = interaction.options.getString('vote');
    const voteValue = voteType === 'helpful' ? 1 : -1;

    const review = await Review.findById(reviewId.lean());
    if (!review) {
      return interaction.editReply({ content: '❌ التقييم غير موجود.' });
    }

    if (review.reviewerId === interaction.user.id) {
      return interaction.editReply({ content: '🚫 لا يمكنك التصويت على تقييمك الخاص.' });
    }

    const existingVote = review.votes.find(v => v.userId === interaction.user.id);
    if (existingVote) {
      if (existingVote.vote === voteValue) {
        return interaction.editReply({ content: '🚫 لقد صوتت بالفعل بهذا الاتجاه.' });
      }
      existingVote.vote = voteValue;
      existingVote.votedAt = new Date();
    } else {
      review.votes.push({ userId: interaction.user.id, vote: voteValue, votedAt: new Date() });
    }

    review.helpfulVotes = review.votes.filter(v => v.vote === 1).length;
    review.unhelpfulVotes = review.votes.filter(v => v.vote === -1).length;
    await review.save();

    return interaction.editReply({
      content: `✅ تم تسجيل تصويتك: ${voteType === 'helpful' ? '👍 مفيد' : '👎 غير مفيد'}`,
    });
  },

  async handleReport(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const reviewId = interaction.options.getString('review_id');
    const reason = interaction.options.getString('reason');

    const review = await Review.findById(reviewId.lean());
    if (!review) {
      return interaction.editReply({ content: '❌ التقييم غير موجود.' });
    }

    const alreadyReported = review.reportedBy.some(r => r.userId === interaction.user.id);
    if (alreadyReported) {
      return interaction.editReply({ content: '🚫 لقد أبلغت عن هذا التقييم مسبقاً.' });
    }

    review.reportedBy.push({ userId: interaction.user.id, reason, reportedAt: new Date() });
    review.isReported = true;
    await review.save();

    logger.warn('Review reported', { reviewId, reportedBy: interaction.user.id, reason });

    return interaction.editReply({ content: '✅ تم الإبلاغ عن التقييم. سيتم مراجعته من قبل الإدارة.' });
  },

  async handleButton(interaction, client, action) {
    await interaction.deferUpdate();
    logger.warn('Review button not implemented', { action, userId: interaction.user.id });
    await interaction.editReply({ content: '❌ هذا الزر غير متاح حالياً.', components: [] });
  },
};
