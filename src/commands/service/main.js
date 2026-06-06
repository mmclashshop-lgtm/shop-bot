const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { Store, Service, User, Order, MarketplaceSettings } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { generateOrderNumber, calculateCommission, formatCurrency } = require('../../utils/helpers');
const mongoose = require('mongoose');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const PaymentService = require('../../services/PaymentService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('service')
    .setDescription('إدارة الخدمات')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('إضافة خدمة جديدة')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('تعديل خدمة')
        .addStringOption(opt => opt.setName('service_id').setDescription('معرف الخدمة').setRequired(true))
        .addStringOption(opt => opt.setName('name').setDescription('اسم الخدمة').setMaxLength(100))
        .addStringOption(opt => opt.setName('description').setDescription('وصف الخدمة').setMaxLength(3000))
        .addNumberOption(opt => opt.setName('price').setDescription('السعر').setMinValue(0))
        .addNumberOption(opt => opt.setName('delivery_time').setDescription('وقت التسليم').setMinValue(1))
        .addBooleanOption(opt => opt.setName('active').setDescription('حالة التفعيل'))
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('حذف خدمة')
        .addStringOption(opt => opt.setName('service_id').setDescription('معرف الخدمة').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('قائمة خدمات متجر')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
        .addIntegerOption(opt => opt.setName('page').setDescription('الصفحة').setMinValue(1))
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('معلومات خدمة')
        .addStringOption(opt => opt.setName('service_id').setDescription('معرف الخدمة').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('order')
        .setDescription('طلب خدمة')
        .addStringOption(opt => opt.setName('service_id').setDescription('معرف الخدمة').setRequired(true))
        .addStringOption(opt => opt.setName('package').setDescription('اسم الباقة'))
        .addStringOption(opt => opt.setName('requirements').setDescription('المتطلبات').setMaxLength(2000))
        .addStringOption(opt => opt.setName('payment_method').setDescription('طريقة الدفع').addChoices(
          { name: '💳 المحفظة', value: 'wallet' },
          { name: '🤖 ProBot كريدت', value: 'probot' }
        ))
    ),

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'add':
        await this.handleAdd(interaction, client);
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
      case 'info':
        await this.handleInfo(interaction, client);
        break;
      case 'order':
        await this.handleOrder(interaction, client);
        break;
    }
  },

  async handleAdd(interaction, client) {
    const storeId = interaction.options.getString('store_id');
    const store = await Store.findById(storeId).lean();

    if (!store) {
      return interaction.reply({ content: '❌ المتجر غير موجود.', ephemeral: true });
    }

    if (store.ownerId !== interaction.user.id) {
      return interaction.reply({ content: '🚫 غير مصرح: يمكنك إضافة خدمات لمتاجرك فقط.', ephemeral: true });
    }

    if (!store.isActive || store.isSuspended) {
      return interaction.reply({ content: '🚫 المتجر غير نشط أو موقوف.', ephemeral: true });
    }

    const settings = await MarketplaceSettings.findOne().lean();
    const serviceCount = await Service.countDocuments({ storeId: store._id, isActive: true });

    if (serviceCount >= (settings?.storeLimits?.maxServices || config.limits.maxServicesPerStore)) {
      return interaction.reply({
        content: `❌ وصلت للحد الأقصى للخدمات (${settings?.storeLimits?.maxServices || config.limits.maxServicesPerStore}).`,
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`service_add_modal_${storeId}`)
      .setTitle('إضافة خدمة جديدة');

    const nameInput = new TextInputBuilder()
      .setCustomId('service_name')
      .setLabel('اسم الخدمة')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: برمجة بوت ديسكورد مخصص')
      .setRequired(true)
      .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('service_description')
      .setLabel('وصف الخدمة')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('وصف مفصل للخدمة، ما تشمله، التقنيات المستخدمة، مراحل العمل...')
      .setRequired(true)
      .setMaxLength(3000);

    const shortDescInput = new TextInputBuilder()
      .setCustomId('service_short_desc')
      .setLabel('الوصف المختصر')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('وصف قصير للبطاقات (اختياري)')
      .setRequired(false)
      .setMaxLength(300);

    const categoryInput = new TextInputBuilder()
      .setCustomId('service_category')
      .setLabel('الفئة (programming, design, translation, video_editing, hosting, marketing, writing, music, other)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('programming')
      .setRequired(true)
      .setMaxLength(50);

    const priceInput = new TextInputBuilder()
      .setCustomId('service_price')
      .setLabel('السعر')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: 10000')
      .setRequired(true)
      .setMaxLength(20);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(shortDescInput),
      new ActionRowBuilder().addComponents(categoryInput),
      new ActionRowBuilder().addComponents(priceInput)
    );

    await interaction.showModal(modal).catch(() => {});
  },

  async handleModalSubmit(interaction, client) {
    if (!interaction.customId.startsWith('service_add_modal_')) return;

    await interaction.deferReply({ ephemeral: true });

    try {
      const storeId = interaction.customId.replace('service_add_modal_', '');
      const store = await Store.findById(storeId.lean());

      if (!store || store.ownerId !== interaction.user.id) {
        return interaction.editReply({ content: '❌ غير مصرح.' });
      }

      const name = interaction.fields.getTextInputValue('service_name');
      const description = interaction.fields.getTextInputValue('service_description');
      const shortDescription = interaction.fields.getTextInputValue('service_short_desc') || '';
      const category = interaction.fields.getTextInputValue('service_category');
      const price = parseFloat(interaction.fields.getTextInputValue('service_price'));
      if (!Number.isFinite(price) || price <= 0) {
        return interaction.editReply({ content: '❌ السعر يجب أن يكون أكبر من 0.' });
      }

      const validCategories = ['programming', 'design', 'translation', 'video_editing', 'hosting', 'marketing', 'writing', 'music', 'other'];
      if (!validCategories.includes(category)) {
        return interaction.editReply({ content: '❌ فئة غير صالحة.' });
      }

      const service = await Service.create({
        storeId: store._id,
        ownerId: interaction.user.id,
        name,
        description,
        shortDescription,
        category,
        price,
        pricingModel: 'fixed',
        deliveryTime: 3,
        deliveryTimeUnit: 'days',
        revisions: 2,
        images: [],
        tags: [],
        requirements: '',
        whatYouGet: '',
        packages: [],
      });

      store.stats.totalProducts = (store.stats.totalProducts || 0) + 1;
      await store.save();

      await this.publishServiceCard(interaction.guild, service, store, client);

      logger.info('Service created', { serviceId: service._id, storeId: store._id });

      return interaction.editReply({
        content: `✅ تم إضافة الخدمة بنجاح!\n💼 **${service.name}**\n💰 السعر: ${formatCurrency(service.price)}\n🏪 المتجر: ${store.name}`,
      });
    } catch (error) {
      logger.error('Service creation error', { error: error.message });
      return interaction.editReply({ content: `❌ حدث خطأ: ${error.message}` });
    }
  },

  async publishServiceCard(guild, service, store, client) {
    const channel = guild.channels.cache.get(store.channels.products);
    if (!channel) return;

    const embed = EmbedBuilderUtil.serviceCard(service, { storeName: store.name });

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`service_order_${service._id}`)
        .setLabel('طلب الخدمة')
        .setEmoji(config.emojis.money)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`service_info_${service._id}`)
        .setLabel('تفاصيل')
        .setEmoji(config.emojis.info)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`service_review_${service._id}`)
        .setLabel('تقييم')
        .setEmoji(config.emojis.star)
        .setStyle(ButtonStyle.Secondary)
    );

    await channel.send({ embeds: [embed], components: [row] });
  },

  async handleEdit(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const serviceId = interaction.options.getString('service_id');
    const service = await Service.findById(serviceId).populate('storeId'.lean());

    if (!service) {
      return interaction.editReply({ content: '❌ الخدمة غير موجودة.' });
    }

    if (service.ownerId !== interaction.user.id) {
      return interaction.editReply({ content: '🚫 غير مصرح: يمكنك تعديل خدماتك فقط.' });
    }

    const updates = {};
    if (interaction.options.getString('name')) updates.name = interaction.options.getString('name');
    if (interaction.options.getString('description')) updates.description = interaction.options.getString('description');
    if (interaction.options.getNumber('price') !== null) updates.price = interaction.options.getNumber('price');
    if (interaction.options.getNumber('delivery_time') !== null) updates.deliveryTime = interaction.options.getNumber('delivery_time');
    if (interaction.options.getBoolean('active') !== null) updates.isActive = interaction.options.getBoolean('active');

    Object.assign(service, updates);
    await service.save();

    return interaction.editReply({ content: '✅ تم تحديث الخدمة بنجاح.' });
  },

  async handleDelete(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const serviceId = interaction.options.getString('service_id');
    const service = await Service.findById(serviceId).populate('storeId'.lean());

    if (!service) {
      return interaction.editReply({ content: '❌ الخدمة غير موجودة.' });
    }

    if (service.ownerId !== interaction.user.id) {
      return interaction.editReply({ content: '🚫 غير مصرح: يمكنك حذف خدماتك فقط.' });
    }

    await Service.findByIdAndDelete(serviceId);

    const store = await Store.findById(service.storeId.lean());
    if (store) {
      store.stats.totalProducts = Math.max(0, store.stats.totalProducts - 1);
      await store.save();
    }

    return interaction.editReply({ content: '✅ تم حذف الخدمة بنجاح.' });
  },

  async handleList(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const page = interaction.options.getInteger('page') || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const store = await Store.findById(storeId).lean();
    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.' });
    }

    const [services, total] = await Promise.all([
      Service.find({ storeId: store._id, isActive: true }).lean()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Service.countDocuments({ storeId: store._id, isActive: true }),
    ]);

    if (services.length === 0) {
      return interaction.editReply({ content: '📭 لا توجد خدمات في هذا المتجر.' });
    }

    const totalPages = Math.ceil(total / limit);

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.service} خدمات ${store.name} (صفحة ${page}/${totalPages})`)
      .setColor(config.colors.purple)
      .setDescription(services.map((s, i) => `${skip + i + 1}. **${s.name}** - ${formatCurrency(s.finalPrice)} - ⏱️ ${s.deliveryTime} ${s.deliveryTimeUnit} - 🔄 ${s.revisions} تعديل - 🛒 ${s.soldCount}`).join('\n'))
      .setFooter({ text: `إجمالي: ${total} خدمة` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleInfo(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const serviceId = interaction.options.getString('service_id');
    const service = await Service.findById(serviceId).populate('storeId').lean();

    if (!service) {
      return interaction.editReply({ content: '❌ الخدمة غير موجودة.' });
    }

    const store = service.storeId;
    const embed = EmbedBuilderUtil.serviceCard(service, { storeName: store.name });

    embed.addFields(
      { name: '📝 الوصف الكامل', value: service.description.substring(0, 1000) + (service.description.length > 1000 ? '...' : ''), inline: false },
      { name: '⏱️ وقت التسليم', value: `${service.deliveryTime} ${service.deliveryTimeUnit}`, inline: true },
      { name: '🔄 التعديلات المسموحة', value: service.revisions.toString(), inline: true },
      { name: '💰 نموذج التسعير', value: service.pricingModel, inline: true },
      { name: '🛒 المبيعات', value: service.soldCount.toString(), inline: true },
      { name: '👁️ المشاهدات', value: service.viewCount.toString(), inline: true },
      { name: '📅 تاريخ الإضافة', value: `<t:${Math.floor(service.createdAt / 1000)}:F>`, inline: true },
    );

    if (service.packages.length > 0) {
      embed.addFields({
        name: '📦 الباقات',
        value: service.packages.map(p => `• **${p.name}** - ${formatCurrency(p.price)} - ${p.deliveryTime} ${p.deliveryTimeUnit} - ${p.revisions} تعديل${p.isPopular ? ' ⭐' : ''}`).join('\n'),
        inline: false,
      });
    }

    if (service.faq.length > 0) {
      embed.addFields({
        name: '❓ الأسئلة الشائعة',
        value: service.faq.map(f => `**س:** ${f.question}\n**ج:** ${f.answer}`).join('\n\n'),
        inline: false,
      });
    }

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`service_order_${service._id}`)
        .setLabel('طلب الخدمة')
        .setEmoji(config.emojis.money)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`service_review_${service._id}`)
        .setLabel('كتابة تقييم')
        .setEmoji(config.emojis.star)
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  },

  async handleOrder(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const serviceId = interaction.options.getString('service_id');
    const packageName = interaction.options.getString('package');
    const requirements = interaction.options.getString('requirements') || '';
    const paymentMethod = interaction.options.getString('payment_method') || 'wallet';
    const idempotencyKey = `order_${interaction.user.id}_${serviceId}_${Date.now()}`;

    const service = await Service.findById(serviceId).populate('storeId'.lean());
    if (!service) {
      return interaction.editReply({ content: '❌ الخدمة غير موجودة.' });
    }

    if (!service.isActive) {
      return interaction.editReply({ content: '🚫 الخدمة غير متاحة للطلب.' });
    }

    const store = service.storeId;
    const buyer = await User.findOne({ discordId: interaction.user.id }).lean();
    if (!buyer) {
      return interaction.editReply({ content: '❌ يرجى التسجيل أولاً.' });
    }

    let selectedPackage = service.packages.find(p => p.name === packageName) || null;
    const unitPrice = selectedPackage ? selectedPackage.price : service.price;
    const deliveryTime = selectedPackage ? selectedPackage.deliveryTime : service.deliveryTime;
    const deliveryTimeUnit = selectedPackage ? selectedPackage.deliveryTimeUnit : service.deliveryTimeUnit;
    const revisions = selectedPackage ? selectedPackage.revisions : service.revisions;

    const subtotal = unitPrice;
    const commissionRate = store.commissionRate;
    const platformFee = calculateCommission(subtotal, commissionRate);
    const taxAmount = 0;
    const total = subtotal + taxAmount + platformFee;

    const orderStatus = paymentMethod === 'probot' ? 'pending' : 'paid';

    if (paymentMethod === 'wallet' && buyer.balance < total) {
      return interaction.editReply({
        content: `❌ رصيد غير كافٍ.\nالمطلوب: ${formatCurrency(total)}\nرصيدك: ${formatCurrency(buyer.balance)}`,
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const [order] = await Order.create([{
        orderNumber: generateOrderNumber(),
        buyerId: interaction.user.id,
        sellerId: store.ownerId,
        storeId: store._id,
        type: 'service',
        itemId: service._id,
        itemName: service.name,
        itemImage: service.images[0]?.url || null,
        quantity: 1,
        unitPrice,
        subtotal,
        discount: { amount: 0, percentage: 0 },
        tax: { rate: commissionRate, amount: taxAmount },
        platformFee: { rate: commissionRate, amount: platformFee },
        total,
        currency: config.currency.code,
        status: orderStatus,
        paymentMethod,
        paymentDetails: paymentMethod === 'wallet' ? { walletAmount: total, paidAt: new Date() } : undefined,
        delivery: {
          type: 'service',
          content: requirements,
        },
        serviceDetails: {
          packageName: selectedPackage?.name || 'الأساسية',
          requirements,
          deadline: new Date(Date.now() + deliveryTime * (deliveryTimeUnit === 'hours' ? 3600000 : deliveryTimeUnit === 'days' ? 86400000 : 604800000)),
          revisionsAllowed: revisions,
        },
      }], { session });

      if (paymentMethod === 'probot') {
        const payment = await PaymentService.createPayment({
          buyerId: interaction.user.id,
          storeId: store._id,
          orderId: order._id,
          itemType: 'service',
          itemId: service._id,
          itemName: service.name,
          amount: total,
          idempotencyKey: idempotencyKey,
        });
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({
          content: `✅ تم إنشاء طلب الدفع!\n\n` +
            `📋 **رقم الطلب:** #${order.orderNumber}\n` +
            `💼 **${service.name}**${selectedPackage ? ` (${selectedPackage.name})` : ''}\n` +
            `💰 **المبلغ:** ${formatCurrency(total)}\n` +
            `🆔 **معرف الدفعة:** \`${payment.paymentId}\`\n` +
            `🔑 **كود المرجع:** \`${payment.referenceCode}\`\n\n` +
            `📤 قم بتحويل **${formatCurrency(total)}** كريدت إلى حساب المنصة بواسطة ProBot.\n` +
            `🔄 بعد التحويل، استخدم:\n\`/admin → Payments\` للتحقق من الدفعة.\nمعرف الدفعة: \`${payment.paymentId}\`\n\n` +
            `⏳ المهلة: 30 دقيقة`,
        });
      }

      const buyerUpdate = await User.findOneAndUpdate(
        { discordId: interaction.user.id, balance: { $gte: total } },
        { $inc: { balance: -total, totalSpent: total, 'stats.totalPurchases': 1 } },
        { new: true, session }
      );
      if (!buyerUpdate) {
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({ content: '❌ رصيد غير كافٍ أو حدث خطأ في التحديث.' });
      }

      const sellerUpdate = await User.findOneAndUpdate(
        { discordId: store.ownerId },
        { $inc: { balance: subtotal - platformFee, totalEarned: subtotal, 'stats.totalSales': 1 } },
        { new: true, session }
      );

      await Store.findByIdAndUpdate(store._id, {
        $inc: { 'stats.totalSales': 1, 'stats.totalRevenue': subtotal, 'stats.totalCommission': platformFee }
      }, { session });

      await Service.findByIdAndUpdate(service._id, { $inc: { soldCount: 1 } }, { session });

      const { Transaction } = require('../../database/models');
      await Transaction.create([{
        userId: interaction.user.id,
        type: 'purchase',
        status: 'completed',
        amount: -total,
        currency: config.currency.code,
        balanceBefore: buyer.balance + total,
        balanceAfter: buyerUpdate.balance,
        description: `طلب خدمة ${service.name} من ${store.name}`,
        reference: { orderId: order._id, storeId: store._id, serviceId: service._id },
        metadata: { idempotencyKey },
      }], { session });

      await Transaction.create([{
        userId: store.ownerId,
        type: 'sale',
        status: 'completed',
        amount: subtotal - platformFee,
        currency: config.currency.code,
        balanceBefore: sellerUpdate?.balance - (subtotal - platformFee) || 0,
        balanceAfter: sellerUpdate?.balance || 0,
        description: `بيع خدمة ${service.name} للمشتري ${interaction.user.username}`,
        reference: { orderId: order._id, storeId: store._id, serviceId: service._id },
        metadata: { idempotencyKey },
      }], { session });

    const settings = await MarketplaceSettings.findOne().lean();
      if (settings?.taxAccountId) {
        await Transaction.create([{
          userId: settings.taxAccountId,
          type: 'commission',
          status: 'completed',
          amount: platformFee,
          currency: config.currency.code,
          balanceBefore: 0,
          balanceAfter: platformFee,
          description: `عمولة من طلب خدمة #${order.orderNumber}`,
          reference: { orderId: order._id, storeId: store._id },
        }], { session });
      }

      await session.commitTransaction();

      await interaction.editReply({
        content: `✅ تم طلب الخدمة بنجاح!\n💼 **${service.name}**${selectedPackage ? ` (${selectedPackage.name})` : ''}\n💰 الإجمالي: ${formatCurrency(total)}\n\n📋 **رقم الطلب:** #${order.orderNumber}\n⏳ **الموعد النهائي:** <t:${Math.floor(order.serviceDetails.deadline / 1000)}:F>\n🔄 **التعديلات المسموحة:** ${revisions}\n\n📝 **المتطلبات:**\n${requirements || 'سيتم مناقشتها مع البائع'}`,
      });

      try {
        await client.users.fetch(store.ownerId).then(u => u.send({
          content: `🔔 طلب خدمة جديد!\n💼 **${service.name}**${selectedPackage ? ` (${selectedPackage.name})` : ''}\n👤 المشتري: ${interaction.user.username}\n💰 المبلغ: ${formatCurrency(subtotal - platformFee)}\n📋 رقم الطلب: #${order.orderNumber}\n📝 المتطلبات: ${requirements || 'سيتم مناقشتها'}`,
        })).catch(() => {});
      } catch (err) { logger.error('Unhandled error in commands/service/main.js', { error: err?.message }) }

      logger.info('Service ordered', { orderId: order._id, serviceId: service._id, buyerId: interaction.user.id });
    } catch (error) {
      await session.abortTransaction();
      logger.error('Service order error', { error: error.message });
      return interaction.editReply({ content: `❌ حدث خطأ أثناء معالجة الطلب: ${error.message}` });
    } finally {
      session.endSession();
    }
  },

  async handleButton(interaction, client, action) {
    if (action.startsWith('order_')) {
      const serviceId = action.replace('order_', '');
      const modal = new ModalBuilder()
        .setCustomId(`service_order_modal_${serviceId}`)
        .setTitle('طلب خدمة');

      const packageInput = new TextInputBuilder()
        .setCustomId('package')
        .setLabel('اسم الباقة (اتركه فارغاً للأساسية)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: باقة احترافية')
        .setRequired(false)
        .setMaxLength(50);

      const requirementsInput = new TextInputBuilder()
        .setCustomId('requirements')
        .setLabel('المتطلبات والتفاصيل')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('صف ما تحتاجه بالتفصيل...')
        .setRequired(false)
        .setMaxLength(2000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(packageInput),
        new ActionRowBuilder().addComponents(requirementsInput)
      );

      return interaction.showModal(modal).catch(() => {});
    }

    if (action.startsWith('info_')) {
      await interaction.deferUpdate();
      const serviceId = action.replace('info_', '');
      const service = await Service.findById(serviceId).populate('storeId').lean();
      if (!service) return interaction.editReply({ content: '❌ الخدمة غير موجودة.', flags: MessageFlags.Ephemeral });

      const embed = EmbedBuilderUtil.serviceCard(service, { storeName: service.storeId.name });
      embed.addFields({ name: '📝 الوصف الكامل', value: service.description.substring(0, 1000), inline: false });

      return interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate().catch(() => {});
    return interaction.editReply({ content: '❌ إجراء غير معروف.', flags: MessageFlags.Ephemeral });
  },

  async handleModalSubmit(interaction, client) {
    if (interaction.customId.startsWith('service_order_modal_')) {
      const serviceId = interaction.customId.replace('service_order_modal_', '');
      const packageName = interaction.fields.getTextInputValue('package') || '';
      const requirements = interaction.fields.getTextInputValue('requirements') || '';

      await interaction.deferReply({ ephemeral: true });

      const mockInteraction = Object.create(interaction);
      mockInteraction.options = {
        getString: (k) => k === 'service_id' ? serviceId : (k === 'package' ? packageName : requirements),
      };
      mockInteraction.deferred = true;
      mockInteraction.deferReply = () => Promise.resolve();
      mockInteraction.editReply = interaction.editReply.bind(interaction);

      return this.handleOrder(mockInteraction, client);
    }
  },
};
