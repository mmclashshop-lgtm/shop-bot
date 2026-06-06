const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { formatCurrency, formatNumber } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const BalanceService = require('../../services/BalanceService');
const { User, MarketplaceSettings } = require('../../database/models');
const fraudDetection = require('../../services/FraudDetectionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('سحب الأرباح')
    .addSubcommand(sub =>
      sub.setName('request')
        .setDescription('طلب سحب الأرباح')
        .addNumberOption(opt => opt.setName('amount').setDescription('المبلغ').setRequired(true).setMinValue(1))
        .addStringOption(opt => opt.setName('method').setDescription('طريقة الاستلام').addChoices(
          { name: 'ProBot كريدت', value: 'probot_credits' },
          { name: 'تحويل بنكي', value: 'bank' },
          { name: 'عملات رقمية', value: 'crypto' },
          { name: 'أخرى', value: 'other' }
        ).setRequired(true))
        .addStringOption(opt => opt.setName('details').setDescription('التفاصيل (رقم الحساب، المحفظة، إلخ)').setMaxLength(500))
    )
    .addSubcommand(sub =>
      sub.setName('history')
        .setDescription('سجل السحوبات')
    )
    .addSubcommand(sub =>
      sub.setName('balance')
        .setDescription('عرض رصيد الأرباح')
        .addUserOption(opt => opt.setName('user').setDescription('المستخدم'))
    )
    .addSubcommand(sub =>
      sub.setName('pending')
        .setDescription('طلبات السحب المعلقة (للمشرفين)')
    )
    .addSubcommand(sub =>
      sub.setName('approve')
        .setDescription('الموافقة على طلب سحب (للمشرفين)')
        .addStringOption(opt => opt.setName('withdrawal_id').setDescription('معرف السحب').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('reject')
        .setDescription('رفض طلب سحب (للمشرفين)')
        .addStringOption(opt => opt.setName('withdrawal_id').setDescription('معرف السحب').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('سبب الرفض').setRequired(true).setMaxLength(500))
    ),
  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case 'request':
        await this.handleRequest(interaction, client);
        break;
      case 'history':
        await this.handleHistory(interaction, client);
        break;
      case 'balance':
        await this.handleBalance(interaction, client);
        break;
      case 'pending':
        await this.handlePending(interaction, client);
        break;
      case 'approve':
        await this.handleApprove(interaction, client);
        break;
      case 'reject':
        await this.handleReject(interaction, client);
        break;
    }
  },
  async handleRequest(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const amount = interaction.options.getNumber('amount');
    const method = interaction.options.getString('method');
    const details = interaction.options.getString('details') || '';
    const user = await User.findOne({ discordId: interaction.user.id }).lean();
    if (!user) return interaction.editReply({ content: '❌ يرجى التسجيل أولاً باستخدام /register.' });
    const balance = user.platformEarnings || 0;
    if (balance < amount) {
      return interaction.editReply({ content: `❌ رصيد غير كافٍ.\nرصيدك: ${formatCurrency(balance)}\nالمطلوب: ${formatCurrency(amount)}` });
    }
    try {
      const fraudCheck = await fraudDetection.checkWithdrawal(interaction.user.id, amount, method, interaction.guildId);
      if (fraudCheck.isFraud) {
        await fraudDetection.sendAdminAlert(interaction, fraudCheck.alert, client);
        return interaction.editReply({ content: '🚫 تم حظر طلب السحب لأسباب أمنية.' });
      }
      if (fraudCheck.alert) {
        await fraudDetection.sendAdminAlert(interaction, fraudCheck.alert, client);
      }

      const accountFarmingCheck = await fraudDetection.checkAccountFarming(interaction.user.id, interaction.guildId);
      if (accountFarmingCheck.isFraud) {
        await fraudDetection.sendAdminAlert(interaction, accountFarmingCheck.alert, client);
        return interaction.editReply({ content: '🚫 تم حظر العملية لأسباب أمنية.' });
      }

      const withdrawal = await BalanceService.requestWithdrawal(interaction.user.id, amount, {
        paymentMethod: method,
        notes: details,
      });
      const embed = new EmbedBuilder()
        .setTitle(`${config.emojis.money} طلب سحب`)
        .setColor(config.colors.warning)
        .addFields(
          { name: '💰 المبلغ', value: formatCurrency(amount), inline: true },
          { name: '💳 طريقة الاستلام', value: method, inline: true },
          { name: '📋 الحالة', value: '⏳ قيد المراجعة', inline: true },
          { name: '🆔 معرف الطلب', value: `\`${withdrawal.withdrawalId}\``, inline: false },
          { name: '📝 التفاصيل', value: details || 'بدون', inline: false },
        )
        .setFooter({ text: 'سيتم مراجعة الطلب من قبل الإدارة' })
        .setTimestamp();
      const settings = await MarketplaceSettings.findOne().lean();
      if (settings?.logChannelId) {
        const logChannel = client.channels.cache.get(settings.logChannelId);
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle('💰 طلب سحب جديد')
            .setColor(config.colors.warning)
            .addFields(
              { name: 'المستخدم', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'المبلغ', value: formatCurrency(amount), inline: true },
              { name: 'الطريقة', value: method, inline: true },
              { name: 'معرف الطلب', value: `\`${withdrawal.withdrawalId}\``, inline: false },
              { name: 'التفاصيل', value: details || 'بدون', inline: false },
            )
            .setTimestamp();
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`withdraw_approve_${withdrawal.withdrawalId}`)
              .setLabel('موافقة')
              .setEmoji('✅')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`withdraw_reject_${withdrawal.withdrawalId}`)
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
  async handleBalance(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const user = await User.findOne({ discordId: targetUser.id }).lean();
    if (!user) return interaction.editReply({ content: '❌ المستخدم غير مسجل.' });
    if (targetUser.id !== interaction.user.id && !interaction.memberPermissions.has('Administrator')) {
      return interaction.editReply({ content: '🚫 غير مصرح.' });
    }
    const balance = user.platformEarnings || 0;
    const totalEarned = user.totalEarned || 0;
    const storeCount = (user.stats?.totalSales || 0);
    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.money} رصيد أرباح ${targetUser.username}`)
      .setColor(config.colors.gold)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '💰 الرصيد الحالي', value: formatCurrency(balance), inline: true },
        { name: '📈 إجمالي الأرباح', value: formatCurrency(totalEarned), inline: true },
        { name: '🛒 إجمالي المبيعات', value: formatNumber(storeCount), inline: true },
      )
      .setFooter({ text: '/market ← Wallet ← Withdraw' })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  },
  async handleHistory(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const withdrawals = await BalanceService.getUserWithdrawals(interaction.user.id);
    if (withdrawals.length === 0) return interaction.editReply({ content: '📭 لا توجد طلبات سحب.' });
    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.chart} سجل السحوبات`)
      .setColor(config.colors.primary)
      .setDescription(withdrawals.map((w, i) =>
        `${i + 1}. **${formatCurrency(w.amount)}** - ${this.getStatusText(w.status)}\n` +
        `🆔 ${w.withdrawalId} | 📅 ${w.requestedAt ? `<t:${Math.floor(w.requestedAt / 1000)}:R>` : 'N/A'}`
      ).join('\n\n'))
      .setFooter({ text: `إجمالي: ${withdrawals.length} طلب` })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  },
  async handlePending(interaction, client) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 هذا الأمر للمشرفين فقط.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const pending = await BalanceService.getPendingWithdrawals();
    if (pending.length === 0) return interaction.editReply({ content: '✅ لا توجد طلبات سحب معلقة.' });
    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.money} طلبات السحب المعلقة (${pending.length})`)
      .setColor(config.colors.warning)
      .setDescription(pending.slice(0, 10).map((w, i) =>
        `${i + 1}. **${formatCurrency(w.amount)}** - 👤 <@${w.userId}>\n` +
        `🆔 ${w.withdrawalId} | 💳 ${w.paymentMethod}\n` +
        `📅 ${w.requestedAt ? `<t:${Math.floor(w.requestedAt / 1000)}:R>` : 'N/A'}`
      ).join('\n\n'))
      .setFooter({ text: '/admin ← Withdrawals للموافقة أو الرفض' })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  },
  async handleApprove(interaction, client) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 هذا الأمر للمشرفين فقط.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const withdrawalId = interaction.options.getString('withdrawal_id');
    try {
      const withdrawal = await BalanceService.approveWithdrawal(withdrawalId, interaction.user.id);
      const embed = EmbedBuilderUtil.success(
        'تمت الموافقة على طلب السحب',
        `✅ تمت الموافقة على طلب السحب **${withdrawalId}**.\n💰 المبلغ: ${formatCurrency(withdrawal.amount)}\n👤 المستخدم: <@${withdrawal.userId}>`
      );
      try {
        await client.users.fetch(withdrawal.userId).then(u => u.send({
          content: `✅ تمت الموافقة على طلب السحب **${withdrawalId}** لمبلغ ${formatCurrency(withdrawal.amount)}!`,
        })).catch(() => {});
      } catch (err) { logger.error('Unhandled error in commands/withdraw/main.js', { error: err?.message }) }
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply({ content: `❌ ${error.message}` });
    }
  },
  async handleReject(interaction, client) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 هذا الأمر للمشرفين فقط.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const withdrawalId = interaction.options.getString('withdrawal_id');
    const reason = interaction.options.getString('reason');
    try {
      const withdrawal = await BalanceService.rejectWithdrawal(withdrawalId, interaction.user.id, reason);
      const embed = EmbedBuilderUtil.error(
        'تم رفض طلب السحب',
        `❌ تم رفض طلب السحب **${withdrawalId}**.\n💰 المبلغ: ${formatCurrency(withdrawal.amount)}\n👤 المستخدم: <@${withdrawal.userId}>\n📝 السبب: ${reason}`
      );
      try {
        await client.users.fetch(withdrawal.userId).then(u => u.send({
          content: `❌ تم رفض طلب السحب **${withdrawalId}** لمبلغ ${formatCurrency(withdrawal.amount)}\n📝 السبب: ${reason}`,
        })).catch(() => {});
      } catch (err) { logger.error('Unhandled error in commands/withdraw/main.js', { error: err?.message }) }
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply({ content: `❌ ${error.message}` });
    }
  },
  getStatusText(status) {
    const texts = {
      pending: '⏳ معلق',
      approved: '✅ تمت الموافقة',
      rejected: '❌ مرفوض',
      processing: '🔄 قيد المعالجة',
      completed: '✅ مكتمل',
      cancelled: '🚫 ملغي',
    };
    return texts[status] || status;
  },
};
