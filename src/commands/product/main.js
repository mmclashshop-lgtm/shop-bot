const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const mongoose = require('mongoose');
const { Store, Product, User, Order, Review, Coupon, Transaction, MarketplaceSettings } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const PaginationUtil = require('../../utils/pagination');
const { validateProductCreate } = require('../../utils/validation');
const { generateOrderNumber, calculateCommission, formatCurrency } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const AIService = require('../../services/AIService');
const auditService = require('../../services/AuditService');
const webhookService = require('../../services/WebhookService');
const PaymentService = require('../../services/PaymentService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('product')
    .setDescription('إدارة المنتجات')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('إضافة منتج جديد')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('تعديل منتج')
        .addStringOption(opt => opt.setName('product_id').setDescription('معرف المنتج').setRequired(true))
        .addStringOption(opt => opt.setName('name').setDescription('اسم المنتج').setMaxLength(100))
        .addStringOption(opt => opt.setName('description').setDescription('وصف المنتج').setMaxLength(2000))
        .addNumberOption(opt => opt.setName('price').setDescription('السعر').setMinValue(0))
        .addNumberOption(opt => opt.setName('stock').setDescription('المخزون (-1 للا نهائي)').setMinValue(-1))
        .addStringOption(opt => opt.setName('category').setDescription('الفئة').setMaxLength(50))
        .addBooleanOption(opt => opt.setName('active').setDescription('حالة التفعيل'))
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('حذف منتج')
        .addStringOption(opt => opt.setName('product_id').setDescription('معرف المنتج').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('قائمة منتجات متجر')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
        .addIntegerOption(opt => opt.setName('page').setDescription('رقم الصفحة').setMinValue(1))
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('معلومات منتج')
        .addStringOption(opt => opt.setName('product_id').setDescription('معرف المنتج').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('buy')
        .setDescription('شراء منتج')
        .addStringOption(opt => opt.setName('product_id').setDescription('معرف المنتج').setRequired(true))
        .addIntegerOption(opt => opt.setName('quantity').setDescription('الكمية').setMinValue(1))
        .addStringOption(opt => opt.setName('coupon').setDescription('كود خصم'))
        .addStringOption(opt => opt.setName('payment_method').setDescription('طريقة الدفع').addChoices(
          { name: '💳 المحفظة', value: 'wallet' },
          { name: '🤖 ProBot كريدت', value: 'probot' }
        ))
    )
    .addSubcommand(sub =>
      sub.setName('ai_generate')
        .setDescription('إنشاء وصف منتج بالذكاء الاصطناعي')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر').setRequired(true))
        .addStringOption(opt => opt.setName('name').setDescription('اسم المنتج').setRequired(true))
        .addStringOption(opt => opt.setName('category').setDescription('الفئة').setRequired(true))
        .addNumberOption(opt => opt.setName('price').setDescription('السعر المتوقع'))
        .addStringOption(opt => opt.setName('features').setDescription('المميزات (مفصولة بفواصل)'))
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
      case 'buy':
        await this.handleBuy(interaction, client);
        break;
      case 'ai_generate':
        await this.handleAIGenerate(interaction, client);
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
      return interaction.reply({ content: '🚫 غير مصرح: يمكنك إضافة منتجات لمتاجرك فقط.', ephemeral: true });
    }

    if (!store.isActive || store.isSuspended) {
      return interaction.reply({ content: '🚫 المتجر غير نشط أو موقوف.', ephemeral: true });
    }

    const settings = await MarketplaceSettings.findOne().lean();
    const productCount = await Product.countDocuments({ storeId: store._id, isActive: true });

    if (productCount >= (settings?.storeLimits?.maxProducts || config.limits.maxProductsPerStore)) {
      return interaction.reply({
        content: `❌ وصلت للحد الأقصى للمنتجات (${settings?.storeLimits?.maxProducts || config.limits.maxProductsPerStore}).`,
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`product_add_modal_${storeId}`)
      .setTitle('إضافة منتج جديد');

    const nameInput = new TextInputBuilder()
      .setCustomId('product_name')
      .setLabel('اسم المنتج')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: بوت ديسكورد مخصص')
      .setRequired(true)
      .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('product_description')
      .setLabel('وصف المنتج')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('وصف مفصل للمنتج، المميزات، المتطلبات، وما يحصل عليه المشتري...')
      .setRequired(true)
      .setMaxLength(2000);

    const shortDescInput = new TextInputBuilder()
      .setCustomId('product_short_desc')
      .setLabel('الوصف المختصر (للبطاقات)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('وصف قصير يظهر في البطاقات (اختياري)')
      .setRequired(false)
      .setMaxLength(300);

    const priceInput = new TextInputBuilder()
      .setCustomId('product_price')
      .setLabel('السعر')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: 5000')
      .setRequired(true)
      .setMaxLength(20);

    const categoryInput = new TextInputBuilder()
      .setCustomId('product_category')
      .setLabel('الفئة')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: برمجة، تصميم، حسابات، إلخ')
      .setRequired(true)
      .setMaxLength(50);

    const deliveryTypeInput = new TextInputBuilder()
      .setCustomId('product_delivery_type')
      .setLabel('نوع التسليم (instant, manual, digital, physical, service)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('instant')
      .setRequired(false)
      .setMaxLength(20);

    const deliveryContentInput = new TextInputBuilder()
      .setCustomId('product_delivery_content')
      .setLabel('محتوى التسليم الفوري (اختياري)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('محتوى يتم إرساله فور الشراء (للـ instant delivery)')
      .setRequired(false)
      .setMaxLength(5000);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(shortDescInput),
      new ActionRowBuilder().addComponents(priceInput),
      new ActionRowBuilder().addComponents(categoryInput),
      new ActionRowBuilder().addComponents(deliveryTypeInput),
      new ActionRowBuilder().addComponents(deliveryContentInput)
    );

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction, client) {
    if (!interaction.customId.startsWith('product_add_modal_')) return;

    await interaction.deferReply({ ephemeral: true });

    try {
      const storeId = interaction.customId.replace('product_add_modal_', '');
      const store = await Store.findById(storeId.lean());

      if (!store || store.ownerId !== interaction.user.id) {
        return interaction.editReply({ content: '❌ غير مصرح.' });
      }

      const price = parseFloat(interaction.fields.getTextInputValue('product_price'));
      if (!Number.isFinite(price) || price <= 0) {
        return interaction.editReply({ content: '❌ السعر يجب أن يكون أكبر من 0.' });
      }

      const data = {
        name: interaction.fields.getTextInputValue('product_name'),
        description: interaction.fields.getTextInputValue('product_description'),
        shortDescription: interaction.fields.getTextInputValue('product_short_desc') || '',
        price,
        category: interaction.fields.getTextInputValue('product_category'),
        deliveryType: interaction.fields.getTextInputValue('product_delivery_type') || 'manual',
        deliveryContent: interaction.fields.getTextInputValue('product_delivery_content') || '',
      };

      const validDeliveryTypes = ['instant', 'manual', 'digital', 'physical', 'service'];
      if (!validDeliveryTypes.includes(data.deliveryType)) {
        return interaction.editReply({ content: `❌ نوع تسليم غير صالح. الأنواع المقبولة: ${validDeliveryTypes.join(', ')}` });
      }

      const product = new Product({
        storeId: store._id,
        name: data.name,
        description: data.description,
        shortDescription: data.shortDescription,
        price: data.price,
        category: data.category,
        deliveryType: data.deliveryType,
        deliveryContent: data.deliveryContent,
        stock: -1,
        isActive: true,
        metadata: {},
      });

      await product.save();

      if (store.products) store.products.push(product._id);
      else store.products = [product._id];
      await store.save();

      const embed = EmbedBuilderUtil.success(
        '✅ تم إضافة المنتج بنجاح',
        `**${product.name}**\n📦 السعر: ${formatCurrency(data.price)}\n📂 الفئة: ${data.category}\n🆔 معرف المنتج: \`${product._id}\``
      );

      logger.info(`Product added: ${product.name} (${product._id}) in store ${storeId} by user ${interaction.user.id}`);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error(`Error adding product: ${error.message}`, { stack: error.stack });
      await interaction.editReply({ content: `❌ حدث خطأ: ${error.message}`, ephemeral: true });
    }
  },

  async handleEdit(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const productId = interaction.options.getString('product_id');
    const product = await Product.findById(productId).populate('storeId').lean();

    if (!product) {
      return interaction.editReply({ content: '❌ المنتج غير موجود.', ephemeral: true });
    }

    const store = product.storeId;

    if (!store || store.ownerId !== interaction.user.id) {
      return interaction.editReply({ content: '🚫 غير مصرح: يمكنك تعديل منتجات متاجرك فقط.', ephemeral: true });
    }

    const updates = {};
    const name = interaction.options.getString('name');
    const description = interaction.options.getString('description');
    const price = interaction.options.getNumber('price');
    const stock = interaction.options.getNumber('stock');
    const category = interaction.options.getString('category');
    const active = interaction.options.getBoolean('active');

    if (name !== null) updates.name = name;
    if (description !== null) updates.description = description;
    if (price !== null) {
      if (price <= 0) return interaction.editReply({ content: '❌ السعر يجب أن يكون أكبر من 0.', ephemeral: true });
      updates.price = price;
    }
    if (stock !== null) updates.stock = stock;
    if (category !== null) updates.category = category;
    if (active !== null) updates.isActive = active;

    if (Object.keys(updates).length === 0) {
      return interaction.editReply({ content: '⚠️ لم يتم تحديد أي تغييرات.', ephemeral: true });
    }

    updates.updatedAt = new Date();

    await Product.findByIdAndUpdate(productId, { $set: updates });

    const embed = EmbedBuilderUtil.success(
      '✅ تم تعديل المنتج',
      `تم تحديث المنتج **${product.name}**\n🆔 \`${productId}\``
    );

    logger.info(`Product edited: ${productId} by user ${interaction.user.id}`, { updates });
    await interaction.editReply({ embeds: [embed] });
  },

  async handleDelete(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const productId = interaction.options.getString('product_id');
    const product = await Product.findById(productId).populate('storeId').lean();

    if (!product) {
      return interaction.editReply({ content: '❌ المنتج غير موجود.', ephemeral: true });
    }

    const store = product.storeId;

    if (!store || store.ownerId !== interaction.user.id) {
      return interaction.editReply({ content: '🚫 غير مصرح: يمكنك حذف منتجات متاجرك فقط.', ephemeral: true });
    }

    const confirmEmbed = new EmbedBuilder()
      .setColor(0xff4444)
      .setTitle('⚠️ تأكيد حذف المنتج')
      .setDescription(`هل أنت متأكد من حذف **${product.name}**؟\n🆔 \`${productId}\``);

    const confirmBtn = new ButtonBuilder()
      .setCustomId(`product_confirm_delete_${productId}`)
      .setLabel('تأكيد الحذف')
      .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
      .setCustomId('product_cancel_delete')
      .setLabel('إلغاء')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    await interaction.editReply({ embeds: [confirmEmbed], components: [row], ephemeral: true });
  },

  async handleList(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const storeId = interaction.options.getString('store_id');
    const page = interaction.options.getInteger('page') || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const store = await Store.findById(storeId).lean();

    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.', ephemeral: true });
    }

    const total = await Product.countDocuments({ storeId, isActive: true });
    const totalPages = Math.ceil(total / limit);

    if (total === 0) {
      return interaction.editReply({ content: '📭 لا توجد منتجات في هذا المتجر.', ephemeral: true });
    }

    if (page > totalPages) {
      return interaction.editReply({ content: `⚠️ الصفحة غير موجودة. عدد الصفحات: ${totalPages}`, ephemeral: true });
    }

    const products = await Product.find({ storeId, isActive: true }).lean()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const fields = products.map((p, i) => {
      const stockInfo = p.stock === -1 ? '♾️ غير محدود' : `${p.stock} متبقي`;
      return {
        name: `${skip + i + 1}. ${p.name}`,
        value: `💰 ${formatCurrency(p.price)} | 📂 ${p.category} | 📦 ${stockInfo}\n🆔 \`${p._id}\``,
      };
    });

    const embed = PaginationUtil.createPageEmbed(
      `📦 منتجات ${store.name}`,
      `إجمالي المنتجات: ${total}`,
      fields,
      page,
      totalPages
    );

    const components = PaginationUtil.createButtons(`product_list_page_${storeId}`, page, totalPages);

    await interaction.editReply({ embeds: [embed], components, ephemeral: false });
  },

  async handleInfo(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const productId = interaction.options.getString('product_id');
    const product = await Product.findById(productId).populate('storeId').lean();

    if (!product) {
      return interaction.editReply({ content: '❌ المنتج غير موجود.', ephemeral: true });
    }

    const sellerId = product.storeId?.ownerId;
    const embed = new EmbedBuilder()
      .setColor(0x00aaff)
      .setTitle(product.name)
      .setDescription(product.description)
      .addFields(
        { name: '💰 السعر', value: formatCurrency(product.price), inline: true },
        { name: '📂 الفئة', value: product.category || 'بدون', inline: true },
        { name: '📦 المخزون', value: product.stock === -1 ? '♾️ غير محدود' : `${product.stock}`, inline: true },
        { name: '🏪 المتجر', value: product.storeId?.name || 'غير معروف', inline: true },
        { name: '🚚 نوع التسليم', value: product.deliveryType || 'يدوي', inline: true },
        { name: '⭐ التقييم', value: `${(product.rating || 0).toFixed(1)} (${product.reviewCount || 0} تقييم)`, inline: true },
        { name: '🆔 المعرف', value: `\`${productId}\``, inline: false },
        { name: '📅 تاريخ الإضافة', value: product.createdAt ? `<t:${Math.floor(new Date(product.createdAt).getTime() / 1000)}:R>` : 'غير معروف', inline: true }
      )
      .setTimestamp();

    if (product.imageUrl) embed.setImage(product.imageUrl);

    const buyBtn = new ButtonBuilder()
      .setCustomId(`product_buy_${productId}`)
      .setLabel('🛒 شراء')
      .setStyle(ButtonStyle.Success);

    await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(buyBtn)] });
  },

  async handleBuy(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const productId = interaction.options.getString('product_id');
    const quantity = interaction.options.getInteger('quantity') || 1;
    const couponCode = interaction.options.getString('coupon');
    const paymentMethod = interaction.options.getString('payment_method') || 'wallet';
    const idempotencyKey = interaction.options.getString('idempotency_key') || `buy_${interaction.user.id}_${productId}_${Date.now()}`;

    if (quantity < 1) {
      return interaction.editReply({ content: '❌ الكمية يجب أن تكون 1 على الأقل.' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const product = await Product.findById(productId).session(session.lean());

      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({ content: '❌ المنتج غير موجود.' });
      }

      if (!product.isActive) {
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({ content: '❌ المنتج غير متاح للبيع حالياً.' });
      }

      if (product.stock !== -1 && product.stock < quantity) {
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({ content: `❌ الكمية المطلوبة (${quantity}) غير متوفرة. المخزون المتبقي: ${product.stock}.` });
      }

      const store = await Store.findById(product.storeId).session(session.lean());

      if (!store || !store.isActive || store.isSuspended) {
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({ content: '❌ المتجر غير نشط.' });
      }

      const buyer = await User.findOne({ discordId: interaction.user.id }).session(session.lean());

      if (!buyer) {
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({ content: '❌ حساب المستخدم غير موجود. أنشئ حساباً أولاً.' });
      }

      const seller = await User.findOne({ discordId: store.ownerId }).session(session.lean());

      if (!seller) {
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({ content: '❌ حساب البائع غير موجود.' });
      }

      if (buyer.discordId === seller.discordId) {
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({ content: '🚫 لا يمكنك شراء منتج من متجرك الخاص.' });
      }

      let unitPrice = product.price;
      let discountPercent = 0;
      let discountAmount = 0;
      let couponUsed = null;

      if (couponCode) {
        const coupon = await Coupon.findOne({
          code: couponCode.toUpperCase(),
          storeId: product.storeId,
          isActive: true,
          $or: [
            { 'usageLimit.total': 0 },
            { $expr: { $lt: ['$usageCount.total', '$usageLimit.total'] } },
          ],
          $and: [
            { startsAt: { $lte: new Date() } },
            { endsAt: { $gte: new Date() } },
          ],
        }).session(session.lean());

        if (!coupon) {
          await session.abortTransaction();
          session.endSession();
          return interaction.editReply({ content: '❌ كود الخصم غير صالح أو منتهي الصلاحية.' });
        }

        couponUsed = coupon._id;

        if (coupon.type === 'percentage') {
          discountPercent = Math.min(coupon.value, 100);
          unitPrice = product.price * (1 - discountPercent / 100);
        } else {
          discountAmount = Math.min(coupon.value, product.price);
          unitPrice = product.price - discountAmount;
        }

        await Coupon.findByIdAndUpdate(coupon._id, {
          $inc: { 'usageCount.total': 1 }
        }, { session });
      }

      const totalPrice = unitPrice * quantity;

      const settings = await MarketplaceSettings.findOne().session(session.lean());
      const commissionRate = store.commissionRate || config.commissions?.free || 0.05;
      const commission = calculateCommission(totalPrice, commissionRate);
      const sellerAmount = totalPrice - commission;
      const taxRate = 0;
      const taxAmount = 0;

      if (paymentMethod === 'wallet') {
        if (buyer.balance < totalPrice) {
          await session.abortTransaction();
          session.endSession();
          return interaction.editReply({
            content: `❌ رصيدك غير كافٍ. المطلوب: ${formatCurrency(totalPrice)}، الرصيد: ${formatCurrency(buyer.balance)}.`,
          });
        }
        buyer.balance -= totalPrice;
        seller.balance += sellerAmount;
        await buyer.save({ session });
        await seller.save({ session });
      }

      const orderStatus = paymentMethod === 'probot' ? 'pending' : 'completed';

      const orderNumber = generateOrderNumber();
      const taxAccountId = settings?.taxAccountId || null;

      const order = new Order({
        orderNumber,
        type: 'product',
        buyerId: interaction.user.id,
        sellerId: store.ownerId,
        storeId: store._id,
        itemId: product._id,
        itemName: product.name,
        quantity,
        unitPrice: product.price,
        subtotal: totalPrice,
        discount: {
          amount: discountAmount,
          percentage: discountPercent,
          code: couponCode || undefined,
        },
        tax: { rate: taxRate, amount: taxAmount },
        platformFee: { rate: commissionRate, amount: commission },
        total: totalPrice,
        status: orderStatus,
        paymentMethod,
        delivery: {
          type: product.deliveryType,
          content: product.deliveryContent || null,
        },
        metadata: {},
      });

      await order.save({ session });

      if (paymentMethod === 'probot') {
        const payment = await PaymentService.createPayment({
          buyerId: interaction.user.id,
          storeId: store._id,
          orderId: order._id,
          itemType: 'product',
          itemId: product._id,
          itemName: `${quantity}x ${product.name}`,
          amount: totalPrice,
          idempotencyKey: idempotencyKey,
        });
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({
          content: `✅ تم إنشاء طلب الدفع!\n\n` +
            `📋 **رقم الطلب:** #${orderNumber}\n` +
            `💰 **المبلغ:** ${formatCurrency(totalPrice)}\n` +
            `🆔 **معرف الدفعة:** \`${payment.paymentId}\`\n` +
            `🔑 **كود المرجع:** \`${payment.referenceCode}\`\n\n` +
            `📤 قم بتحويل **${formatCurrency(totalPrice)}** كريدت إلى حساب المنصة بواسطة ProBot.\n` +
            `🔄 بعد التحويل، استخدم:\n\`/admin → Payments\` للتحقق من الدفعة.\nمعرف الدفعة: \`${payment.paymentId}\`\n\n` +
            `⏳ المهلة: 30 دقيقة`,
        });
      }

      const buyerUpdate = await User.findOneAndUpdate(
        { discordId: interaction.user.id, balance: { $gte: totalPrice } },
        { $inc: { balance: -totalPrice, totalSpent: totalPrice, 'stats.totalPurchases': 1 } },
        { new: true, session }
      );
      if (!buyerUpdate) {
        await session.abortTransaction();
        session.endSession();
        return interaction.editReply({ content: '❌ رصيد غير كافٍ أو حدث خطأ في التحديث.' });
      }

      if (product.stock !== -1) {
        const productUpdate = await Product.findOneAndUpdate(
          { _id: product._id, stock: { $gte: quantity } },
          { $inc: { stock: -quantity, soldCount: quantity } },
          { new: true, session }
        );
        if (!productUpdate) {
          await session.abortTransaction();
          session.endSession();
          return interaction.editReply({ content: '❌ المخزون غير كافٍ أو تم بيع المنتج.' });
        }
      } else {
        await Product.findByIdAndUpdate(product._id, { $inc: { soldCount: quantity } }, { session });
      }

      const transaction = new Transaction({
        userId: interaction.user.id,
        type: 'purchase',
        amount: -totalPrice,
        status: 'completed',
        currency: 'credits',
        balanceBefore: buyer.balance + totalPrice,
        balanceAfter: buyerUpdate.balance,
        description: `شراء ${quantity}x ${product.name} من ${store.name}`,
        reference: { orderId: order._id, storeId: store._id, productId: product._id },
        metadata: { fee: commission, netAmount: sellerAmount, idempotencyKey },
      });

      await transaction.save({ session });

      const sellerTransaction = new Transaction({
        userId: store.ownerId,
        type: 'sale',
        amount: sellerAmount,
        status: 'completed',
        currency: 'credits',
        balanceBefore: seller.balance - sellerAmount,
        balanceAfter: seller.balance + sellerAmount,
        description: `بيع ${quantity}x ${product.name} في ${store.name}`,
        reference: { orderId: order._id, storeId: store._id, productId: product._id },
        metadata: { fee: commission, netAmount: sellerAmount, idempotencyKey },
      });

      await sellerTransaction.save({ session });

      if (taxAccountId && commission > 0) {
        const taxTransaction = new Transaction({
          userId: taxAccountId,
          type: 'fee',
          amount: commission,
          status: 'completed',
          currency: 'credits',
          balanceBefore: 0,
          balanceAfter: commission,
          description: `ضريبة على ${product.name} من ${store.name}`,
          reference: { orderId: order._id, storeId: store._id },
          metadata: { fee: 0, netAmount: commission },
        });

        await taxTransaction.save({ session });
      }

      await Store.findByIdAndUpdate(store._id, {
        $inc: {
          'stats.totalSales': totalPrice,
          'stats.revenue': sellerAmount,
          salesCount: quantity
        }
      }, { session });

      await session.commitTransaction();
      session.endSession();

      auditService.log('product_purchase', interaction.user.id, {
        targetId: product._id.toString(),
        targetType: 'product',
        details: { orderId: order._id.toString(), quantity, totalPrice, storeName: store.name },
        guildId: interaction.guildId,
        metadata: { commandName: 'product buy' },
      });

      webhookService.sendNewOrder(order, interaction.user.id, store.ownerId, store).catch(() => {});

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ تم الشراء بنجاح')
        .setDescription(`تم شراء **${quantity}x ${product.name}** من **${store.name}**`)
        .addFields(
          { name: '📋 رقم الطلب', value: `\`${orderNumber}\``, inline: true },
          { name: '💰 المجموع', value: formatCurrency(totalPrice), inline: true },
          { name: '📦 الحالة', value: 'مكتمل', inline: true }
        );

      if (discountPercent > 0 || discountAmount > 0) {
        embed.addFields({ name: '🎉 الخصم', value: discountPercent > 0 ? `${discountPercent}%` : formatCurrency(discountAmount), inline: true });
      }

      embed.addFields(
        { name: '🏪 البائع', value: `<@${store.ownerId}>`, inline: true },
        { name: '🆔 المنتج', value: `\`${productId}\``, inline: true }
      );

      if (product.deliveryType === 'instant' && product.deliveryContent) {
        embed.addFields({ name: '📥 محتوى التسليم', value: `\`\`\`\n${product.deliveryContent.substring(0, 1000)}\n\`\`\`` });
      }

      await interaction.editReply({ embeds: [embed] });

      try {
        const buyerDM = await interaction.user.createDM();
        const receiptEmbed = new EmbedBuilder()
          .setColor(0x00aaff)
          .setTitle('🧾 إيصال الشراء')
          .setDescription(`شكراً لشرائك من **${store.name}**!`)
          .addFields(
            { name: '📋 رقم الطلب', value: `\`${orderNumber}\``, inline: true },
            { name: '📦 المنتج', value: product.name, inline: true },
            { name: '🔢 الكمية', value: `${quantity}`, inline: true },
            { name: '💰 المجموع', value: formatCurrency(totalPrice), inline: true },
            { name: '📅 التاريخ', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
          );

        if (product.deliveryType === 'instant' && product.deliveryContent) {
          receiptEmbed.addFields({ name: '📥 محتوى التسليم', value: `\`\`\`\n${product.deliveryContent}\n\`\`\`` });
        }

        await buyerDM.send({ embeds: [receiptEmbed] });
      } catch (dmError) {
        logger.warn(`Could not send DM to buyer ${interaction.user.id}: ${dmError.message}`);
      }

      try {
        const sellerDM = await client.users.createDM(store.ownerId);
        const sellerNotification = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('🛒 تم بيع منتج!')
          .setDescription(`تم شراء **${quantity}x ${product.name}**`)
          .addFields(
            { name: '👤 المشتري', value: `<@${interaction.user.id}>`, inline: true },
            { name: '💰 المبلغ', value: formatCurrency(sellerAmount), inline: true },
            { name: '📋 رقم الطلب', value: `\`${orderNumber}\``, inline: true }
          );

        await sellerDM.send({ embeds: [sellerNotification] });
      } catch (dmError) {
        logger.warn(`Could not send DM to seller ${store.ownerId}: ${dmError.message}`);
      }

      logger.info(`Purchase completed: ${quantity}x ${product.name} from ${store.name} (${product._id}) by ${interaction.user.id} | Order: ${orderNumber} | Total: ${totalPrice}`);
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error processing purchase: ${error.message}`, { stack: error.stack, productId, userId: interaction.user.id });
      await interaction.editReply({ content: `❌ حدث خطأ أثناء معالجة الشراء: ${error.message}` });
    } finally {
      session.endSession();
    }
  },

  async handleAIGenerate(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const name = interaction.options.getString('name');
    const category = interaction.options.getString('category');
    const price = interaction.options.getNumber('price');
    const features = interaction.options.getString('features');

    const store = await Store.findById(storeId).lean();

    if (!store) {
      return interaction.editReply({ content: '❌ المتجر غير موجود.' });
    }

    if (store.ownerId !== interaction.user.id) {
      return interaction.editReply({ content: '🚫 غير مصرح: يمكنك استخدام هذه الميزة لمتاجرك فقط.' });
    }

    try {
      const prompt = `قم بإنشاء وصف منتج باللغة العربية لمنتج في متجر "{storeName}".
اسم المنتج: ${name}
الفئة: ${category}
السعر: ${price ? `${formatCurrency(price)}` : 'غير محدد'}
المميزات: ${features || 'غير محددة'}

المطلوب:
1. وصف طويل احترافي (عربي) - فقرة غنية بالتفاصيل
2. وصف قصير (سطر واحد)
3. فئة فرعية مقترحة
4. نقاط القوة (3-5 نقاط)

أعد النتيجة بصيغة JSON:
{
  "description": "الوصف الطويل هنا",
  "shortDescription": "الوصف القصير هنا",
  "subcategory": "الفئة الفرعية المقترحة",
  "highlights": ["نقطة قوة 1", "نقطة قوة 2", "نقطة قوة 3"]
}`;

      const aiResponse = await AIService.generateText(prompt, {
        model: config.groq.model,
        maxTokens: 1000,
        temperature: 0.7,
      });

      let generated;
      try {
        generated = JSON.parse(aiResponse);
      } catch {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          generated = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('تعذر تحليل استجابة AI');
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`🤖 وصف مقترح لـ ${name}`)
        .setDescription(generated.description)
        .addFields(
          { name: '📝 وصف قصير', value: generated.shortDescription || 'غير متوفر', inline: false },
          { name: '📂 الفئة الفرعية', value: generated.subcategory || category, inline: true },
          { name: '⭐ نقاط القوة', value: generated.highlights?.map(h => `• ${h}`).join('\n') || 'غير محددة', inline: false }
        )
        .setFooter({ text: `تم الإنشاء بواسطة Groq AI (${config.groq.model})` });

      const useBtn = new ButtonBuilder()
        .setCustomId(`ai_use_desc_${storeId}_${Buffer.from(name).toString('base64').slice(0, 20)}`)
        .setLabel('📥 استخدام هذا الوصف')
        .setStyle(ButtonStyle.Primary);

      const regenerateBtn = new ButtonBuilder()
        .setCustomId(`ai_regenerate_${storeId}_${Buffer.from(name).toString('base64').slice(0, 20)}_${category}_${price || 0}_${features || ''}`)
        .setLabel('🔄 إعادة إنشاء')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(useBtn, regenerateBtn);

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      logger.error(`AI generation error: ${error.message}`);
      await interaction.editReply({ content: `❌ فشل إنشاء الوصف: ${error.message}` });
    }
  },

  async handleButton(interaction, client, action) {
    const customId = interaction.customId;

    if (customId.startsWith('product_confirm_delete_')) {
      await interaction.deferUpdate();
      const productId = customId.replace('product_confirm_delete_', '');
      const product = await Product.findById(productId).lean();

      if (!product) {
        return interaction.editReply({ content: '❌ المنتج غير موجود.', embeds: [], components: [] });
      }

      const store = await Store.findById(product.storeId.lean());

      if (!store || store.ownerId !== interaction.user.id) {
        return interaction.editReply({ content: '🚫 غير مصرح.', embeds: [], components: [] });
      }

      if (store.products) {
        store.products = store.products.filter(p => p.toString() !== productId);
        await store.save();
      }

      await Product.findByIdAndDelete(productId);

      logger.info(`Product deleted: ${product.name} (${productId}) by user ${interaction.user.id}`);
      return interaction.editReply({ content: `✅ تم حذف **${product.name}** بنجاح.`, embeds: [], components: [] });
    }

    if (customId === 'product_cancel_delete') {
      return interaction.update({ content: '✅ تم إلغاء الحذف.', embeds: [], components: [] });
    }

    if (customId.startsWith('product_buy_')) {
      const productId = customId.replace('product_buy_', '');
      interaction.options._hoistedOptions = [
        { name: 'product_id', value: productId },
        { name: 'quantity', value: 1 },
      ];
      await this.handleBuy(interaction, client);
    }

    if (customId.startsWith('product_list_page_')) {
      await interaction.deferUpdate();
      const { prefix, page } = PaginationUtil.parseCustomId(customId);
      const storeId = prefix.replace('product_list_page_', '');

      const store = await Store.findById(storeId).lean();
      if (!store) {
        return interaction.editReply({ content: '❌ المتجر غير موجود.', components: [] });
      }

      const limit = 10;
      const skip = (page - 1) * limit;
      const total = await Product.countDocuments({ storeId, isActive: true });
      const totalPages = Math.ceil(total / limit);

      if (page > totalPages) {
        return interaction.editReply({ content: `⚠️ الصفحة غير موجودة. عدد الصفحات: ${totalPages}`, components: [] });
      }

      const products = await Product.find({ storeId, isActive: true }).lean()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const fields = products.map((p, i) => {
        const stockInfo = p.stock === -1 ? '♾️ غير محدود' : `${p.stock} متبقي`;
        return {
          name: `${skip + i + 1}. ${p.name}`,
          value: `💰 ${formatCurrency(p.price)} | 📂 ${p.category} | 📦 ${stockInfo}\n🆔 \`${p._id}\``,
        };
      });

      const embed = PaginationUtil.createPageEmbed(
        `📦 منتجات ${store.name}`,
        `إجمالي المنتجات: ${total}`,
        fields,
        page,
        totalPages
      );

      const components = PaginationUtil.createButtons(`product_list_page_${storeId}`, page, totalPages);

      await interaction.editReply({ embeds: [embed], components });
    }

    await interaction.deferUpdate().catch(() => {});
    return interaction.editReply({ content: '❌ إجراء غير معروف.', flags: MessageFlags.Ephemeral });
  },
};