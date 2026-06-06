const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { PanelManager, NAV } = require('../../utils/PanelManager');
const config = require('../../config');
const { logger } = require('../../utils/logger');
const MonitorService = require('../../services/MonitorService');
const AIService = require('../../services/AIService');
const rateLimiter = require('../../cache/RateLimiter');
const os = require('os');
const mongoose = require('mongoose');

const COLORS = {
  system: 0x3498DB, logs: 0x2ECC71, metrics: 0x9B59B6, ai: 0xF1C40F,
  db: 0xE67E22, errors: 0xE74C3C, performance: 0x1ABC9C, settings: 0x95A5A6,
};
const OWNER_ID = process.env.OWNER_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('👑 لوحة تحكم المالك'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    if (!OWNER_ID) {
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('⚠️ غير مفعل', 'OWNER_ID غير محدد في متغيرات البيئة. هذا الأمر معطل.', config.colors.warning)] });
    }
    if (interaction.user.id !== OWNER_ID) {
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('🚫 غير مصرح', 'هذا الأمر لمالك البوت فقط.', config.colors.error)] });
    }
    try {
      await rateLimiter.consume(`owner:${interaction.user.id}`, 1, 'owner');
    } catch {
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('⏳ تم تجاوز الحد', 'يرجى الانتظار قبل استخدام أوامر المالك مرة أخرى.', config.colors.warning)] });
    }
    return this.showHome(interaction);
  },

  async showHome(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('👑 لوحة تحكم المالك')
      .setDescription('إدارة شاملة للبوت.')
      .setColor(config.colors.gold)
      .addFields(
        { name: '🔧 System', value: 'حالة النظام', inline: true },
        { name: '📂 Logs', value: 'سجلات البوت', inline: true },
        { name: '📊 Metrics', value: 'المقاييس', inline: true },
        { name: '🤖 AI Status', value: 'حالة الذكاء الاصطناعي', inline: true },
        { name: '💾 Database', value: 'حالة قاعدة البيانات', inline: true },
        { name: '🚨 Errors', value: 'الأخطاء', inline: true },
        { name: '⚡ Performance', value: 'الأداء', inline: true },
        { name: '👑 Settings', value: 'الإعدادات', inline: true },
      )
      .setFooter({ text: 'لوحة المالك' })
      .setTimestamp();
    const row1 = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('owner_system', '🔧 System', '🔧'),
      PanelManager.panelButton('owner_logs', '📂 Logs', '📂'),
      PanelManager.panelButton('owner_metrics', '📊 Metrics', '📊'),
      PanelManager.panelButton('owner_ai', '🤖 AI', '🤖'),
      PanelManager.panelButton('owner_database', '💾 DB', '💾'),
    );
    const row2 = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('owner_errors', '🚨 Errors', '🚨'),
      PanelManager.panelButton('owner_performance', '⚡ Performance', '⚡'),
      PanelManager.panelButton('owner_settings', '👑 Settings', '👑'),
      NAV.close('owner'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row1, row2] });
  },

  async handleButton(interaction, client, action) {
    await PanelManager.defer(interaction);
    if (!OWNER_ID || interaction.user.id !== OWNER_ID) {
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('🚫 غير مصرح', '', config.colors.error)] });
    }
    switch (action) {
      case 'home': return this.showHome(interaction);
      case 'close': return interaction.deleteReply().catch(() => {});
      case 'refresh': return this.showHome(interaction);
      case 'system': return this.showSystem(interaction);
      case 'logs': return this.showLogs(interaction);
      case 'metrics': return this.showMetrics(interaction);
      case 'ai': return this.showAI(interaction);
      case 'database': return this.showDatabase(interaction);
      case 'errors': return this.showErrors(interaction);
      case 'performance': return this.showPerformance(interaction);
      case 'settings': return this.showOwnerSettings(interaction);
      default: return this.showHome(interaction);
    }
  },

  async showSystem(interaction) {
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    const embed = PanelManager.embed('🔧 System Status', 'معلومات النظام.', COLORS.system, {
      fields: [
        { name: '⏳ وقت التشغيل', value: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h`, inline: true },
        { name: '💾 RSS', value: `${Math.round(mem.rss / 1024 / 1024)} MB`, inline: true },
        { name: '💿 Heap', value: `${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)} MB`, inline: true },
        { name: '🖥️ OS', value: `${os.platform()} ${os.release()}`, inline: true },
        { name: '🧠 CPU', value: `${os.cpus()[0]?.model?.trim() || 'N/A'}`, inline: true },
        { name: '📡 Node', value: process.version, inline: true },
      ],
    });
    const row = PanelManager.navRow('owner');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showLogs(interaction) {
    const embed = PanelManager.embed('📂 Logs', 'السجلات متوفرة في وحدة التحكم.', COLORS.logs);
    const row = PanelManager.navRow('owner');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showMetrics(interaction) {
    const snapshot = MonitorService.getSnapshot();
    const embed = PanelManager.embed('📊 Metrics', 'مقاييس البوت.', COLORS.metrics, {
      fields: [
        { name: '📊 الأوامر', value: `${snapshot.commands?.executions || 0} (${snapshot.commands?.total || 0} أمر)`, inline: true },
        { name: '❌ أخطاء أوامر', value: `${snapshot.commands?.errors || 0}`, inline: true },
        { name: '💬 التفاعلات', value: `${snapshot.interactions?.total || 0}`, inline: true },
        { name: '🤖 AI طلبات', value: `${snapshot.ai?.requests || 0}`, inline: true },
        { name: '🗄️ MongoDB', value: `${snapshot.mongo?.ops || 0} عملية`, inline: true },
        { name: '🚨 أخطاء', value: `${snapshot.errors?.total || 0}`, inline: true },
      ],
    });
    const row = PanelManager.navRow('owner');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showAI(interaction) {
    const stats = AIService.getUsageStats ? AIService.getUsageStats() : {};
    const embed = PanelManager.embed('🤖 AI Status', 'حالة الذكاء الاصطناعي.', COLORS.ai, {
      fields: [
        { name: '📈 الطلبات', value: (stats.totalRequests || 0).toString(), inline: true },
        { name: '🔤 الرموز', value: (stats.totalTokens || 0).toString(), inline: true },
        { name: '❌ الأخطاء', value: (stats.totalErrors || 0).toString(), inline: true },
        { name: '⚡ متوسط الوقت', value: stats.avgResponseTime ? `${stats.avgResponseTime}ms` : 'N/A', inline: true },
        { name: '💾 الكاش', value: (stats.responseCacheSize || 0).toString(), inline: true },
        { name: '🔒 Rate Limit', value: (stats.rateLimiterSize || 0).toString(), inline: true },
      ],
    });
    const row = PanelManager.navRow('owner');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showDatabase(interaction) {
    const dbState = ['منفصلة', 'موصولة', 'جارٍ الاتصال', 'جارٍ الفصل'];
    const state = mongoose.connection.readyState;
    const embed = PanelManager.embed('💾 Database', 'حالة قاعدة البيانات.', COLORS.db, {
      fields: [
        { name: '📡 الحالة', value: dbState[state] || 'غير معروفة', inline: true },
        { name: '📦 قاعدة البيانات', value: mongoose.connection.db?.databaseName || 'N/A', inline: true },
        { name: '🔗 المضيف', value: mongoose.connection.host || 'N/A', inline: true },
      ],
    });
    const row = PanelManager.navRow('owner');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showErrors(interaction) {
    const errors = MonitorService.getErrorReport(20);
    const embed = PanelManager.embed('🚨 Errors', errors.length > 0 ? errors.map((e, i) => `**${i + 1}.** ${e.context}\n\`${e.message?.substring(0, 100)}\``).join('\n') : '✅ لا توجد أخطاء.', COLORS.errors);
    const row = PanelManager.navRow('owner');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showPerformance(interaction) {
    const perf = MonitorService.getPerformanceReport();
    const mem = MonitorService.getMemoryTrend();
    const embed = PanelManager.embed('⚡ Performance', 'أداء البوت.', COLORS.performance, {
      fields: [
        { name: '⚡ متوسط الاستجابة', value: perf.avg ? `${perf.avg}ms` : 'N/A', inline: true },
        { name: '📊 P50', value: perf.p50 ? `${perf.p50}ms` : 'N/A', inline: true },
        { name: '📊 P95', value: perf.p95 ? `${perf.p95}ms` : 'N/A', inline: true },
        { name: '📊 P99', value: perf.p99 ? `${perf.p99}ms` : 'N/A', inline: true },
        { name: '📈 الذاكرة', value: `${mem.currentHeap || 'N/A'} MB`, inline: true },
        { name: '📉 الاتجاه', value: mem.trend || 'N/A', inline: true },
      ],
    });
    const row = PanelManager.navRow('owner');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showOwnerSettings(interaction) {
    const embed = PanelManager.embed('👑 Owner Settings', 'إعدادات المالك.', COLORS.settings, {
      fields: [
        { name: '👤 المالك', value: `<@${OWNER_ID}>`, inline: true },
        { name: '🤖 البوت', value: config.discord?.clientId || 'N/A', inline: true },
        { name: '🏠 السيرفر', value: interaction.guild?.name || 'N/A', inline: true },
      ],
    });
    const row = PanelManager.navRow('owner');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },
};
