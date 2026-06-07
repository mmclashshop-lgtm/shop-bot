const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const BackupService = require('../../services/BackupService');
const { logger } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('💾 نظام النسخ الاحتياطي لقاعدة البيانات (للمشرفين)')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('إنشاء نسخة احتياطية جديدة')
        .addStringOption(opt =>
          opt.setName('type')
            .setDescription('نوع النسخة الاحتياطية')
            .setRequired(true)
            .addChoices(
              { name: '📅 Daily', value: 'daily' },
              { name: '📆 Weekly', value: 'weekly' },
              { name: '📅 Monthly', value: 'monthly' },
            ))
    )
    .addSubcommand(sub =>
      sub.setName('restore')
        .setDescription('استعادة نسخة احتياطية')
        .addStringOption(opt =>
          opt.setName('backup_id')
            .setDescription('معرف النسخة الاحتياطية')
            .setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('عرض قائمة النسخ الاحتياطية')
        .addStringOption(opt =>
          opt.setName('type')
            .setDescription('تصفية حسب النوع')
            .setRequired(false)
            .addChoices(
              { name: '📅 Daily', value: 'daily' },
              { name: '📆 Weekly', value: 'weekly' },
              { name: '📅 Monthly', value: 'monthly' },
            ))
    )
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('حالة نظام النسخ الاحتياطي')
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.editReply({ content: '🚫 نظام النسخ الاحتياطي للمشرفين فقط.' });
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'create': return this.handleCreate(interaction);
      case 'restore': return this.handleRestore(interaction);
      case 'list': return this.handleList(interaction);
      case 'status': return this.handleStatus(interaction);
    }
  },

  async handleCreate(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const type = interaction.options.getString('type');

    const statusEmbed = new EmbedBuilder()
      .setTitle('⏳ جاري إنشاء النسخة الاحتياطية...')
      .setColor(0xF39C12)
      .setDescription(`نوع: **${type}**
⚠️ قد تستغرق العملية عدة دقائق. سيتم إعلامك عند الانتهاء.`)
      .setTimestamp();

    await interaction.editReply({ embeds: [statusEmbed] });

    try {
      const result = await BackupService.createBackup(type, { triggeredBy: interaction.user.id });

      const embed = new EmbedBuilder()
        .setTitle('✅ تم إنشاء النسخة الاحتياطية بنجاح')
        .setColor(0x2ECC71)
        .addFields(
          { name: '🆔 المعرف', value: `\`${result.backupId}\``, inline: false },
          { name: '📦 النوع', value: result.type, inline: true },
          { name: '💾 الحجم', value: BackupService._formatSize(result.size), inline: true },
          { name: '⏱️ المدة', value: `${result.duration}ms`, inline: true },
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const embed = new EmbedBuilder()
        .setTitle('❌ فشل إنشاء النسخة الاحتياطية')
        .setColor(0xE74C3C)
        .setDescription(`\`\`\`${error.message.substring(0, 1000)}\`\`\``)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },

  async handleRestore(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const backupId = interaction.options.getString('backup_id');

    const backup = await BackupService.getBackup(backupId);
    if (!backup) {
      return interaction.editReply({ content: `❌ لم يتم العثور على نسخة احتياطية بهذا المعرف: \`${backupId}\`` });
    }

    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚠️ تأكيد استعادة النسخة الاحتياطية')
      .setColor(0xE74C3C)
      .setDescription(`**تحذير:** استعادة النسخة الاحتياطية ستستبدل قاعدة البيانات الحالية بالكامل!
      
**المعرف:** \`${backup.backupId}\`
**النوع:** ${backup.type}
**تاريخ الإنشاء:** ${new Date(backup.createdAt).toLocaleString('ar-SA')}
**الحالة:** ${backup.status}
**الحجم:** ${BackupService._formatSize(backup.compressedSizeBytes || 0)}
**MD5:** \`${backup.md5Hash || 'N/A'}\`

للاستمرار، اضغط على زر التأكيد أدناه.`)
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`backup_confirm_restore_${backupId}`)
        .setLabel('✅ تأكيد الاستعادة')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('backup_cancel_restore')
        .setLabel('❌ إلغاء')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
  },

  async handleList(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const type = interaction.options.getString('type');

    const backups = await BackupService.listBackups(type || null, 25);

    if (backups.length === 0) {
      return interaction.editReply({ content: '📭 لا توجد نسخ احتياطية بعد.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`💾 قائمة النسخ الاحتياطية${type ? ` — ${type}` : ''}`)
      .setColor(0x5865F2)
      .setDescription(backups.map((b, i) =>
        `${i + 1}. **${b.backupId.substring(0, 20)}...** — ${b.type} | ${b.status} | ${BackupService._formatSize(b.compressedSizeBytes || 0)}\n` +
        `   🕐 ${new Date(b.createdAt).toLocaleString('ar-SA')}`
      ).join('\n\n'))
      .setFooter({ text: `إجمالي ${backups.length} نسخة` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },

  async handleStatus(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const status = await BackupService.getStatus();

      const embed = new EmbedBuilder()
        .setTitle('💾 حالة نظام النسخ الاحتياطي')
        .setColor(status.healthy ? 0x2ECC71 : 0xE74C3C)
        .addFields(
          { name: '✅ الحالة الصحية', value: status.healthy ? '🟢 سليمة' : '🔴 تحتاج تدخلاً', inline: true },
          { name: '📊 إجمالي النسخ', value: status.storage.totalBackups.toString(), inline: true },
          { name: '💾 الحجم الإجمالي', value: status.storage.totalSizeFormatted, inline: true },
          { name: '📅 Daily', value: status.storage.byType.daily.toString(), inline: true },
          { name: '📆 Weekly', value: status.storage.byType.weekly.toString(), inline: true },
          { name: '📅 Monthly', value: status.storage.byType.monthly.toString(), inline: true },
        );

      if (status.lastBackup) {
        embed.addFields({
          name: '🕐 آخر نسخة',
          value: `\`${status.lastBackup.id.substring(0, 30)}...\` — ${status.lastBackup.type} | ${status.lastBackup.status}\n🕐 ${new Date(status.lastBackup.time).toLocaleString('ar-SA')}`,
        });
      }

      const running = status.runningBackups;
      if (running && running.length > 0) {
        embed.addFields({
          name: '⏳ قيد التشغيل',
          value: running.map(r => `• ${r.type} (${Math.round(r.elapsed / 1000)}ث)`).join('\n'),
        });
      }

      if (status.suggestions && status.suggestions.length > 0) {
        embed.addFields({
          name: '💡 توصيات الاسترداد',
          value: status.suggestions.map(s => `**${s.priority}:** ${s.action}${s.command ? ` (\`${s.command}\`)` : ''}`).join('\n'),
        });
      }

      if (status.health && status.health.issues && status.health.issues.length > 0) {
        embed.addFields({
          name: '⚠️ المشاكل الحالية',
          value: status.health.issues.map(i => `• ${i}`).join('\n'),
        });
      }

      embed.setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ فشل جلب الحالة: ${error.message}` });
    }
  },

  async handleButton(interaction, client, action) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 للمشرفين فقط.', ephemeral: true });
    }

    if (action === 'cancel_restore') {
      return interaction.update({ content: '❌ تم إلغاء عملية الاستعادة.', embeds: [], components: [] });
    }

    if (action.startsWith('confirm_restore_')) {
      const backupId = action.replace('confirm_restore_', '');
      await interaction.deferUpdate();

      try {
        const progressEmbed = new EmbedBuilder()
          .setTitle('⏳ جاري استعادة النسخة الاحتياطية...')
          .setColor(0xF39C12)
          .setDescription(`المعرف: \`${backupId}\`\n⚠️ قد تستغرق العملية عدة دقائق.`)
          .setTimestamp();

        await interaction.editReply({ embeds: [progressEmbed], components: [] });

        const result = await BackupService.restoreBackup(backupId, interaction.user.id);

        const embed = new EmbedBuilder()
          .setTitle('✅ تمت استعادة النسخة الاحتياطية بنجاح')
          .setColor(0x2ECC71)
          .addFields(
            { name: '🆔 المعرف', value: `\`${backupId}\``, inline: true },
            { name: '🗄️ قاعدة البيانات', value: `\`${result.dbName}\``, inline: true },
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        const embed = new EmbedBuilder()
          .setTitle('❌ فشلت استعادة النسخة الاحتياطية')
          .setColor(0xE74C3C)
          .setDescription(`\`\`\`${error.message.substring(0, 1000)}\`\`\``)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
    }

    await interaction.deferUpdate().catch(() => {});
    return interaction.editReply({ content: '❌ إجراء غير معروف.', flags: MessageFlags.Ephemeral });
  },
};
