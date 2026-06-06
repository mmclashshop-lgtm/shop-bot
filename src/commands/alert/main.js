const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const AlertService = require('../../services/AlertService');
const { logger } = require('../../utils/logger');
const { EmbedBuilderUtil } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alert')
    .setDescription('🚨 نظام التنبيهات والمراقبة (للمشرفين)')
    .addSubcommand(sub =>
      sub.setName('dashboard')
        .setDescription('لوحة التنبيهات الرئيسية')
    )
    .addSubcommand(sub =>
      sub.setName('history')
        .setDescription('سجل التنبيهات')
        .addStringOption(opt =>
          opt.setName('category')
            .setDescription('تصفية حسب الفئة')
            .setRequired(false)
            .addChoices(
              { name: '🗄️ MongoDB', value: 'mongodb' },
              { name: '💬 Discord', value: 'discord' },
              { name: '🤖 AI', value: 'ai' },
              { name: '👛 Wallet', value: 'wallet' },
              { name: '💳 Payment', value: 'payment' },
              { name: '💰 Withdrawal', value: 'withdrawal' },
              { name: '🧠 Memory', value: 'memory' },
              { name: '⚡ CPU', value: 'cpu' },
              { name: '📈 Error Rate', value: 'error_rate' },
              { name: '🚨 Fraud', value: 'fraud' },
              { name: '🚫 Spam', value: 'spam' },
              { name: '🌐 Webhook', value: 'webhook' },
            ))
    )
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('إحصائيات التنبيهات')
    )
    .addSubcommand(sub =>
      sub.setName('acknowledge')
        .setDescription('تأكيد استلام تنبيه')
        .addStringOption(opt =>
          opt.setName('alert_id')
            .setDescription('معرف التنبيه')
            .setRequired(true))
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 نظام التنبيهات للمشرفين فقط.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'dashboard': return this.handleDashboard(interaction);
      case 'history': return this.handleHistory(interaction);
      case 'stats': return this.handleStats(interaction);
      case 'acknowledge': return this.handleAcknowledge(interaction);
    }
  },

  async handleDashboard(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const dashboard = await AlertService.getDashboard();
      const state = AlertService.getState();

      const color = dashboard.openAlerts.length > 0
        ? (dashboard.openAlerts.some(a => a.priority === 'critical') ? 0xE74C3C : 0xF39C12)
        : 0x2ECC71;

      const embed = new EmbedBuilder()
        .setTitle('🚨 لوحة التنبيهات')
        .setColor(color)
        .addFields(
          { name: '🟢 مفتوح', value: dashboard.stats.open.toString(), inline: true },
          { name: '🟡 مؤكد', value: dashboard.stats.acknowledged.toString(), inline: true },
          { name: '✅ محلول', value: dashboard.stats.resolved.toString(), inline: true },
          { name: '📊 الإجمالي', value: dashboard.stats.total.toString(), inline: true },
          { name: '⏱️ وقت التشغيل', value: this._formatDuration(dashboard.stats.uptime), inline: true },
          { name: '🧊 Cooldowns نشطة', value: state.cooldownsActive.toString(), inline: true },
        );

      if (dashboard.topCategories.length > 0) {
        const priorityEmoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
        embed.addFields({
          name: '📂 الفئات الأكثر نشاطاً',
          value: dashboard.topCategories.map(c =>
            `${priorityEmoji[c.maxPriority] || '❓'} **${c._id}**: ${c.count} تنبيه`
          ).join('\n'),
          inline: false,
        });
      }

      if (dashboard.openAlerts.length > 0) {
        const priorityColor = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
        const alertsList = dashboard.openAlerts.slice(0, 10).map(a =>
          `${priorityColor[a.priority]} **${a.title}**\n` +
          `  🆔 \`${a.alertId.substring(0, 24)}...\` | 📂 ${a.category} | 🔄 ${a.occurrences}x`
        ).join('\n\n');

        embed.addFields({
          name: `⚠️ آخر التنبيهات المفتوحة (${dashboard.openAlerts.length})`,
          value: alertsList,
          inline: false,
        });
      } else {
        embed.addFields({ name: '✅ الوضع', value: 'لا توجد تنبيهات مفتوحة', inline: false });
      }

      embed.setFooter({ text: `آخر تحديث: ${new Date().toLocaleString('ar-SA')}` });
      embed.setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('alert_refresh')
          .setLabel('🔄 تحديث')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('alert_history')
          .setLabel('📋 السجل')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('alert_stats')
          .setLabel('📊 الإحصائيات')
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      logger.error('Alert dashboard error', { error: error.message });
      await interaction.editReply({ content: `❌ فشل تحميل لوحة التنبيهات: ${error.message}` });
    }
  },

  async handleHistory(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const type = interaction.options.getString('category');
      const history = await AlertService.getAlertHistory(type, 25);

      if (history.length === 0) {
        return interaction.editReply({ content: '📭 لا توجد تنبيهات مسجلة.' });
      }

      const priorityColor = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
      const statusEmoji = { open: '🟢', acknowledged: '🟡', resolved: '✅', ignored: '⚪' };

      const embed = new EmbedBuilder()
        .setTitle(`📋 سجل التنبيهات${type ? ` — ${type}` : ''}`)
        .setColor(0x5865F2)
        .setDescription(history.map((a, i) =>
          `${statusEmoji[a.status] || '❓'} ${priorityColor[a.priority] || '⚫'} **${a.title}**\n` +
          `  🆔 \`${a.alertId.substring(0, 20)}...\` | 📂 ${a.category} | 🔄 ${a.occurrences || 1}x\n` +
          `  🕐 ${new Date(a.createdAt).toLocaleString('ar-SA')}`
        ).join('\n\n'))
        .setFooter({ text: `إجمالي ${history.length} تنبيه` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ فشل تحميل السجل: ${error.message}` });
    }
  },

  async handleStats(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const stats = await AlertService.getStats();
      const priorityEmoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
      const categoryEmoji = {
        mongodb: '🗄️', discord: '💬', ai: '🤖', wallet: '👛', payment: '💳',
        withdrawal: '💰', memory: '🧠', cpu: '⚡', error_rate: '📈',
        fraud: '🚨', spam: '🚫', webhook: '🌐', system: '⚙️',
      };

      const embed = new EmbedBuilder()
        .setTitle('📊 إحصائيات التنبيهات')
        .setColor(0x3498DB)
        .addFields(
          { name: '📊 الإجمالي', value: stats.total.toString(), inline: true },
          { name: '🟢 مفتوحة', value: stats.open.toString(), inline: true },
          { name: '🟡 مؤكدة', value: stats.acknowledged.toString(), inline: true },
          { name: '✅ محلولة', value: stats.resolved.toString(), inline: true },
          { name: '⏱️ وقت التشغيل', value: this._formatDuration(stats.uptime), inline: true },
        );

      if (Object.keys(stats.byPriority).length > 0) {
        embed.addFields({
          name: '🏷️ حسب الأولوية',
          value: Object.entries(stats.byPriority)
            .sort(([, a], [, b]) => b - a)
            .map(([p, c]) => `${priorityEmoji[p] || '❓'} ${p}: ${c}`)
            .join('\n'),
          inline: true,
        });
      }

      if (Object.keys(stats.byCategory).length > 0) {
        embed.addFields({
          name: '📂 حسب الفئة',
          value: Object.entries(stats.byCategory)
            .sort(([, a], [, b]) => b.count - a.count)
            .slice(0, 10)
            .map(([cat, info]) => `${categoryEmoji[cat] || '📁'} ${cat}: ${info.count}`)
            .join('\n'),
          inline: true,
        });
      }

      embed.setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ فشل تحميل الإحصائيات: ${error.message}` });
    }
  },

  async handleAcknowledge(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const alertId = interaction.options.getString('alert_id');

    try {
      const alert = await AlertService.acknowledgeAlert(alertId, interaction.user.id);
      await interaction.editReply({ content: `✅ تم تأكيد استلام التنبيه \`${alertId}\`` });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${error.message}` });
    }
  },

  async handleButton(interaction, client, action) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 للمشرفين فقط.', ephemeral: true });
    }

    if (action === 'alert_refresh') return this.handleDashboard(interaction);
    if (action === 'alert_history') return this.handleHistory(interaction);
    if (action === 'alert_stats') return this.handleStats(interaction);
  },

  _formatDuration(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}يوم`);
    if (h > 0) parts.push(`${h}س`);
    if (m > 0) parts.push(`${m}د`);
    parts.push(`${Math.floor(seconds % 60)}ث`);
    return parts.join(' ');
  },
};
