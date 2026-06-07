const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { Payment, Store, User, MarketplaceSettings } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { formatCurrency, formatNumber } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const PaymentService = require('../../services/PaymentService');
const CommissionService = require('../../services/CommissionService');
const fraudDetection = require('../../services/FraudDetectionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('payment')
    .setDescription('نظام الدفع والمراجعة')
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('عرض حالة دفعة')
        .addStringOption(opt => opt.setName('payment_id').setDescription('معرف الدفعة').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('verify')
        .setDescription('التحقق من دفعة')
        .addStringOption(opt => opt.setName('payment_id').setDescription('معرف الدفعة').setRequired(true))
        .addStringOption(opt => opt.setName('transaction_id').setDescription('معرف المعاملة في ProBot').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('cancel')
        .setDescription('إلغاء دفعة')
        .addStringOption(opt => opt.setName('payment_id').setDescription('معرف الدفعة').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('history')
        .setDescription('سجل دفعاتي')
    )
    .addSubcommand(sub =>
      sub.setName('pending')
        .setDescription('طلبات الدفع المعلقة (للمشرفين)')
    )
    .addSubcommand(sub =>
      sub.setName('confirm')
        .setDescription('تأكيد دفعة (للمشرفين)')
        .addStringOption(opt => opt.setName('payment_id').setDescription('معرف الدفعة').setRequired(true))
    ),
  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case 'status':
        await this.handleStatus(interaction, client);
        break;
      case 'verify':
        await this.handleVerify(interaction, client);
        break;
      case 'cancel':
        await this.handleCancel(interaction, client);
        break;
      case 'history':
        await this.handleHistory(interaction, client);
        break;
      case 'pending':
        await this.handlePending(interaction, client);
        break;
      case 'confirm':
        await this.handleConfirm(interaction, client);
        break;
    }
  },
  async handleStatus(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const paymentId = interaction.options.getString('payment_id');
    const payment = await PaymentService.getPayment(paymentId);
    if (!payment) return interaction.editReply({ content: '❌ الدفعة غير موجودة.' });
    if (payment.buyerId !== interaction.user.id && !interaction.memberPermissions.has('Administrator')) {
      return interaction.editReply({ content: '🚫 غير مصرح.' });
    }
    const embed = this.buildPaymentEmbed(payment, client);
    return interaction.editReply({ embeds: [embed] });
  },
  async handleVerify(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const paymentId = interaction.options.getString('payment_id');
    const transactionId = interaction.options.getString('transaction_id');
    try {
      const fraudCheck = await fraudDetection.checkPayment(interaction.user.id, paymentId, transactionId, interaction.guildId);
      if (fraudCheck.isFraud) {
        await fraudDetection.sendAdminAlert(interaction, fraudCheck.alert, client);
        return interaction.editReply({ content: '🚫 تم رفض التحقق من الدفعة لأسباب أمنية.' });
      }
      if (fraudCheck.alert) {
        await fraudDetection.sendAdminAlert(interaction, fraudCheck.alert, client);
      }

      const payment = await PaymentService.verifyPayment(paymentId, transactionId, interaction.user.id);
      const embed = EmbedBuilderUtil.success(
        'تم استلام معرف المعاملة',
        `✅ تم استلام معرف المعاملة **${transactionId}** للدفعة **${paymentId}**.\n📊 الحالة: **قيد المراجعة**\n⏳ في انتظار تأكيد الإدارة.`
      );
      const settings = await MarketplaceSettings.findOne().lean();
      if (settings?.logChannelId) {
        const logChannel = client.channels.cache.get(settings.logChannelId);
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle('💰 دفعة بانتظار التأكيد')
            .setColor(config.colors.warning)
            .addFields(
              { name: 'معرف الدفعة', value: paymentId, inline: true },
              { name: 'المشتري', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'المبلغ', value: formatCurrency(payment.amount), inline: true },
              { name: 'معرف المعاملة', value: transactionId, inline: true },
              { name: 'البائع', value: `<@${payment.sellerId}>`, inline: true },
            )
            .setTimestamp();
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`payment_confirm_${paymentId}`)
              .setLabel('تأكيد الدفعة')
              .setEmoji('✅')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`payment_reject_${paymentId}`)
              .setLabel('رفض')
              .setEmoji('❌')
              .setStyle(ButtonStyle.Danger),
          );
          await logChannel.send({ embeds: [logEmbed], components: [row] });
        }
      }
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply({ content: `❌ ${error.message}` });
    }
  },
  async handleCancel(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const paymentId = interaction.options.getString('payment_id');
    try {
      await PaymentService.cancelPayment(paymentId, interaction.user.id, 'ألغاه المستخدم');
      return interaction.editReply({ content: `✅ تم إلغاء الدفعة **${paymentId}**.` });
    } catch (error) {
      return interaction.editReply({ content: `❌ ${error.message}` });
    }
  },
  async handleHistory(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const payments = await PaymentService.getUserPayments(interaction.user.id);
    if (payments.length === 0) return interaction.editReply({ content: '📭 لا توجد دفعات.' });
    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.money} سجل الدفعات`)
      .setColor(config.colors.primary)
      .setDescription(payments.map((p, i) =>
        `${i + 1}. **${p.itemName}** - ${formatCurrency(p.amount)}\n` +
        `⏳ الحالة: ${this.getStatusText(p.status)} | 🆔 ${p.paymentId}\n` +
        `📅 ${p.createdAt ? `<t:${Math.floor(p.createdAt / 1000)}:R>` : 'N/A'}`
      ).join('\n\n'))
      .setFooter({ text: `إجمالي: ${payments.length} دفعة` })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  },
  async handlePending(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.editReply({ content: '🚫 هذا الأمر للمشرفين فقط.' });
    }
    const pending = await PaymentService.getPendingVerification();
    if (pending.length === 0) return interaction.editReply({ content: '✅ لا توجد دفعات بانتظار التأكيد.' });
    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.money} دفعات بانتظار التأكيد (${pending.length})`)
      .setColor(config.colors.warning)
      .setDescription(pending.slice(0, 10).map((p, i) =>
        `${i + 1}. **${p.itemName}** - ${formatCurrency(p.amount)}\n` +
        `👤 المشتري: <@${p.buyerId}> | 🆔 ${p.paymentId}\n` +
        `🔗 معرف المعاملة: ${p.probotTransactionId || 'N/A'}\n` +
        `📅 ${p.createdAt ? `<t:${Math.floor(p.createdAt / 1000)}:R>` : 'N/A'}`
      ).join('\n\n'))
      .setFooter({ text: `لتأكيد دفعة: /admin ← Payments` })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  },
  async handleConfirm(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.editReply({ content: '🚫 هذا الأمر للمشرفين فقط.' });
    }
    const paymentId = interaction.options.getString('payment_id');
    try {
      const payment = await PaymentService.confirmPayment(paymentId, interaction.user.id);
      const embed = EmbedBuilderUtil.success(
        'تم تأكيد الدفعة',
        `✅ تم تأكيد الدفعة **${paymentId}**.\n💰 المبلغ: ${formatCurrency(payment.amount)}\n💸 العمولة: ${formatCurrency(payment.commissionAmount)} (${Math.round(payment.commissionRate * 100)}%)\n📈 صافي البائع: ${formatCurrency(payment.sellerAmount)}`
      );
      try {
        await client.users.fetch(payment.buyerId).then(u => u.send({
          content: `✅ تم تأكيد دفعتك **${paymentId}** لمبلغ ${formatCurrency(payment.amount)}!\n📦 **${payment.itemName}**\n📝 تم إضافة الرصيد للبائع.`,
        })).catch(() => {});
      } catch (err) { logger.error('Unhandled error in commands/payment/main.js', { error: err?.message }) }
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply({ content: `❌ ${error.message}` });
    }
  },
  buildPaymentEmbed(payment, client) {
    const statusColors = {
      pending: config.colors.warning,
      awaiting_verification: config.colors.info,
      confirmed: config.colors.success,
      completed: config.colors.success,
      failed: config.colors.error,
      expired: config.colors.error,
      cancelled: config.colors.error,
      disputed: config.colors.warning,
    };
    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.money} دفعة #${payment.paymentId}`)
      .setColor(statusColors[payment.status] || config.colors.primary)
      .addFields(
        { name: '💰 المبلغ', value: formatCurrency(payment.amount), inline: true },
        { name: '📊 الحالة', value: this.getStatusText(payment.status), inline: true },
        { name: '📦 العنصر', value: payment.itemName, inline: true },
        { name: '💸 العمولة', value: `${Math.round(payment.commissionRate * 100)}% (${formatCurrency(payment.commissionAmount)})`, inline: true },
        { name: '👤 البائع', value: `<@${payment.sellerId}>`, inline: true },
        { name: '🏪 المتجر', value: payment.storeId?.toString() || 'N/A', inline: true },
        { name: '🔗 كود المرجع', value: `\`${payment.referenceCode}\``, inline: true },
        { name: '⏳ ينتهي', value: payment.expiresAt ? `<t:${Math.floor(payment.expiresAt / 1000)}:R>` : 'N/A', inline: true },
      )
      .setTimestamp();
    if (payment.probotTransactionId) {
      embed.addFields({ name: '🔗 معرف المعاملة', value: `\`${payment.probotTransactionId}\``, inline: false });
    }
    if (payment.completedAt) {
      embed.addFields({ name: '📅 تاريخ الإكمال', value: `<t:${Math.floor(payment.completedAt / 1000)}:F>`, inline: true });
    }
    if (payment.status === 'pending') {
      embed.setFooter({ text: '🔄 قم بتحويل المبلغ ثم استخدم /admin ← Payments للتحقق' });
    }
    return embed;
  },
  getStatusText(status) {
    const texts = {
      pending: '⏳ في انتظار الدفع',
      awaiting_verification: '🔍 قيد المراجعة',
      confirmed: '✅ تم التأكيد',
      completed: '✅ مكتملة',
      failed: '❌ فشلت',
      expired: '⏰ منتهية',
      cancelled: '🚫 ملغية',
      disputed: '⚠️ متنازع عليها',
    };
    return texts[status] || status;
  },
};
