const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const MonitorService = require('../../services/MonitorService');
const { EmbedBuilderUtil } = require('../../utils/embeds');
const { logger } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('monitor')
    .setDescription('📊 لوحة مراقبة الأداء (للمشرفين)')
    .addSubcommand(sub =>
      sub.setName('overview')
        .setDescription('نظرة عامة على أداء البوت')
    )
    .addSubcommand(sub =>
      sub.setName('commands')
        .setDescription('إحصائيات الأوامر')
        .addStringOption(opt => opt.setName('command').setDescription('اسم الأمر للتفاصيل'))
    )
    .addSubcommand(sub =>
      sub.setName('errors')
        .setDescription('آخر الأخطاء المسجلة')
    )
    .addSubcommand(sub =>
      sub.setName('performance')
        .setDescription('تقرير الأداء والاستجابة')
    )
    .addSubcommand(sub =>
      sub.setName('memory')
        .setDescription('مراقبة استهلاك الذاكرة')
    )
    .addSubcommand(sub =>
      sub.setName('report')
        .setDescription('إنشاء تقرير يومي')
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.editReply({ content: '🚫 لوحة المراقبة للمشرفين فقط.' });
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'overview':
        return this.handleOverview(interaction);
      case 'commands':
        return this.handleCommands(interaction);
      case 'errors':
        return this.handleErrors(interaction);
      case 'performance':
        return this.handlePerformance(interaction);
      case 'memory':
        return this.handleMemory(interaction);
      case 'report':
        return this.handleReport(interaction);
    }
  },

  async handleOverview(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const snapshot = MonitorService.getSnapshot();
    const perf = MonitorService.getPerformanceReport();

    const embed = new EmbedBuilder()
      .setTitle('📊 لوحة مراقبة الأداء')
      .setColor(0x5865F2)
      .addFields(
        { name: '⏱️ وقت التشغيل', value: this.formatDuration(snapshot.uptime), inline: true },
        { name: '📋 الأوامر المنفذة', value: snapshot.commands.executions.toLocaleString(), inline: true },
        { name: '❌ الأخطاء', value: `${snapshot.errors.total} (${snapshot.commands.errors} في الأوامر)`, inline: true },
        { name: '🖥️ الذاكرة (RSS)', value: snapshot.memory.rss, inline: true },
        { name: '🧠 Heap المستخدم', value: snapshot.memory.heapUsed, inline: true },
        { name: '💾 Heap الإجمالي', value: snapshot.memory.heapTotal, inline: true },
        { name: '🔄 التفاعلات', value: snapshot.interactions.total.toLocaleString(), inline: true },
        { name: '🤖 طلبات AI', value: snapshot.ai.requests.toLocaleString(), inline: true },
        { name: '🎯 متوسط وقت الاستجابة', value: `${perf.avg}ms`, inline: true },
        { name: '⚡ P50/P95/P99', value: `${perf.p50}ms / ${perf.p95}ms / ${perf.p99}ms`, inline: true },
        { name: '🗄️ MongoDB', value: snapshot.mongo.state === 'connected' ? '✅ متصل' : '❌ غير متصل', inline: true },
        { name: '💻 CPU (1m/5m/15m)', value: `${snapshot.cpu.load1m} / ${snapshot.cpu.load5m} / ${snapshot.cpu.load15m}`, inline: true },
        { name: '🧠 AI Cache', value: `${snapshot.ai.cacheSize} مدخلات`, inline: true },
        { name: '👤 AI Memory', value: `${snapshot.ai.memoryUsers} مستخدم`, inline: true },
        { name: '🚫 محظورو AI', value: `${snapshot.ai.blockedUsers || 0} مستخدم`, inline: true },
        { name: '🔄 AI Rate Limiter', value: `${snapshot.ai.rateLimiterSize} مفاتيح`, inline: true },
        { name: '🚨 تنبيهات احتيال', value: snapshot.fraud.total.toString(), inline: true },
        { name: '🔴 احتيال', value: (snapshot.fraud.fraud || 0).toString(), inline: true },
        { name: '🟠 خطورة عالية', value: (snapshot.fraud.high_risk || 0).toString(), inline: true },
      )
      .setFooter({ text: `تم التحديث: ${new Date().toLocaleString('ar-SA')}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('monitor_refresh')
        .setLabel('🔄 تحديث')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('monitor_commands')
        .setLabel('📋 الأوامر')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('monitor_memory')
        .setLabel('🧠 الذاكرة')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  },

  async handleCommands(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cmdName = interaction.options.getString('command');
    const snapshot = MonitorService.getSnapshot();

    if (cmdName) {
      const stats = MonitorService.getCommandStats(cmdName.toLowerCase());
      if (!stats) {
        return interaction.editReply({ content: `❌ الأمر \`${cmdName}\` غير موجود أو لم يتم استخدامه بعد.` });
      }

      const embed = new EmbedBuilder()
        .setTitle(`📋 إحصائيات الأمر: /${stats.name}`)
        .setColor(0x2ECC71)
        .addFields(
          { name: '🔄 عدد الاستخدامات', value: stats.uses.toLocaleString(), inline: true },
          { name: '❌ الأخطاء', value: stats.errors.toString(), inline: true },
          { name: '📊 نسبة الخطأ', value: stats.errorRate, inline: true },
          { name: '⏱️ متوسط وقت الاستجابة', value: `${stats.avgTime}ms`, inline: true },
          { name: '👤 المستخدمين الفريدين', value: stats.uniqueUsers.toLocaleString(), inline: true },
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    const top = snapshot.commands.top;
    if (top.length === 0) {
      return interaction.editReply({ content: '📭 لا توجد إحصائيات أوامر بعد.' });
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 إحصائيات الأوامر')
      .setColor(0x3498DB)
      .setDescription(top.map((c, i) =>
        `${i + 1}. **/${c.name}** — ${c.uses.toLocaleString()} استخدامات | ${c.avgTime}ms | ${c.errors} خطأ | ${c.uniqueUsers} مستخدم`
      ).join('\n'))
      .setFooter({ text: `إجمالي: ${snapshot.commands.total} أمر | ${snapshot.commands.executions.toLocaleString()} تنفيذ` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },

  async handleErrors(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const errors = MonitorService.getErrorReport(25);
    if (errors.length === 0) {
      return interaction.editReply({ content: '✅ لا توجد أخطاء مسجلة.' });
    }

    const pages = [];
    for (let i = 0; i < errors.length; i += 5) {
      pages.push(errors.slice(i, i + 5));
    }

    const embed = new EmbedBuilder()
      .setTitle(`❌ آخر الأخطاء (${errors.length})`)
      .setColor(0xE74C3C)
      .setDescription(pages[0].map(e =>
        `**${e.name}** — ${e.context}\n\`${e.message.substring(0, 200)}\`\n🕐 ${new Date(e.time).toLocaleString('ar-SA')}`
      ).join('\n\n'))
      .setFooter({ text: `صفحة 1/${pages.length}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },

  async handlePerformance(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const perf = MonitorService.getPerformanceReport();
    const snapshot = MonitorService.getSnapshot();

    if (perf.count === 0) {
      return interaction.editReply({ content: '📭 لا توجد بيانات أداء كافية بعد.' });
    }

    const embed = new EmbedBuilder()
      .setTitle('⚡ تقرير الأداء')
      .setColor(0xF39C12)
      .addFields(
        { name: '📊 عدد العينات', value: perf.count.toLocaleString(), inline: true },
        { name: '📈 متوسط وقت الاستجابة', value: `${perf.avg}ms`, inline: true },
        { name: '🎯 P50 (الوسيط)', value: `${perf.p50}ms`, inline: true },
        { name: '🔴 P95', value: `${perf.p95}ms`, inline: true },
        { name: '🔴 P99', value: `${perf.p99}ms`, inline: true },
        { name: '🚀 أقصى وقت', value: `${perf.max}ms`, inline: true },
        { name: '🤖 متوسط AI', value: snapshot.ai.avgResponseTime, inline: true },
        { name: '🔄 التفاعلات', value: snapshot.interactions.total.toLocaleString(), inline: true },
        { name: '💾 MongoDB عمليات', value: snapshot.mongo.ops.toLocaleString(), inline: true },
      )
      .setDescription(
        '**توزيع أوقات الاستجابة:**\n' +
        `• 🟢 < 100ms: سريع جداً\n` +
        `• 🟡 100-500ms: طبيعي\n` +
        `• 🟠 500-2000ms: بطيء\n` +
        `• 🔴 > 2000ms: يحتاج تحسين`
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },

  async handleMemory(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const snapshot = MonitorService.getSnapshot();
    const trend = MonitorService.getMemoryTrend();

    const embed = new EmbedBuilder()
      .setTitle('🧠 مراقبة الذاكرة')
      .setColor(0x9B59B6)
      .addFields(
        { name: '📊 RSS', value: snapshot.memory.rss, inline: true },
        { name: '🧠 Heap المستخدم', value: snapshot.memory.heapUsed, inline: true },
        { name: '💾 Heap الإجمالي', value: snapshot.memory.heapTotal, inline: true },
        { name: '🔌 External', value: snapshot.memory.external, inline: true },
        { name: '🖥️ ذاكرة النظام', value: `${snapshot.os.freeMemory} / ${snapshot.os.totalMemory}`, inline: true },
        { name: '📈 الاتجاه', value: trend.trend === 'stable' ? '✅ مستقر' : `⚠️ ${trend.growth24h}`, inline: true },
        { name: '📋 عدد العينات', value: trend.samples.toString(), inline: true },
        { name: '💻 CPU Cores', value: snapshot.cpu.cores.toString(), inline: true },
        { name: '⚡ CPU Load (1m)', value: snapshot.cpu.load1m, inline: true },
      )
      .setFooter({ text: `آخر 5 عينات: ${trend.latest.map(s => `${s.heap}MB`).join(' → ')}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },

  async handleReport(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const MonitorService = require('../../services/MonitorService');
    const report = MonitorService._generateDailyReport();
    if (!report) {
      return interaction.editReply({ content: '❌ فشل إنشاء التقرير.' });
    }

    const embed = new EmbedBuilder()
      .setTitle('📊 التقرير اليومي')
      .setColor(0x5865F2)
      .addFields(
        { name: '⏱️ وقت التشغيل', value: this.formatDuration(report.uptime), inline: true },
        { name: '📋 الأوامر', value: `${report.commands.executions} (${report.commands.total} أمر)`, inline: true },
        { name: '❌ أخطاء الأوامر', value: report.commands.errors.toString(), inline: true },
        { name: '🔁 التفاعلات', value: report.interactions.total.toLocaleString(), inline: true },
        { name: '🤖 طلبات AI', value: report.ai.requests.toLocaleString(), inline: true },
        { name: '🪙 توكنز AI', value: report.ai.tokens.toLocaleString(), inline: true },
        { name: '🧠 متوسط وقت AI', value: `${report.ai.avgResponseTime}ms`, inline: true },
        { name: '🖥️ RSS/Heap', value: `${report.memory.rss}MB / ${report.memory.heapUsed}MB`, inline: true },
        { name: '🗄️ MongoDB', value: report.mongo.state === 'connected' ? '✅ متصل' : '❌ غير متصل', inline: true },
      )
      .setTimestamp();

    if (report.commands.top.length > 0) {
      embed.addFields({
        name: '🏆 أفضل 5 أوامر',
        value: report.commands.top.slice(0, 5).map((c, i) => `${i + 1}. **${c.name}** — ${c.uses} استخدام | ${c.avgTime}ms | ${c.uniqueUsers} مستخدم`).join('\n'),
        inline: false,
      });
    }

    if (report.errors.recent.length > 0) {
      embed.addFields({
        name: '⚠️ آخر الأخطاء',
        value: report.errors.recent.slice(0, 5).map(e => `• **${e.name}** — ${e.context}: \`${e.message.substring(0, 100)}\``).join('\n'),
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },

  handleButton(interaction, client, action) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 للمشرفين فقط.', ephemeral: true });
    }

    if (action === 'monitor_refresh') return this.handleOverview(interaction);
    if (action === 'monitor_commands') return this.handleCommands(interaction);
    if (action === 'monitor_memory') return this.handleMemory(interaction);
  },

  formatDuration(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}يوم`);
    if (h > 0) parts.push(`${h}س`);
    if (m > 0) parts.push(`${m}د`);
    parts.push(`${s}ث`);
    return parts.join(' ');
  },
};
