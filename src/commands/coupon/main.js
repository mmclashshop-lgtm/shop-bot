const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { Coupon, Store } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { formatCurrency, generateCouponCode } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const fraudDetection = require('../../services/FraudDetectionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coupon')
    .setDescription('إدارة الكوبونات والخصومات')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('إنشاء كوبون جديد')
        .addStringOption(opt => opt.setName('name').setDescription('اسم الكوبون').setRequired(true).setMaxLength(100))
        .addStringOption(opt => opt.setName('type').setDescription('النوع').setRequired(true).addChoices(
          { name: 'نسبة مئوية', value: 'percentage' },
          { name: 'مبلغ ثابت', value: 'fixed' },
          { name: 'شحن مجاني', value: 'free_shipping' }
        ))
        .addNumberOption(opt => opt.setName('value').setDescription('القيمة').setRequired(true).setMinValue(0))
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر (للإدارة فقط)'))
        .addStringOption(opt => opt.setName('code').setDescription('كود الكوبون (اختياري - يتم إنشاؤه تلقائياً)').setMaxLength(20))
        .addNumberOption(opt => opt.setName('max_discount').setDescription('الحد الأقصى للخصم').setMinValue(0))
        .addNumberOption(opt => opt.setName('min_purchase').setDescription('الحد الأدنى للشراء').setMinValue(0))
        .addStringOption(opt => opt.setName('applicable_to').setDescription('ينطبق على').addChoices(
          { name: 'الكل', value: 'all' },
          { name: 'منتجات', value: 'products' },
          { name: 'خدمات', value: 'services' },
          { name: 'متجر محدد', value: 'store' },
          { name: 'فئة محددة', value: 'category' }
        ))
        .addIntegerOption(opt => opt.setName('usage_limit_total').setDescription('إجمالي الاستخدامات (0 = لا نهائي)').setMinValue(0))
        .addIntegerOption(opt => opt.setName('usage_limit_user').setDescription('لكل مستخدم').setMinValue(1))
        .addStringOption(opt => opt.setName('ends_at').setDescription('تاريخ الانتهاء (ISO)'))
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('تعديل كوبون')
        .addStringOption(opt => opt.setName('code').setDescription('كود الكوبون').setRequired(true))
        .addStringOption(opt => opt.setName('name').setDescription('الاسم'))
        .addNumberOption(opt => opt.setName('value').setDescription('القيمة').setMinValue(0))
        .addBooleanOption(opt => opt.setName('active').setDescription('حالة التفعيل'))
        .addStringOption(opt => opt.setName('ends_at').setDescription('تاريخ الانتهاء (ISO)'))
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('حذف كوبون')
        .addStringOption(opt => opt.setName('code').setDescription('كود الكوبون').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('قائمة الكوبونات')
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر'))
        .addBooleanOption(opt => opt.setName('active_only').setDescription('نشطة فقط'))
        .addIntegerOption(opt => opt.setName('page').setDescription('الصفحة').setMinValue(1))
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('معلومات كوبون')
        .addStringOption(opt => opt.setName('code').setDescription('كود الكوبون').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('validate')
        .setDescription('التحقق من صحة كوبون')
        .addStringOption(opt => opt.setName('code').setDescription('كود الكوبون').setRequired(true))
        .addNumberOption(opt => opt.setName('amount').setDescription('مبلغ الشراء').setRequired(true).setMinValue(0))
        .addStringOption(opt => opt.setName('store_id').setDescription('معرف المتجر'))
    ),

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    if (['create', 'edit', 'delete'].includes(subcommand)) {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        const userStores = await Store.find({ ownerId: interaction.user.id }).select('_id').lean();
        const userStoreIds = userStores.map(s => s._id.toString());
        
        if (subcommand === 'create') {
          const storeId = interaction.options.getString('store_id');
          if (!storeId || !userStoreIds.includes(storeId)) {
            return interaction.reply({ content: '🚫 غير مصرح: يمكنك إنشاء كوبونات لمتاجرك فقط.', ephemeral: true });
          }
        }
      }
    }

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
      case 'info':
        await this.handleInfo(interaction, client);
        break;
      case 'validate':
        await this.handleValidate(interaction, client);
        break;
    }
  },

  async handleCreate(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    let code = interaction.options.getString('code');
    const name = interaction.options.getString('name');
    const type = interaction.options.getString('type');
    const value = interaction.options.getNumber('value');
    const maxDiscount = interaction.options.getNumber('max_discount');
    const minPurchase = interaction.options.getNumber('min_purchase') || 0;
    const applicableTo = interaction.options.getString('applicable_to') || 'all';
    const usageLimitTotal = interaction.options.getInteger('usage_limit_total') || 0;
    const usageLimitUser = interaction.options.getInteger('usage_limit_user') || 1;
    const endsAt = interaction.options.getString('ends_at');

    if (!code) {
      code = generateCouponCode();
      while (await Coupon.findOne({ code })) {
        code = generateCouponCode();
      }
    } else {
      code = code.toUpperCase();
      if (await Coupon.findOne({ code })) {
        return interaction.editReply({ content: '❌ هذا الكود مستخدم بالفعل.' });
      }
    }

    const validTypes = ['percentage', 'fixed', 'free_shipping'];
    if (!validTypes.includes(type)) {
      return interaction.editReply({ content: '❌ نوع غير صالح.' });
    }

    if (type === 'percentage' && (value < 1 || value > 100)) {
      return interaction.editReply({ content: '❌ النسبة يجب أن تكون بين 1 و 100.' });
    }

    const coupon = await Coupon.create({
      code,
      name,
      type,
      value,
      maxDiscount,
      minPurchase,
      applicableTo,
      storeId: storeId || null,
      createdBy: interaction.user.id,
      usageLimit: { total: usageLimitTotal, perUser: usageLimitUser },
      endsAt: endsAt ? new Date(endsAt) : null,
      isPublic: !storeId,
    });

    logger.info('Coupon created', { code, type, value, by: interaction.user.id });

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.coupon} تم إنشاء الكوبون`)
      .setColor(config.colors.success)
      .addFields(
        { name: '🔑 الكود', value: `\`${code}\``, inline: true },
        { name: '📝 الاسم', value: name, inline: true },
        { name: '📊 النوع', value: this.getTypeName(type), inline: true },
        { name: '💰 القيمة', value: type === 'percentage' ? `${value}%` : formatCurrency(value), inline: true },
        { name: '🔝 الحد الأقصى', value: maxDiscount ? formatCurrency(maxDiscount) : 'لا يوجد', inline: true },
        { name: '🔻 الحد الأدنى', value: minPurchase > 0 ? formatCurrency(minPurchase) : 'لا يوجد', inline: true },
        { name: '📦 ينطبق على', value: this.getApplicableName(applicableTo), inline: true },
        { name: '🔢 حد الاستخدام', value: usageLimitTotal > 0 ? `${usageLimitTotal} (${usageLimitUser} لكل مستخدم)` : 'لا نهائي', inline: true },
        { name: '📅 ينتهي', value: endsAt ? `<t:${Math.floor(new Date(endsAt) / 1000)}:F>` : 'لا ينتهي', inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleEdit(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const code = interaction.options.getString('code').toUpperCase();
    const coupon = await Coupon.findOne({ code }).lean();

    if (!coupon) {
      return interaction.editReply({ content: '❌ الكوبون غير موجود.' });
    }

    const userStores = await Store.find({ ownerId: interaction.user.id }).select('_id').lean();
    const userStoreIds = userStores.map(s => s._id.toString());
    const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

    if (!isAdmin && coupon.storeId && !userStoreIds.includes(coupon.storeId.toString())) {
      return interaction.editReply({ content: '🚫 غير مصرح: هذا الكوبون لمتجر آخر.' });
    }

    if (interaction.options.getString('name')) coupon.name = interaction.options.getString('name');
    if (interaction.options.getNumber('value') !== null) coupon.value = interaction.options.getNumber('value');
    if (interaction.options.getBoolean('active') !== null) coupon.isActive = interaction.options.getBoolean('active');
    if (interaction.options.getString('ends_at')) coupon.endsAt = new Date(interaction.options.getString('ends_at'));

    await coupon.save();

    return interaction.editReply({ content: '✅ تم تحديث الكوبون بنجاح.' });
  },

  async handleDelete(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const code = interaction.options.getString('code').toUpperCase();
    const coupon = await Coupon.findOne({ code }).lean();

    if (!coupon) {
      return interaction.editReply({ content: '❌ الكوبون غير موجود.' });
    }

    const userStores = await Store.find({ ownerId: interaction.user.id }).select('_id').lean();
    const userStoreIds = userStores.map(s => s._id.toString());
    const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

    if (!isAdmin && coupon.storeId && !userStoreIds.includes(coupon.storeId.toString())) {
      return interaction.editReply({ content: '🚫 غير مصرح.' });
    }

    await Coupon.findOneAndDelete({ code });

    return interaction.editReply({ content: '✅ تم حذف الكوبون بنجاح.' });
  },

  async handleList(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const storeId = interaction.options.getString('store_id');
    const activeOnly = interaction.options.getBoolean('active_only') !== false;
    const page = interaction.options.getInteger('page') || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const query = {};
    if (storeId) query.storeId = storeId;
    if (activeOnly) {
      query.isActive = true;
      query.$or = [{ endsAt: null }, { endsAt: { $gte: new Date() } }];
    }

    const userStores = await Store.find({ ownerId: interaction.user.id }).select('_id').lean();
    const userStoreIds = userStores.map(s => s._id.toString());
    const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

    if (!isAdmin) {
      query.$or = [
        { storeId: { $in: userStoreIds } },
        { storeId: null, isPublic: true },
      ];
    }

    const [coupons, total] = await Promise.all([
      Coupon.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Coupon.countDocuments(query),
    ]);

    if (coupons.length === 0) {
      return interaction.editReply({ content: '📭 لا توجد كوبونات.' });
    }

    const totalPages = Math.ceil(total / limit);

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.coupon} الكوبونات (صفحة ${page}/${totalPages})`)
      .setColor(config.colors.primary)
      .setDescription(coupons.map((c, i) => {
        const status = c.isValid ? '✅' : '❌';
        const storeInfo = c.storeId ? ` (متجر: ${c.storeId})` : ' (عام)';
        return `${skip + i + 1}. ${status} **${c.code}** - ${c.name} - ${c.type === 'percentage' ? `${c.value}%` : formatCurrency(c.value)}${storeInfo} - ${c.usageCount.total}/${c.usageLimit.total || '∞'}`;
      }).join('\n'))
      .setFooter({ text: `إجمالي: ${total}` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleInfo(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const code = interaction.options.getString('code').toUpperCase();
    const coupon = await Coupon.findOne({ code }).populate('storeId', 'name').lean();

    if (!coupon) {
      return interaction.editReply({ content: '❌ الكوبون غير موجود.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.coupon} ${coupon.name} (\`${coupon.code}\`)`)
      .setColor(coupon.isValid ? config.colors.success : config.colors.error)
      .addFields(
        { name: '📊 النوع', value: this.getTypeName(coupon.type), inline: true },
        { name: '💰 القيمة', value: coupon.type === 'percentage' ? `${coupon.value}%` : formatCurrency(coupon.value), inline: true },
        { name: '🔝 الحد الأقصى', value: coupon.maxDiscount ? formatCurrency(coupon.maxDiscount) : 'لا يوجد', inline: true },
        { name: '🔻 الحد الأدنى', value: coupon.minPurchase > 0 ? formatCurrency(coupon.minPurchase) : 'لا يوجد', inline: true },
        { name: '📦 ينطبق على', value: this.getApplicableName(coupon.applicableTo), inline: true },
        { name: '🏪 المتجر', value: coupon.storeId ? coupon.storeId.name : 'عام', inline: true },
        { name: '🔢 الاستخدام', value: `${coupon.usageCount.total} / ${coupon.usageLimit.total || '∞'}`, inline: true },
        { name: '👤 لكل مستخدم', value: coupon.usageLimit.perUser.toString(), inline: true },
        { name: '✅ الحالة', value: coupon.isValid ? 'صالح' : 'منتهي/معطل', inline: true },
        { name: '📅 البداية', value: `<t:${Math.floor(coupon.startsAt / 1000)}:F>`, inline: true },
        { name: '📅 النهاية', value: coupon.endsAt ? `<t:${Math.floor(coupon.endsAt / 1000)}:F>` : 'لا ينتهي', inline: true },
        { name: '🌐 عام', value: coupon.isPublic ? 'نعم' : 'لا', inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleValidate(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const code = interaction.options.getString('code').toUpperCase();
    const amount = interaction.options.getNumber('amount');
    const storeId = interaction.options.getString('store_id');

    const coupon = await Coupon.findOne({ code }).lean();

    if (!coupon) {
      return interaction.editReply({ content: '❌ كوبون غير موجود.' });
    }

    if (!coupon.isValid) {
      return interaction.editReply({ content: '❌ الكوبون غير صالح (منتهي أو معطل أو وصل للحد الأقصى).' });
    }

    const fraudCheck = await fraudDetection.checkCouponClaim(interaction.user.id, code, interaction.guildId);
    if (fraudCheck.isFraud) {
      return interaction.editReply({ content: '🚫 تم حظر استخدام الكوبون لأسباب أمنية.' });
    }

    if (amount < coupon.minPurchase) {
      return interaction.editReply({ content: `❌ المبلغ أقل من الحد الأدنى (${formatCurrency(coupon.minPurchase)}).` });
    }

    if (coupon.storeId && coupon.storeId.toString() !== storeId) {
      return interaction.editReply({ content: '❌ هذا الكوبون لمتجر آخر.' });
    }

    if (coupon.applicableTo !== 'all' && coupon.applicableTo !== 'store') {
      return interaction.editReply({ content: '❌ هذا الكوبون لا ينطبق على هذا النوع من المشتريات.' });
    }

    let discountAmount = 0;
    if (coupon.type === 'percentage') {
      discountAmount = amount * (coupon.value / 100);
      if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
        discountAmount = coupon.maxDiscount;
      }
    } else if (coupon.type === 'fixed') {
      discountAmount = Math.min(coupon.value, amount);
    }

    const finalAmount = amount - discountAmount;

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.success} الكوبون صالح!`)
      .setColor(config.colors.success)
      .addFields(
        { name: '🔑 الكود', value: `\`${coupon.code}\``, inline: true },
        { name: '📝 الاسم', value: coupon.name, inline: true },
        { name: '💰 المبلغ الأصلي', value: formatCurrency(amount), inline: true },
        { name: '💸 الخصم', value: formatCurrency(discountAmount), inline: true },
        { name: '✅ المبلغ النهائي', value: formatCurrency(finalAmount), inline: true },
        { name: '🔢 الاستخدامات المتبقية', value: coupon.usageLimit.total > 0 ? `${coupon.usageLimit.total - coupon.usageCount.total}` : 'لا نهائي', inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  getTypeName(type) {
    const names = {
      percentage: 'نسبة مئوية',
      fixed: 'مبلغ ثابت',
      free_shipping: 'شحن مجاني',
    };
    return names[type] || type;
  },

  getApplicableName(type) {
    const names = {
      all: 'الكل',
      products: 'منتجات',
      services: 'خدمات',
      store: 'متجر محدد',
      category: 'فئة محددة',
    };
    return names[type] || type;
  },
};
