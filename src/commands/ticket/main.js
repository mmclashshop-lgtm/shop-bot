const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { PanelManager, NAV } = require('../../utils/PanelManager');
const config = require('../../config');
const { Ticket } = require('../../database/models');
const { logger } = require('../../utils/logger');
const auditService = require('../../services/AuditService');

const COLORS = { create: 0x3498DB, my: 0x2ECC71, support: 0x9B59B6, report: 0xE74C3C, partnership: 0xF1C40F };
const MAX_OPEN_TICKETS = 5;
const TICKET_CREATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

const ticketCreationCooldowns = new Map();

function generateCorrelationId() {
  return `corr_${Date.now().toString(36)}_${require('crypto').randomBytes(6).toString('hex')}`;
}

function checkTicketCooldown(userId) {
  const lastCreated = ticketCreationCooldowns.get(userId);
  if (lastCreated && Date.now() - lastCreated < TICKET_CREATION_COOLDOWN_MS) {
    const remaining = Math.ceil((TICKET_CREATION_COOLDOWN_MS - (Date.now() - lastCreated)) / 1000);
    return remaining;
  }
  return 0;
}

function setTicketCooldown(userId) {
  ticketCreationCooldowns.set(userId, Date.now());
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('🎫 نظام التذاكر والدعم'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    return this.showHome(interaction);
  },

  async showHome(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🎫 نظام التذاكر والدعم')
      .setDescription('مرحباً بك في نظام الدعم. اختر الخدمة المناسبة.')
      .setColor(config.colors.primary)
      .addFields(
        { name: '🎫 إنشاء تذكرة', value: 'فتح تذكرة دعم جديدة', inline: true },
        { name: '📋 تذاكري', value: 'عرض تذاكرك السابقة', inline: true },
        { name: '📞 دعم فني', value: 'التواصل مع فريق الدعم', inline: true },
        { name: '⚠️ بلاغ', value: 'الإبلاغ عن مشكلة', inline: true },
        { name: '🤝 شراكة', value: 'طلب شراكة أو تعاون', inline: true },
      )
      .setFooter({ text: 'جميع التذاكر تعالج بسرية تامة' })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('ticket_create', 'إنشاء تذكرة', '🎫', ButtonStyle.Primary),
      PanelManager.panelButton('ticket_mine', 'تذاكري', '📋', ButtonStyle.Primary),
      PanelManager.panelButton('ticket_support', 'دعم فني', '📞', ButtonStyle.Success),
      PanelManager.panelButton('ticket_report', 'بلاغ', '⚠️', ButtonStyle.Danger),
      PanelManager.panelButton('ticket_partner', 'شراكة', '🤝', ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder().addComponents(NAV.close('ticket'));
    return PanelManager.update(interaction, { embeds: [embed], components: [row, row2] });
  },

  async handleButton(interaction, client, action) {
    const modalActions = ['create', 'support', 'report', 'partner'];
    if (!modalActions.includes(action)) {
      await PanelManager.defer(interaction);
    }
    switch (action) {
      case 'home': return this.showHome(interaction);
      case 'close': return interaction.deleteReply().catch(() => {});
      case 'refresh': return this.showHome(interaction);
      case 'create': return this.showCreateModal(interaction, 'support');
      case 'mine': return this.showMyTickets(interaction);
      case 'support': return this.showCreateModal(interaction, 'support');
      case 'report': return this.showCreateModal(interaction, 'report');
      case 'partner': return this.showCreateModal(interaction, 'partnership');
      default: return this.showHome(interaction);
    }
  },

  async showCreateModal(interaction, type = 'support') {
    const typeNames = { support: 'دعم فني', report: 'بلاغ', partnership: 'شراكة' };
    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal_${type}`)
      .setTitle(`🎫 ${typeNames[type] || 'تذكرة جديدة'}`);
    const subject = new TextInputBuilder()
      .setCustomId('subject').setLabel('الموضوع').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true);
    const desc = new TextInputBuilder()
      .setCustomId('description').setLabel('الوصف').setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(subject), new ActionRowBuilder().addComponents(desc));
    try { await interaction.showModal(modal); } catch (err) { logger.error('Unhandled error in commands/ticket/main.js', { error: err?.message }) }
  },

  async handleModalSubmit(interaction, client, action) {
    const subject = interaction.fields.getTextInputValue('subject');
    const description = interaction.fields.getTextInputValue('description');
    await interaction.deferReply({ ephemeral: true });
    try {
      // Check cooldown
      const cooldownRemaining = checkTicketCooldown(interaction.user.id);
      if (cooldownRemaining > 0) {
        return PanelManager.update(interaction, { embeds: [PanelManager.embed('⏳ انتظر', `يجب الانتظار ${cooldownRemaining} ثانية قبل إنشاء تذكرة جديدة.`, config.colors.warning)] });
      }

      const openCount = await Ticket.countDocuments({ userId: interaction.user.id, status: { $ne: 'closed' } });
      if (openCount >= MAX_OPEN_TICKETS) {
        return PanelManager.update(interaction, { embeds: [PanelManager.embed('❌ حد أقصى', `لديك ${MAX_OPEN_TICKETS} تذاكر مفتوحة حالياً. يرجى انتظار إغلاق واحدة قبل فتح تذكرة جديدة.`, config.colors.error)] });
      }

      const correlationId = generateCorrelationId();
      const ticket = await Ticket.create({
        ticketNumber: `TKT-${Date.now().toString(36).toUpperCase()}`,
        userId: interaction.user.id,
        type: action === 'partnership' ? 'partnership' : action === 'report' ? 'report' : 'support',
        subject,
        description,
        status: 'open',
        priority: 'medium',
        correlationId,
        metadata: { createdVia: 'modal', guildId: interaction.guildId },
      });

      setTicketCooldown(interaction.user.id);

      await auditService.log('ticket_created', interaction.user.id, {
        targetId: ticket._id.toString(),
        targetType: 'ticket',
        details: {
          ticketNumber: ticket.ticketNumber,
          ticketId: ticket._id.toString(),
          subject,
          type: ticket.type,
          correlationId,
        },
        guildId: interaction.guildId,
        metadata: { commandName: 'ticket create' },
      });

      const embed = PanelManager.embed('✅ تم إنشاء التذكرة', `تم إنشاء تذكرتك بنجاح.\n🎫 رقم التذكرة: **${ticket.ticketNumber}**\n📋 الموضوع: **${subject}**`, COLORS.create);
      const row = PanelManager.navRow('ticket');
      return PanelManager.update(interaction, { embeds: [embed], components: [row] });
    } catch (error) {
      logger.error('Ticket creation failed', { error: error.message });
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('❌ خطأ', 'حدث خطأ أثناء إنشاء التذكرة.', config.colors.error)] });
    }
  },

  async showMyTickets(interaction) {
    const tickets = await Ticket.find({ userId: interaction.user.id }).sort({ createdAt: -1 }).limit(10).lean();
    if (tickets.length === 0) {
      const embed = PanelManager.embed('📭 لا توجد تذاكر', 'لم تقم بإنشاء أي تذكرة بعد.', config.colors.warning);
      const row = PanelManager.navRow('ticket');
      return PanelManager.update(interaction, { embeds: [embed], components: [row] });
    }
    const embed = PanelManager.embed('📋 تذاكري', tickets.map((t, i) => `${i + 1}. **${t.subject}** — ${t.status} — <t:${Math.floor(t.createdAt / 1000)}:R>`).join('\n'), COLORS.my);
    const row = PanelManager.navRow('ticket');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },
};
