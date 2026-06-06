const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { PanelManager, NAV } = require('../../utils/PanelManager');
const AuditService = require('../../services/AuditService');
const config = require('../../config');
const { formatCurrency, formatNumber } = require('../../utils/helpers');
const { User, Store, Payment, Withdrawal, Order, Transaction, Review, FraudAlert } = require('../../database/models');
const PaymentService = require('../../services/PaymentService');
const BalanceService = require('../../services/BalanceService');
const MonitorService = require('../../services/MonitorService');
const fraudDetection = require('../../services/FraudDetectionService');
const rateLimiter = require('../../cache/RateLimiter');

const COLORS = {
  dashboard: 0x3498DB, payments: 0x2ECC71, withdrawals: 0x9B59B6,
  coupons: 0xF1C40F, marketplace: 0xE67E22, trust: 0x1ABC9C,
  monitor: 0x95A5A6, settings: 0xE74C3C, fraud: 0xE74C3C,
};

const SECTION_ICONS = { dashboard: '📊', payments: '💸', withdrawals: '🏦', coupons: '🎟', marketplace: '🛒', trust: '🛡', monitor: '📈', settings: '⚙', fraud: '🚨' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('🔧 لوحة تحكم المشرفين'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.memberPermissions?.has('Administrator')) {
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('🚫 غير مصرح', 'هذا الأمر للمشرفين فقط.', config.colors.error)] });
    }
    try {
      await rateLimiter.consume(`admin:${interaction.user.id}`, 1, 'admin');
    } catch {
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('⏳ تم تجاوز الحد', 'يرجى الانتظار قبل استخدام أوامر المشرفين مرة أخرى.', config.colors.warning)] });
    }
    return this.showHome(interaction);
  },

  async showHome(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🔧 لوحة تحكم المشرفين')
      .setDescription('نظام إدارة شامل للماركت بليس.')
      .setColor(config.colors.primary)
      .addFields(
        { name: '📊 Dashboard', value: 'نظرة عامة على الإحصائيات', inline: true },
        { name: '💸 Payments', value: 'إدارة المدفوعات', inline: true },
        { name: '🏦 Withdrawals', value: 'إدارة السحوبات', inline: true },
        { name: '🎟 Coupons', value: 'الكوبونات والخصومات', inline: true },
        { name: '🛒 Marketplace', value: 'إعدادات السوق', inline: true },
        { name: '🛡 Trust', value: 'نظام الثقة والسمعة', inline: true },
        { name: '📈 Monitor', value: 'مراقبة الأداء', inline: true },
        { name: '🚨 Fraud', value: 'كشف الاحتيال والأمان', inline: true },
        { name: '⚙ Settings', value: 'إعدادات المنصة', inline: true },
      )
      .setFooter({ text: 'لوحة المشرفين' })
      .setTimestamp();
    const row1 = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('admin_dashboard', '📊 Dashboard', '📊'),
      PanelManager.panelButton('admin_payments', '💸 Payments', '💸'),
      PanelManager.panelButton('admin_withdrawals', '🏦 Withdrawals', '🏦'),
      PanelManager.panelButton('admin_coupons', '🎟 Coupons', '🎟'),
      PanelManager.panelButton('admin_marketplace', '🛒 Marketplace', '🛒'),
    );
    const row1b = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('admin_fraud', '🚨 Fraud', '🚨'),
      PanelManager.panelButton('admin_trust', '🛡 Trust', '🛡'),
      PanelManager.panelButton('admin_monitor', '📈 Monitor', '📈'),
      PanelManager.panelButton('admin_settings', '⚙ Settings', '⚙'),
      NAV.close('admin'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row1, row1b] });
  },

  async handleButton(interaction, client, action) {
    await PanelManager.defer(interaction);
    if (!interaction.memberPermissions?.has('Administrator')) {
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('🚫 غير مصرح', '', config.colors.error)] });
    }
    try {
      await rateLimiter.consume(`admin:${interaction.user.id}`, 1, 'admin');
    } catch {
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('⏳ تم تجاوز الحد', 'يرجى الانتظار.', config.colors.warning)] });
    }
    switch (action) {
      case 'home': return this.showHome(interaction);
      case 'close': return interaction.deleteReply().catch(() => {});
      case 'refresh': return this.showHome(interaction);
      case 'dashboard': return this.showDashboard(interaction);
      case 'payments': return this.showPayments(interaction);
      case 'withdrawals': return this.showWithdrawals(interaction);
      case 'coupons': return this.showCoupons(interaction);
      case 'marketplace': return this.showMarketplace(interaction);
      case 'trust': return this.showTrust(interaction);
      case 'monitor': return this.showMonitor(interaction);
      case 'settings': return this.showSettings(interaction);
      case 'fraud': return this.showFraud(interaction);
      default: {
        if (action.startsWith('payment_')) return this.handlePaymentAction(interaction, client, action);
        if (action.startsWith('withdraw_')) return this.handleWithdrawAction(interaction, client, action);
        if (action.startsWith('fraud_')) return this.handleFraudAction(interaction, client, action);
        return this.showHome(interaction);
      }
    }
  },

  async showDashboard(interaction) {
    const [totalUsers, totalStores, totalOrders, completedOrders, pendingPayments, pendingWithdrawals, totalCommission, monitorSnapshot, fraudUnresolved] = await Promise.all([
      User.countDocuments(),
      Store.countDocuments({ isActive: true }),
      Order.countDocuments(),
      Order.countDocuments({ status: 'completed' }),
      Payment.countDocuments({ status: 'awaiting_verification' }),
      Withdrawal.countDocuments({ status: 'pending' }),
      Transaction.aggregate([{ $match: { type: 'commission' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      MonitorService.getSnapshot().catch(() => ({})),
      FraudAlert.countDocuments({ resolved: false }),
    ]);
    const fraudStats = MonitorService.getFraudStats();
    const embed = PanelManager.embed('📊 Dashboard — نظرة عامة', 'إحصائيات المنصة.', COLORS.dashboard, {
      fields: [
        { name: '👥 المستخدمون', value: formatNumber(totalUsers), inline: true },
        { name: '🏪 المتاجر', value: formatNumber(totalStores), inline: true },
        { name: '📦 الطلبات', value: `${completedOrders}/${totalOrders}`, inline: true },
        { name: '💸 العمولات', value: formatCurrency(totalCommission[0]?.total || 0), inline: true },
        { name: '⏳ مدفوعات معلقة', value: pendingPayments.toString(), inline: true },
        { name: '🏦 سحوبات معلقة', value: pendingWithdrawals.toString(), inline: true },
        { name: '🚨 إنذارات احتيال', value: `${fraudUnresolved} غير محلولة / ${fraudStats.total || 0} إجمالي`, inline: true },
        { name: '⚡ وقت التشغيل', value: monitorSnapshot.uptime ? `${Math.floor(monitorSnapshot.uptime / 3600)}h` : 'N/A', inline: true },
        { name: '💾 الذاكرة', value: monitorSnapshot.memory?.heapUsed || 'N/A', inline: true },
      ],
    });
    const row = PanelManager.navRow('admin');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showPayments(interaction) {
    const payments = await PaymentService.getPendingVerification();
    const stats = await PaymentService.getPaymentStats();
    const embed = PanelManager.embed('💸 Payments — المدفوعات', `إجمالي: ${stats.total} | مكتملة: ${stats.byStatus?.completed || 0}`, COLORS.payments, {
      fields: [
        { name: '💰 الإيرادات', value: formatCurrency(stats.revenue), inline: true },
        { name: '💸 العمولات', value: formatCurrency(stats.commissions), inline: true },
        { name: '⏳ بانتظار التأكيد', value: payments.length.toString(), inline: true },
      ],
    });
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('admin_payment_pending', '⏳ المعلقة', '⏳'),
      PanelManager.panelButton('admin_payment_all', '📋 الكل', '📋'),
      NAV.back('admin'), NAV.home('admin'), NAV.close('admin'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showWithdrawals(interaction) {
    const stats = await BalanceService.getWithdrawalStats().catch(() => ({ total: 0, pending: 0 }));
    const embed = PanelManager.embed('🏦 Withdrawals — السحوبات', `إجمالي: ${stats.total} | معلقة: ${stats.pending}`, COLORS.withdrawals);
    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('admin_withdraw_pending', '⏳ المعلقة', '⏳'),
      PanelManager.panelButton('admin_withdraw_all', '📋 الكل', '📋'),
      NAV.back('admin'), NAV.home('admin'), NAV.close('admin'),
    );
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showCoupons(interaction) {
    const embed = PanelManager.embed('🎟 Coupons — الكوبونات', 'إدارة الكوبونات والخصومات.\nمن لوحة المدير → قسم الكوبونات.', COLORS.coupons);
    const row = PanelManager.navRow('admin');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showMarketplace(interaction) {
    const embed = PanelManager.embed('🛒 Marketplace — السوق', 'إعدادات السوق.\nمن لوحة المدير → قسم السوق.', COLORS.marketplace);
    const row = PanelManager.navRow('admin');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showTrust(interaction) {
    const embed = PanelManager.embed('🛡 Trust — الثقة', 'نظام الثقة والسمعة.\nمن لوحة المدير → قسم الثقة.', COLORS.trust);
    const row = PanelManager.navRow('admin');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showMonitor(interaction) {
    const snapshot = MonitorService.getSnapshot();
    const embed = PanelManager.embed('📈 Monitor — المراقبة', 'أداء البوت.', COLORS.monitor, {
      fields: [
        { name: '⏳ وقت التشغيل', value: snapshot.uptime ? `${Math.floor(snapshot.uptime / 3600)}h` : 'N/A', inline: true },
        { name: '📊 الأوامر', value: `${snapshot.commands?.executions || 0}`, inline: true },
        { name: '❌ الأخطاء', value: `${snapshot.errors?.total || 0}`, inline: true },
        { name: '💾 RAM', value: snapshot.memory?.heapUsed || 'N/A', inline: true },
        { name: '🗄️ MongoDB', value: snapshot.mongo?.state || 'N/A', inline: true },
        { name: '🤖 AI', value: `${snapshot.ai?.requests || 0} طلب`, inline: true },
      ],
    });
    const row = PanelManager.navRow('admin');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showSettings(interaction) {
    const embed = PanelManager.embed('⚙ Settings — الإعدادات', 'إعدادات المنصة.\nمن لوحة المدير → قسم الإعدادات.', COLORS.settings);
    const row = PanelManager.navRow('admin');
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showFraud(interaction) {
    const { alerts, total } = await fraudDetection.getAllAlerts({}, 1, 10);
    const unresolved = await FraudAlert.countDocuments({ resolved: false });
    const severityCounts = await FraudAlert.aggregate([
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]);
    const bySeverity = {};
    for (const s of severityCounts) bySeverity[s._id] = s.count;

    const fraudStats = MonitorService.getFraudStats();
    const topTypes = await fraudDetection.getTopFraudTypes(5);
    const topUsers = await fraudDetection.getTopRiskUsers(5);

    const topTypesStr = topTypes.length > 0
      ? topTypes.map((t, i) => `${i + 1}. **${t._id}** — ${t.count} مرة (متوسط ${Math.round(t.avgRisk)})`).join('\n')
      : 'لا توجد بيانات بعد';
    const topUsersStr = topUsers.length > 0
      ? topUsers.map((u, i) => `${i + 1}. <@${u._id}> — ${u.alertCount} إنذار — أقصى ${u.maxRisk} — غير محلول: ${u.unresolved}`).join('\n')
      : 'لا توجد بيانات بعد';

    const embed = PanelManager.embed('🚨 Fraud — كشف الاحتيال', `إجمالي التنبيهات: ${total} | غير محلولة: ${unresolved}`, COLORS.fraud, {
      fields: [
        { name: '🟢 إنذار', value: (bySeverity.warning || 0).toString(), inline: true },
        { name: '🟡 مشبوه', value: (bySeverity.suspicious || 0).toString(), inline: true },
        { name: '🟠 خطورة عالية', value: (bySeverity.high_risk || 0).toString(), inline: true },
        { name: '🔴 احتيال', value: (bySeverity.fraud || 0).toString(), inline: true },
        { name: '📊 إجمالي الرصد', value: (fraudStats.total || 0).toString(), inline: true },
        { name: '🏆 أكثر 5 أنواع', value: topTypesStr, inline: false },
        { name: '👤 أخطر المستخدمين', value: topUsersStr, inline: false },
      ],
    });

    const rows = [];
    if (alerts.length > 0) {
      const desc = alerts.map((a, i) =>
        `${i + 1}. **${a.type}** — درجة: ${a.riskScore} — <@${a.userId}>\n` +
        `   ${a.description.substring(0, 80)}${a.resolved ? ' ✅' : ' ⏳'}`
      ).join('\n');
      embed.setDescription(desc);
    }

    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('admin_fraud_unresolved', '⏳ غير محلولة', '⏳'),
      PanelManager.panelButton('admin_fraud_all', '📋 الكل', '📋'),
      PanelManager.panelButton('admin_fraud_high', '🔴 عالية الخطورة', '🔴'),
      NAV.back('admin'), NAV.home('admin'), NAV.close('admin'),
    );
    rows.push(row);

    if (alerts.length > 0) {
      const detailRow = new ActionRowBuilder().addComponents(
        ...alerts.slice(0, 5).map((a, i) =>
          new ButtonBuilder()
            .setCustomId(`admin_fraud_detail_${a.alertId}`)
            .setLabel(`#${i + 1}`)
            .setStyle(ButtonStyle.Secondary)
        ),
      );
      rows.push(detailRow);
    }

    return PanelManager.update(interaction, { embeds: [embed], components: rows });
  },

  async handleFraudAction(interaction, client, action) {
    if (action === 'fraud_unresolved') {
      const { alerts } = await fraudDetection.getAllAlerts({ resolved: false }, 1, 10);
      const embed = PanelManager.embed('⏳ تنبيهات غير محلولة', alerts.length > 0
        ? alerts.map((a, i) => `${i + 1}. **${a.type}** — ${a.riskScore}/100 — <@${a.userId}> — ${a.description.substring(0, 60)}`).join('\n')
        : '✅ لا توجد.', COLORS.fraud);
      const row = PanelManager.navRow('admin');
      return PanelManager.update(interaction, { embeds: [embed], components: [row] });
    }

    if (action === 'fraud_all') {
      const { alerts } = await fraudDetection.getAllAlerts({}, 1, 10);
      const embed = PanelManager.embed('📋 كل التنبيهات', alerts.length > 0
        ? alerts.map((a, i) => `${i + 1}. **${a.type}** — ${a.riskScore}/100 — <@${a.userId}> — ${a.resolved ? '✅' : '⏳'}`).join('\n')
        : '✅ لا توجد.', COLORS.fraud);
      const row = PanelManager.navRow('admin');
      return PanelManager.update(interaction, { embeds: [embed], components: [row] });
    }

    if (action === 'fraud_high') {
      const { alerts } = await fraudDetection.getAllAlerts({ riskScore: { $gte: 80 } }, 1, 10);
      const embed = PanelManager.embed('🔴 عالية الخطورة', alerts.length > 0
        ? alerts.map((a, i) => `${i + 1}. **${a.type}** — ${a.riskScore}/100 — <@${a.userId}> — ${a.resolved ? '✅' : '⏳'}`).join('\n')
        : '✅ لا توجد.', COLORS.fraud);
      const row = PanelManager.navRow('admin');
      return PanelManager.update(interaction, { embeds: [embed], components: [row] });
    }

    if (action.startsWith('fraud_detail_')) {
      const alertId = action.replace('fraud_detail_', '');
      const alert = await fraudDetection.getAlertById(alertId);
      if (!alert) return PanelManager.update(interaction, { embeds: [PanelManager.embed('❌ غير موجود', '', COLORS.error)] });

      const embed = PanelManager.embed(`🚨 تنبيه: ${alert.type}`, alert.description, alert.riskScore >= 80 ? COLORS.fraud : COLORS.warning, {
        fields: [
          { name: 'المستخدم', value: `<@${alert.userId}>`, inline: true },
          { name: 'درجة الخطورة', value: `${alert.riskScore}/100`, inline: true },
          { name: 'المستوى', value: alert.severity, inline: true },
          { name: 'النوع', value: alert.type, inline: true },
          { name: 'محلول؟', value: alert.resolved ? `✅ نعم (${alert.resolution || 'N/A'})` : '⏳ لا', inline: true },
          { name: 'تاريخ الإنشاء', value: `<t:${Math.floor(new Date(alert.createdAt).getTime() / 1000)}:F>`, inline: true },
        ],
      });

      if (alert.details && Object.keys(alert.details).length > 0) {
        embed.addFields({ name: '📋 التفاصيل', value: `\`\`\`json\n${JSON.stringify(alert.details, null, 2).substring(0, 1000)}\n\`\`\``, inline: false });
      }

      const row = new ActionRowBuilder().addComponents(
        PanelManager.panelButton(`admin_fraud_resolve_${alert.alertId}`, '✅ حل', '✅'),
        NAV.back('admin_fraud'), NAV.home('admin'), NAV.close('admin'),
      );
      return PanelManager.update(interaction, { embeds: [embed], components: [row] });
    }

    if (action.startsWith('fraud_resolve_')) {
      const alertId = action.replace('fraud_resolve_', '');
      await fraudDetection.resolveAlert(alertId, interaction.user.id, 'action_taken', 'تم الحل بواسطة المشرف');
      return PanelManager.update(interaction, { embeds: [PanelManager.embed('✅ تم حل التنبيه', `تم حل التنبيه ${alertId}.`, config.colors.success)] });
    }

    return this.showFraud(interaction);
  },

  async handlePaymentAction(interaction, client, action) {
    if (action === 'payment_pending') {
      const payments = await PaymentService.getPendingVerification();
      const embed = PanelManager.embed('⏳ مدفوعات بانتظار التأكيد', payments.length > 0 ? payments.map((p, i) => `${i + 1}. **${p.paymentId}** — ${formatCurrency(p.amount)} — <@${p.buyerId}>`).join('\n') : '✅ لا توجد.', COLORS.payments);
      const row = PanelManager.navRow('admin');
      return PanelManager.update(interaction, { embeds: [embed], components: [row] });
    }
    return this.showPayments(interaction);
  },

  async handleWithdrawAction(interaction, client, action) {
    if (action === 'withdraw_pending') {
      const withdrawals = await BalanceService.getPendingWithdrawals();
      const embed = PanelManager.embed('⏳ سحوبات معلقة', withdrawals.length > 0 ? withdrawals.map((w, i) => `${i + 1}. **${w.withdrawalId}** — ${formatCurrency(w.amount)} — <@${w.userId}>`).join('\n') : '✅ لا توجد.', COLORS.withdrawals);
      const row = PanelManager.navRow('admin');
      return PanelManager.update(interaction, { embeds: [embed], components: [row] });
    }
    return this.showWithdrawals(interaction);
  },
};
