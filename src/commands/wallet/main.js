const crypto = require('crypto');
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const mongoose = require('mongoose');
const { User, Transaction, PendingAction } = require('../../database/models');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { formatCurrency, formatNumber } = require('../../utils/helpers');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const fraudDetection = require('../../services/FraudDetectionService');

const MAX_PENDING_PER_USER = 3;

async function getPendingCount(userId) {
  try {
    return await PendingAction.countDocuments({ userId });
  } catch {
    return 0;
  }
}


module.exports = {
  data: new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('إدارة المحفظة')
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('عرض رصيد المحفظة')
        .addUserOption(opt => opt.setName('user').setDescription('المستخدم (اختياري)'))
    )
    .addSubcommand(sub =>
      sub.setName('deposit')
        .setDescription('إيداع رصيد')
        .addNumberOption(opt => opt.setName('amount').setDescription('المبلغ').setRequired(true).setMinValue(1))
        .addStringOption(opt => opt.setName('method').setDescription('طريقة الدفع').addChoices(
          { name: 'كريدت برو بوت', value: 'credits' },
          { name: 'تحويل بنكي', value: 'bank' },
          { name: 'عملات رقمية', value: 'crypto' },
          { name: 'أخرى', value: 'other' }
        ).setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('withdraw')
        .setDescription('سحب رصيد')
        .addNumberOption(opt => opt.setName('amount').setDescription('المبلغ').setRequired(true).setMinValue(1))
        .addStringOption(opt => opt.setName('method').setDescription('طريقة السحب').addChoices(
          { name: 'تحويل بنكي', value: 'bank' },
          { name: 'عملات رقمية', value: 'crypto' },
          { name: 'أخرى', value: 'other' }
        ).setRequired(true))
        .addStringOption(opt => opt.setName('details').setDescription('تفاصيل الحساب').setRequired(true).setMaxLength(500))
    )
    .addSubcommand(sub =>
      sub.setName('pay')
        .setDescription('تحويل رصيد لمستخدم')
        .addUserOption(opt => opt.setName('user').setDescription('المستلم').setRequired(true))
        .addNumberOption(opt => opt.setName('amount').setDescription('المبلغ').setRequired(true).setMinValue(1))
        .addStringOption(opt => opt.setName('note').setDescription('ملاحظة').setMaxLength(200))
    )
    .addSubcommand(sub =>
      sub.setName('history')
        .setDescription('سجل المعاملات')
        .addIntegerOption(opt => opt.setName('page').setDescription('رقم الصفحة').setMinValue(1))
        .addStringOption(opt => opt.setName('type').setDescription('نوع المعاملة'))
    )
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('إحصائيات المحفظة')
    ),

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'view':
        await this.handleView(interaction, client);
        break;
      case 'deposit':
        await this.handleDeposit(interaction, client);
        break;
      case 'withdraw':
        await this.handleWithdraw(interaction, client);
        break;
      case 'pay':
        await this.handlePay(interaction, client);
        break;
      case 'history':
        await this.handleHistory(interaction, client);
        break;
      case 'stats':
        await this.handleStats(interaction, client);
        break;
    }
  },

  async handleView(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const user = await User.findOne({ discordId: targetUser.id }).lean();

    if (!user) {
      return interaction.editReply({ content: '❌ المستخدم غير مسجل.' });
    }

    if (targetUser.id !== interaction.user.id) {
      if (!user.settings.privacy.showBalance) {
        return interaction.editReply({ content: '🚫 هذا المستخدم أخفى رصيده.' });
      }
    }

    const embed = EmbedBuilderUtil.walletCard(user, {
      username: targetUser.username,
      avatar: targetUser.displayAvatarURL(),
    });

    const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wallet_deposit')
        .setLabel('إيداع')
        .setEmoji(config.emojis.plus)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('wallet_withdraw')
        .setLabel('سحب')
        .setEmoji(config.emojis.minus)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('wallet_pay')
        .setLabel('تحويل')
        .setEmoji(config.emojis.arrowRight)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('wallet_history')
        .setLabel('السجل')
        .setEmoji(config.emojis.chart)
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  },

  async handleDeposit(interaction, client) {
    const amount = interaction.options.getNumber('amount');
    const method = interaction.options.getString('method');

    const user = await User.findOne({ discordId: interaction.user.id }).lean();
    if (!user) {
      return interaction.reply({ content: '❌ يرجى التسجيل أولاً.', ephemeral: true });
    }

    const minDeposit = 10;
    const maxDeposit = 1000000;

    if (amount < minDeposit || amount > maxDeposit) {
      return interaction.reply({ content: `❌ المبلغ يجب أن يكون بين ${minDeposit} و ${maxDeposit.toLocaleString()} ${config.currency.symbol}`, ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`wallet_deposit_modal_${method}`)
      .setTitle(`إيداع ${formatCurrency(amount)} عبر ${method}`);

    const detailsInput = new TextInputBuilder()
      .setCustomId('details')
      .setLabel('تفاصيل الإيداع (رقم العملية، مرجع، إلخ)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('أدخل تفاصيل عملية الإيداع...')
      .setRequired(true)
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(detailsInput));

    await interaction.showModal(modal).catch(() => {});
  },

  async handleWithdraw(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const amount = interaction.options.getNumber('amount');
    const method = interaction.options.getString('method');
    const details = interaction.options.getString('details');

    const user = await User.findOne({ discordId: interaction.user.id }).lean();
    if (!user) {
      return interaction.editReply({ content: '❌ يرجى التسجيل أولاً.' });
    }

    if (user.balance < amount) {
      return interaction.editReply({
        content: `❌ رصيد غير كافٍ.\nرصيدك: ${formatCurrency(user.balance)}\nالمطلوب: ${formatCurrency(amount)}`,
      });
    }

    const minWithdraw = 50;
    const maxWithdraw = 500000;
    const feePercent = 2;
    const fee = Math.ceil(amount * feePercent / 100);
    const netAmount = amount - fee;

    if (amount < minWithdraw || amount > maxWithdraw) {
      return interaction.editReply({ content: `❌ المبلغ يجب أن يكون بين ${minWithdraw} و ${maxWithdraw.toLocaleString()} ${config.currency.symbol}` });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.money} تأكيد السحب`)
      .setColor(config.colors.warning)
      .addFields(
        { name: '💰 المبلغ المطلوب', value: formatCurrency(amount), inline: true },
        { name: '💸 الرسوم (2%)', value: formatCurrency(fee), inline: true },
        { name: '✅ الصافي', value: formatCurrency(netAmount), inline: true },
        { name: '💳 الطريقة', value: method, inline: true },
        { name: '📝 التفاصيل', value: details, inline: false },
      )
      .setFooter({ text: 'اضغط تأكيد للموافقة' })
      .setTimestamp();

    if (getPendingCount(interaction.user.id) >= MAX_PENDING_PER_USER) {
      return interaction.editReply({ content: `❌ لديك بالفعل ${MAX_PENDING_PER_USER} عملية معلقة. أكمل أو ألغِ العمليات الحالية أولاً.` });
    }

    const nonce = crypto.randomUUID();
    await PendingAction.create({ nonce, type: 'withdraw', userId: interaction.user.id, amount, method, details });

    const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`wallet_withdraw_confirm_${nonce}`)
        .setLabel('تأكيد السحب')
        .setEmoji(config.emojis.money)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`wallet_withdraw_cancel_${nonce}`)
        .setLabel('إلغاء')
        .setEmoji(config.emojis.delete)
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  },

  async handlePay(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getNumber('amount');
    const note = interaction.options.getString('note') || '';

    if (targetUser.id === interaction.user.id) {
      return interaction.editReply({ content: '❌ لا يمكنك تحويل رصيد لنفسك.' });
    }

    if (targetUser.bot) {
      return interaction.editReply({ content: '❌ لا يمكن تحويل رصيد للبوتات.' });
    }

    const sender = await User.findOne({ discordId: interaction.user.id }).lean();
    if (!sender) {
      return interaction.editReply({ content: '❌ يرجى التسجيل أولاً.' });
    }

    if (sender.balance < amount) {
      return interaction.editReply({
        content: `❌ رصيد غير كافٍ.\nرصيدك: ${formatCurrency(sender.balance)}\nالمطلوب: ${formatCurrency(amount)}`,
      });
    }

    const receiver = await User.findOne({ discordId: targetUser.id }).lean();
    if (!receiver) {
      return interaction.editReply({ content: '❌ المستلم غير مسجل في البوت.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.arrowRight} تأكيد التحويل`)
      .setColor(config.colors.primary)
      .addFields(
        { name: '👤 المرسل', value: `<@${interaction.user.id}>`, inline: true },
        { name: '👤 المستلم', value: `<@${targetUser.id}>`, inline: true },
        { name: '💰 المبلغ', value: formatCurrency(amount), inline: true },
        { name: '📝 ملاحظة', value: note || 'بدون', inline: false },
      )
      .setTimestamp();

    if (getPendingCount(interaction.user.id) >= MAX_PENDING_PER_USER) {
      return interaction.editReply({ content: `❌ لديك بالفعل ${MAX_PENDING_PER_USER} عملية معلقة. أكمل أو ألغِ العمليات الحالية أولاً.` });
    }

    const nonce = crypto.randomUUID();
    await PendingAction.create({ nonce, type: 'pay', userId: interaction.user.id, targetUserId: targetUser.id, amount, note });

    const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`wallet_pay_confirm_${nonce}`)
        .setLabel('تأكيد التحويل')
        .setEmoji(config.emojis.money)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`wallet_pay_cancel_${nonce}`)
        .setLabel('إلغاء')
        .setEmoji(config.emojis.delete)
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  },

  async handleHistory(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const page = interaction.options.getInteger('page') || 1;
    const type = interaction.options.getString('type');
    const limit = 10;
    const skip = (page - 1) * limit;

    const query = { userId: interaction.user.id };
    if (type) query.type = type;

    const [transactions, total] = await Promise.all([
      Transaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Transaction.countDocuments(query),
    ]);

    if (transactions.length === 0) {
      return interaction.editReply({ content: '📭 لا توجد معاملات.' });
    }

    const totalPages = Math.ceil(total / limit);

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.chart} سجل المعاملات (صفحة ${page}/${totalPages})`)
      .setColor(config.colors.primary)
      .setDescription(transactions.map((t, i) => {
        const emoji = t.amount >= 0 ? '🟢' : '🔴';
        const sign = t.amount >= 0 ? '+' : '';
        return `${skip + i + 1}. ${emoji} **${t.type}** ${sign}${formatCurrency(t.amount)} - ${t.description.substring(0, 50)}`;
      }).join('\n'))
      .setFooter({ text: `إجمالي: ${total} معاملة` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleStats(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const user = await User.findOne({ discordId: interaction.user.id }).lean();
    if (!user) {
      return interaction.editReply({ content: '❌ يرجى التسجيل أولاً.' });
    }

    const [totalDeposits, totalWithdraws, totalPurchases, totalSales, totalTransfers] = await Promise.all([
      Transaction.aggregate([{ $match: { userId: interaction.user.id, type: 'deposit', status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { userId: interaction.user.id, type: 'withdraw', status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { userId: interaction.user.id, type: 'purchase', status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { userId: interaction.user.id, type: 'sale', status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { userId: interaction.user.id, type: 'transfer', status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    ]);

    const embed = new EmbedBuilder()
      .setTitle(`${config.emojis.chart} إحصائيات المحفظة`)
      .setColor(config.colors.gold)
      .addFields(
        { name: '📥 إجمالي الإيداعات', value: formatCurrency(totalDeposits[0]?.total || 0), inline: true },
        { name: '📤 إجمالي السحوبات', value: formatCurrency(Math.abs(totalWithdraws[0]?.total || 0)), inline: true },
        { name: '🛒 إجمالي المشتريات', value: formatCurrency(Math.abs(totalPurchases[0]?.total || 0)), inline: true },
        { name: '💰 إجمالي المبيعات', value: formatCurrency(totalSales[0]?.total || 0), inline: true },
        { name: '🔄 إجمالي التحويلات', value: formatCurrency(totalTransfers[0]?.total || 0), inline: true },
        { name: '⭐ نقاط الولاء', value: formatNumber(user.loyaltyPoints), inline: true },
        { name: '🏆 مستوى الثقة', value: user.trustLevel, inline: true },
        { name: '📊 الرصيد الحالي', value: formatCurrency(user.balance), inline: true },
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },

  async handleButton(interaction, client, action) {
    if (action === 'deposit') {
      const modal = new ModalBuilder()
        .setCustomId('wallet_deposit_amount')
        .setTitle('إيداع رصيد');

      const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('المبلغ')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('1000')
        .setRequired(true)
        .setMaxLength(10);

      const methodInput = new TextInputBuilder()
        .setCustomId('method')
        .setLabel('الطريقة (credits, bank, crypto, other)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('credits')
        .setRequired(true)
        .setMaxLength(20);

      modal.addComponents(
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(methodInput)
      );

      return interaction.showModal(modal).catch(() => {});
    }

    if (action === 'withdraw') {
      const modal = new ModalBuilder()
        .setCustomId('wallet_withdraw_amount')
        .setTitle('سحب رصيد');

      const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('المبلغ')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('500')
        .setRequired(true)
        .setMaxLength(10);

      const methodInput = new TextInputBuilder()
        .setCustomId('method')
        .setLabel('الطريقة (bank, crypto, other)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('bank')
        .setRequired(true)
        .setMaxLength(20);

      const detailsInput = new TextInputBuilder()
        .setCustomId('details')
        .setLabel('تفاصيل الحساب')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('رقم الحساب، المحفظة، إلخ')
        .setRequired(true)
        .setMaxLength(500);

      modal.addComponents(
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(methodInput),
        new ActionRowBuilder().addComponents(detailsInput)
      );

      return interaction.showModal(modal).catch(() => {});
    }

    if (action === 'pay') {
      const modal = new ModalBuilder()
        .setCustomId('wallet_pay_amount')
        .setTitle('تحويل رصيد');

      const userInput = new TextInputBuilder()
        .setCustomId('user_id')
        .setLabel('معرف المستخدم المستلم')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('123456789012345678')
        .setRequired(true)
        .setMaxLength(19);

      const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('المبلغ')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('100')
        .setRequired(true)
        .setMaxLength(10);

      const noteInput = new TextInputBuilder()
        .setCustomId('note')
        .setLabel('ملاحظة (اختياري)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('شكراً للخدمة!')
        .setRequired(false)
        .setMaxLength(200);

      modal.addComponents(
        new ActionRowBuilder().addComponents(userInput),
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(noteInput)
      );

      return interaction.showModal(modal).catch(() => {});
    }

    if (action === 'history') {
      return this.handleHistory(interaction, client);
    }

    if (action.startsWith('withdraw_confirm_')) {
      const nonce = action.replace('withdraw_confirm_', '');
      const pending = await PendingAction.findOneAndDelete({ nonce, type: 'withdraw', userId: interaction.user.id });
      if (!pending) {
        return interaction.update({ content: '❌ طلب منتهي الصلاحية. حاول مرة أخرى.', embeds: [], components: [] }).catch(() => {});
      }

      const { amount, method } = pending;

      const fraudCheck = await fraudDetection.checkWithdrawal(interaction.user.id, amount, method, interaction.guildId);
      if (fraudCheck.isFraud) {
        if (fraudCheck.alert) {
          await fraudDetection.sendAdminAlert(interaction, fraudCheck.alert, client);
        }
        return interaction.update({
          content: `🚫 تم حظر السحب لأسباب أمنية. (رمز: ${fraudCheck.alert?.alertId || 'FRAUD_BLOCK'})`,
          embeds: [], components: [],
        }).catch(() => {});
      }
      if (fraudCheck.alert) {
        await fraudDetection.sendAdminAlert(interaction, fraudCheck.alert, client);
      }

      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      const session = await mongoose.startSession();
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });

      try {
        const fee = Math.ceil(amount * 2 / 100);
        const netAmount = amount - fee;

        const user = await User.findOneAndUpdate(
          { discordId: interaction.user.id, balance: { $gte: amount } },
          { $inc: { balance: -amount } },
          { new: true, session }
        );
        if (!user) {
          await session.abortTransaction();
          return interaction.editReply({ content: '❌ رصيد غير كافٍ.' });
        }

        await Transaction.create([{
          userId: interaction.user.id,
          type: 'withdraw',
          status: 'pending',
          amount: -amount,
          currency: 'credits',
          balanceBefore: user.balance + amount,
          balanceAfter: user.balance,
          description: `سحب ${formatCurrency(amount)} عبر ${method}`,
          metadata: { method, fee, netAmount },
        }], { session });

        await session.commitTransaction();

        return interaction.editReply({
          content: `✅ تم تقديم طلب السحب.\n💰 المبلغ: ${formatCurrency(amount)}\n💸 الرسوم: ${formatCurrency(fee)}\n✅ الصافي: ${formatCurrency(netAmount)}\n⏳ سيتم المعالجة خلال 24-48 ساعة.`,
        });
      } catch (error) {
        await session.abortTransaction();
        logger.error('Withdraw error', { error: error.message });
        return interaction.editReply({ content: `❌ حدث خطأ: ${error.message}` });
      } finally {
        session.endSession();
      }
    }

    if (action.startsWith('withdraw_cancel_')) {
      const nonce = action.replace('withdraw_cancel_', '');
      await PendingAction.findOneAndDelete({ nonce, userId: interaction.user.id });
      return interaction.update({ content: '❌ تم إلغاء طلب السحب.', embeds: [], components: [] }).catch(() => {});
    }

    if (action.startsWith('pay_confirm_')) {
      const nonce = action.replace('pay_confirm_', '');
      const pending = await PendingAction.findOneAndDelete({ nonce, type: 'pay', userId: interaction.user.id });
      if (!pending) {
        return interaction.update({ content: '❌ طلب منتهي الصلاحية. حاول مرة أخرى.', embeds: [], components: [] }).catch(() => {});
      }

      const { targetUserId, amount, note } = pending;

      const fraudCheck = await fraudDetection.checkWalletTransfer(interaction.user.id, targetUserId, amount, interaction.guildId);
      if (fraudCheck.isFraud) {
        if (fraudCheck.alert) {
          await fraudDetection.sendAdminAlert(interaction, fraudCheck.alert, client);
        }
        return interaction.update({
          content: `🚫 تم حظر التحويل لأسباب أمنية. (رمز: ${fraudCheck.alert?.alertId || 'FRAUD_BLOCK'})`,
          embeds: [], components: [],
        }).catch(() => {});
      }
      if (fraudCheck.alert) {
        await fraudDetection.sendAdminAlert(interaction, fraudCheck.alert, client);
      }

      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      const session = await mongoose.startSession();
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });

      try {
        const receiver = await User.findOne({ discordId: targetUserId }).session(session.lean());
        if (!receiver) {
          await session.abortTransaction();
          return interaction.editReply({ content: '❌ المستخدم غير موجود.' });
        }

        const sender = await User.findOneAndUpdate(
          { discordId: interaction.user.id, balance: { $gte: amount } },
          { $inc: { balance: -amount } },
          { new: true, session }
        );
        if (!sender) {
          await session.abortTransaction();
          return interaction.editReply({ content: '❌ رصيد غير كافٍ.' });
        }

        receiver.balance += amount;
        await receiver.save({ session });

        await Transaction.create([{
          userId: interaction.user.id,
          type: 'transfer',
          status: 'completed',
          amount: -amount,
          currency: 'credits',
          balanceBefore: sender.balance + amount,
          balanceAfter: sender.balance,
          description: `تحويل لـ <@${targetUserId}>`,
          reference: { userId: targetUserId },
        }, {
          userId: targetUserId,
          type: 'transfer',
          status: 'completed',
          amount,
          currency: 'credits',
          balanceBefore: receiver.balance - amount,
          balanceAfter: receiver.balance,
          description: `استلام من <@${interaction.user.id}>`,
          reference: { userId: interaction.user.id },
        }], { session });

        await session.commitTransaction();
      } catch (error) {
        await session.abortTransaction();
        logger.error('Pay transfer error', { error: error.message });
        return interaction.editReply({ content: `❌ حدث خطأ أثناء التحويل: ${error.message}` });
      } finally {
        session.endSession();
      }

      try {
        await client.users.fetch(targetUserId).then(u => u.send({
          content: `💰 استلمت ${formatCurrency(amount)} من <@${interaction.user.id}>`,
        })).catch(() => {});
      } catch (err) { logger.error('Unhandled error in commands/wallet/main.js', { error: err?.message }) }

      return interaction.editReply({
        content: `✅ تم التحويل بنجاح!\n💰 المبلغ: ${formatCurrency(amount)}\n👤 المستلم: <@${targetUserId}>`,
      });
    }

    if (action.startsWith('pay_cancel_')) {
      const nonce = action.replace('pay_cancel_', '');
      await PendingAction.findOneAndDelete({ nonce, userId: interaction.user.id });
      return interaction.update({ content: '❌ تم إلغاء التحويل.', embeds: [], components: [] }).catch(() => {});
    }
  },

  async handleModalSubmit(interaction, client) {
    if (interaction.customId.startsWith('wallet_deposit_modal_')) {
      await interaction.deferReply({ ephemeral: true });

      const suffix = interaction.customId.replace('wallet_deposit_modal_', '');
      const firstUnderscore = suffix.indexOf('_');
      const amount = parseFloat(firstUnderscore > 0 ? suffix.substring(0, firstUnderscore) : suffix);
      const method = firstUnderscore > 0 ? suffix.substring(firstUnderscore + 1) : '';

      if (!Number.isFinite(amount) || amount <= 0) {
        return interaction.editReply({ content: '❌ المبلغ غير صالح.' });
      }

      const allowedMethods = ['credits', 'bank', 'crypto', 'other'];
      if (!allowedMethods.includes(method)) {
        return interaction.editReply({ content: '❌ طريقة دفع غير صالحة.' });
      }

      const details = interaction.fields.getTextInputValue('details');
      const user = await User.findOne({ discordId: interaction.user.id }).lean();

      if (user) {
        await Transaction.create({
          userId: interaction.user.id,
          type: 'deposit',
          status: 'pending',
          amount,
          currency: 'credits',
          balanceBefore: user.balance,
          balanceAfter: user.balance,
          description: `إيداع ${formatCurrency(amount)} عبر ${method}`,
          metadata: { method, details },
        });
      }

      return interaction.editReply({
        content: `✅ تم استلام طلب الإيداع.\n💰 المبلغ: ${formatCurrency(amount)}\n💳 الطريقة: ${method}\n📝 التفاصيل: ${details}\n\n⏳ سيتم مراجعة الطلب وإضافة الرصيد خلال 24 ساعة.`,
      });
    }

    if (interaction.customId === 'wallet_deposit_amount') {
      const amount = parseFloat(interaction.fields.getTextInputValue('amount'));
      const method = interaction.fields.getTextInputValue('method');

      if (!Number.isFinite(amount) || amount < 10) {
        return interaction.reply({ content: '❌ المبلغ يجب أن يكون 10 على الأقل.', ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`wallet_deposit_modal_${amount}_${method}`)
        .setTitle(`إيداع ${formatCurrency(amount)}`);

      const detailsInput = new TextInputBuilder()
        .setCustomId('details')
        .setLabel('تفاصيل الإيداع')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('رقم العملية، مرجع التحويل، إلخ')
        .setRequired(true)
        .setMaxLength(500);

      modal.addComponents(new ActionRowBuilder().addComponents(detailsInput));

      return interaction.showModal(modal).catch(() => {});
    }

    if (interaction.customId === 'wallet_withdraw_amount') {
      await interaction.deferReply({ ephemeral: true });

      const amountStr = interaction.fields.getTextInputValue('amount');
      const method = interaction.fields.getTextInputValue('method');
      const details = interaction.fields.getTextInputValue('details');

      const amount = parseFloat(amountStr);
      if (!Number.isFinite(amount) || amount < 50) {
        return interaction.editReply({ content: '❌ المبلغ يجب أن يكون 50 على الأقل.' });
      }

      const newInteraction = Object.create(interaction);
      newInteraction.options = {
        getNumber: () => amount,
        getString: (key) => {
          if (key === 'method') return method;
          if (key === 'details') return details;
          return interaction.options.getString(key);
        },
      };
      newInteraction.deferred = true;
      newInteraction.deferReply = () => Promise.resolve();
      newInteraction.editReply = interaction.editReply.bind(interaction);

      return this.handleWithdraw(newInteraction, client);
    }

    if (interaction.customId === 'wallet_pay_amount') {
      await interaction.deferReply({ ephemeral: true });

      const targetUserId = interaction.fields.getTextInputValue('user_id');
      const amount = parseFloat(interaction.fields.getTextInputValue('amount'));
      const note = interaction.fields.getTextInputValue('note');

      if (!Number.isFinite(amount) || amount <= 0) {
        return interaction.editReply({ content: '❌ مبلغ غير صالح.' });
      }

      if (!/^\d{17,19}$/.test(targetUserId)) {
        return interaction.editReply({ content: '❌ معرف مستخدم غير صالح.' });
      }

      const mockInteraction = Object.create(interaction);
      mockInteraction.options = {
        getUser: () => ({ id: targetUserId }),
        getNumber: () => amount,
        getString: () => note,
      };
      mockInteraction.deferred = true;
      mockInteraction.deferReply = () => Promise.resolve();
      mockInteraction.editReply = interaction.editReply.bind(interaction);

      return this.handlePay(mockInteraction, client);
    }
  },
};
