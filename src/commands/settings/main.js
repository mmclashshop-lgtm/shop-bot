const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const SettingsService = require('../../services/SettingsService');
const { logger } = require('../../utils/logger');

const SECTIONS = SettingsService.getSections();
const SECTION_EMOJIS = {
  ai: '🤖', marketplace: '🏪', commissions: '💰', wallet: '👛',
  payment: '💳', withdraw: '🏧', fraud: '🚨', security: '🔒',
  backup: '💾', alert: '⚠️', monitor: '📊', ticket: '🎫',
  loyalty: '⭐', trust: '🏆', roles: '👥', log: '📝',
};

function buildSectionChoices() {
  return SECTIONS.map(s => ({ name: `${SECTION_EMOJIS[s.key] || '📁'} ${s.name}`, value: s.key }));
}

const boolEmoji = v => v ? '✅' : '❌';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('⚙️ لوحة إعدادات السيرفر (للمشرفين)')
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('عرض الإعدادات')
        .addStringOption(opt =>
          opt.setName('section')
            .setDescription('اختر القسم')
            .setRequired(false)
            .addChoices(...buildSectionChoices()))
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('تعديل إعداد')
        .addStringOption(opt =>
          opt.setName('section')
            .setDescription('القسم')
            .setRequired(true)
            .addChoices(...buildSectionChoices()))
        .addStringOption(opt =>
          opt.setName('key')
            .setDescription('اسم الإعداد')
            .setRequired(true))
        .addStringOption(opt =>
          opt.setName('value')
            .setDescription('القيمة الجديدة')
            .setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('history')
        .setDescription('سجل التغييرات')
        .addStringOption(opt =>
          opt.setName('section')
            .setDescription('تصفية حسب القسم')
            .setRequired(false)
            .addChoices(...buildSectionChoices()))
    )
    .addSubcommand(sub =>
      sub.setName('rollback')
        .setDescription('التراجع عن تغيير')
        .addStringOption(opt =>
          opt.setName('change_id')
            .setDescription('معرف التغيير')
            .setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('validate')
        .setDescription('التحقق من صحة الإعدادات')
        .addStringOption(opt =>
          opt.setName('section')
            .setDescription('القسم')
            .setRequired(true)
            .addChoices(...buildSectionChoices()))
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 لوحة الإعدادات للمشرفين فقط.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'view': return this.handleView(interaction);
      case 'edit': return this.handleEdit(interaction);
      case 'history': return this.handleHistory(interaction);
      case 'rollback': return this.handleRollback(interaction);
      case 'validate': return this.handleValidate(interaction);
    }
  },

  async handleView(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const section = interaction.options.getString('section');
    const guildId = interaction.guildId;

    try {
      if (section) {
        return this._renderSection(interaction, guildId, section);
      }
      return this._renderOverview(interaction, guildId);
    } catch (error) {
      logger.error('Settings view error', { error: error.message });
      await interaction.editReply({ content: `❌ ${error.message}` });
    }
  },

  async _renderOverview(interaction, guildId) {
    const settings = await SettingsService.getGuildSettings(guildId);

    const embed = new EmbedBuilder()
      .setTitle('⚙️ لوحة إعدادات السيرفر')
      .setColor(0x5865F2)
      .setDescription('اختر قسماً من القائمة أدناه لعرض أو تعديل الإعدادات.')
      .addFields(
        { name: '🆔 السيرفر', value: `\`${guildId}\``, inline: true },
        { name: '📋 الإصدار', value: `v${settings.version || 1}`, inline: true },
        { name: '🕐 آخر تحديث', value: settings.updatedAt ? new Date(settings.updatedAt).toLocaleString('ar-SA') : 'N/A', inline: false },
      );

    for (const s of SECTIONS) {
      const sectionData = settings[s.key] || {};
      const count = Object.keys(sectionData).length;
      const emoji = SECTION_EMOJIS[s.key] || '📁';
      embed.addFields({ name: `${emoji} ${s.name}`, value: `${count} إعداد`, inline: true });
    }

    const select = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('settings_view_section')
        .setPlaceholder('📂 اختر قسماً للعرض')
        .addOptions(SECTIONS.map(s => ({
          label: s.name,
          value: s.key,
          emoji: SECTION_EMOJIS[s.key] || '📁',
        })))
    );

    await interaction.editReply({ embeds: [embed], components: [select] });
  },

  async _renderSection(interaction, guildId, section) {
    const sectionData = await SettingsService.getSection(guildId, section);
    const defaults = SettingsService.getDefaultsForSection(section);
    const keysInfo = SettingsService.getSectionKeys(section);
    const sInfo = SECTIONS.find(s => s.key === section);
    const emoji = SECTION_EMOJIS[section] || '📁';
    const isPriority = SettingsService.isPrioritySection(section);

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${sInfo ? sInfo.name : section} — الإعدادات`)
      .setColor(isPriority ? 0xE74C3C : 0x3498DB)
      .setFooter({ text: isPriority ? '🔴 قسم حساس — يتم عمل نسخة احتياطية قبل كل تغيير' : 'استخدم /settings edit لتعديل' })
      .setTimestamp();

    const fields = [];
    for (const info of keysInfo) {
      const current = sectionData[info.key] !== undefined ? sectionData[info.key] : info.defaultValue;
      const defaultVal = info.defaultValue;
      const isChanged = String(current) !== String(defaultVal);
      const typeStr = info.type === 'boolean' ? boolEmoji(current) : current;
      const changedStr = isChanged ? ' ⚡' : '';

      fields.push({
        name: `\`${info.key}\`${changedStr}`,
        value: `📌 **القيمة:** \`${typeStr}\`\n📐 **النوع:** ${info.type}${isChanged ? '\n📋 **الافتراضي:** `' + defaultVal + '`' : ''}`,
        inline: false,
      });
    }

    embed.setDescription(`إجمالي ${keysInfo.length} إعداد${fields.length > 0 ? '' : '\n📭 لا توجد إعدادات'}`);

    const CHUNK_SIZE = 8;
    const chunks = [];
    for (let i = 0; i < fields.length; i += CHUNK_SIZE) {
      chunks.push(fields.slice(i, i + CHUNK_SIZE));
    }

    if (chunks.length === 0) {
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    embed.addFields(chunks[0]);

    if (chunks.length > 1) {
      embed.setFooter({ text: `صفحة 1/${chunks.length} — استخدم الأزرار للتنقل` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`settings_prev_${section}_1`).setLabel('◀️ السابق').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`settings_next_${section}_1`).setLabel('التالي ▶️').setStyle(ButtonStyle.Primary),
      );
      await interaction.editReply({ embeds: [embed], components: [row] });
    } else {
      await interaction.editReply({ embeds: [embed] });
    }
  },

  async handleEdit(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const section = interaction.options.getString('section');
    const key = interaction.options.getString('key');
    const value = interaction.options.getString('value');

    try {
      const validation = SettingsService.validate(section, key, value, key);
      if (!validation.valid) {
        return interaction.editReply({ content: `❌ **خطأ في التحقق:** ${validation.error}` });
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚙️ تأكيد تعديل الإعداد')
        .setColor(0xF39C12)
        .addFields(
          { name: '📂 القسم', value: section, inline: true },
          { name: '🔑 الإعداد', value: `\`${key}\``, inline: true },
          { name: '📌 القيمة الجديدة', value: `\`${validation.value}\``, inline: false },
        )
        .setFooter({ text: 'اضغط زر التأكيد لحفظ التغيير' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`settings_confirm_${section}_${key}_${encodeURIComponent(String(validation.value))}`)
          .setLabel('✅ تأكيد')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('settings_cancel')
          .setLabel('❌ إلغاء')
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${error.message}` });
    }
  },

  async handleHistory(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const section = interaction.options.getString('section');
    const guildId = interaction.guildId;

    try {
      const history = await SettingsService.getHistory(guildId, section, 25);

      if (history.length === 0) {
        return interaction.editReply({ content: '📭 لا توجد تغييرات مسجلة بعد.' });
      }

      const embed = new EmbedBuilder()
        .setTitle(`📋 سجل تغييرات الإعدادات${section ? ` — ${section}` : ''}`)
        .setColor(0x5865F2)
        .setDescription(history.map((h, i) =>
          `**${i + 1}. \`${h.section}.${h.key}\`**\n` +
          `  📌 ${h.oldValue !== null && h.oldValue !== undefined ? `\`${h.oldValue}\`` : '*(جديد)*'} → \`${h.newValue}\`\n` +
          `  👤 ${h.changedByTag || h.changedBy} | 🕐 ${new Date(h.createdAt).toLocaleString('ar-SA')}\n` +
          `  🆔 \`${h.changeId.substring(0, 20)}...\``
        ).join('\n\n'))
        .setFooter({ text: `إجمالي ${history.length} تغيير` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${error.message}` });
    }
  },

  async handleRollback(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const changeId = interaction.options.getString('change_id');

    try {
      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ تأكيد التراجع عن التغيير')
        .setColor(0xE74C3C)
        .setDescription(`هل أنت متأكد من التراجع عن التغيير \`${changeId}\`؟`)
        .setFooter({ text: 'هذا سيستعيد القيمة السابقة' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`settings_rollback_confirm_${changeId}`)
          .setLabel('✅ تأكيد التراجع')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('settings_cancel')
          .setLabel('❌ إلغاء')
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${error.message}` });
    }
  },

  async handleValidate(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const section = interaction.options.getString('section');
    const guildId = interaction.guildId;

    try {
      const sectionData = await SettingsService.getSection(guildId, section);
      const validation = await SettingsService.validateSection(guildId, section, sectionData);

      const embed = new EmbedBuilder()
        .setTitle(`✅ التحقق من صحة — ${section}`)
        .setColor(validation.errors.length === 0 ? 0x2ECC71 : 0xF39C12)
        .setDescription(
          validation.errors.length === 0
            ? '✅ جميع الإعدادات صحيحة'
            : `⚠️ تم العثور على ${validation.errors.length} مشكلة`
        )
        .addFields(
          { name: '✅ صحيح', value: `${Object.keys(validation.valid).length}`, inline: true },
          { name: '❌ أخطاء', value: `${validation.errors.length}`, inline: true },
        )
        .setTimestamp();

      if (validation.errors.length > 0) {
        embed.addFields({
          name: '❌ تفاصيل الأخطاء',
          value: validation.errors.map(e => `• \`${e.key}\`: ${e.error}`).join('\n'),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ ${error.message}` });
    }
  },

  async handleButton(interaction, client, action) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 للمشرفين فقط.', ephemeral: true });
    }

    if (action === 'cancel') {
      return interaction.update({ content: '❌ تم إلغاء العملية.', embeds: [], components: [] });
    }

    if (action.startsWith('confirm_')) {
      const rest = action.replace('confirm_', '');
      const sepIdx = rest.indexOf('_');
      if (sepIdx === -1) return;
      const section = rest.substring(0, sepIdx);
      const rest2 = rest.substring(sepIdx + 1);
      const lastSep = rest2.lastIndexOf('_');
      if (lastSep === -1) return;
      const key = rest2.substring(0, lastSep);
      const rawValue = decodeURIComponent(rest2.substring(lastSep + 1));

      await interaction.deferUpdate();

      try {
        const result = await SettingsService.set(
          interaction.guildId, section, key, rawValue,
          interaction.user.id,
          { userTag: interaction.user.tag, reason: 'Discord settings panel' }
        );

        const embed = new EmbedBuilder()
          .setTitle('✅ تم حفظ الإعداد بنجاح')
          .setColor(0x2ECC71)
          .addFields(
            { name: '📂 القسم', value: section, inline: true },
            { name: '🔑 الإعداد', value: `\`${key}\``, inline: true },
            { name: '📌 القيمة القديمة', value: result.oldValue !== null && result.oldValue !== undefined ? `\`${result.oldValue}\`` : '*(جديد)*', inline: true },
            { name: '📌 القيمة الجديدة', value: `\`${result.newValue}\``, inline: true },
            { name: '📋 الإصدار', value: `v${result.version}`, inline: true },
          )
          .setFooter({ text: `بواسطة: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed], components: [] });
      } catch (error) {
        await interaction.editReply({ content: `❌ ${error.message}`, embeds: [], components: [] });
      }
      return;
    }

    if (action.startsWith('rollback_confirm_')) {
      const changeId = action.replace('rollback_confirm_', '');
      await interaction.deferUpdate();

      try {
        const result = await SettingsService.rollback(interaction.guildId, changeId, interaction.user.id);

        const embed = new EmbedBuilder()
          .setTitle('✅ تم التراجع عن التغيير بنجاح')
          .setColor(0x2ECC71)
          .addFields(
            { name: '🔑 الإعداد', value: `\`${result.key}\``, inline: true },
            { name: '📌 القيمة المستعادة', value: `\`${result.newValue}\``, inline: true },
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed], components: [] });
      } catch (error) {
        await interaction.editReply({ content: `❌ ${error.message}`, embeds: [], components: [] });
      }
      return;
    }

    if (action.startsWith('prev_') || action.startsWith('next_')) {
      const parts = action.split('_');
      const dir = parts[0];
      const section = parts[1];
      const page = parseInt(parts[2], 10) || 1;
      return this._paginateSection(interaction, section, dir === 'next' ? page + 1 : page - 1);
    }

    await interaction.deferUpdate().catch(() => {});
    return interaction.editReply({ content: '❌ إجراء غير معروف.', flags: MessageFlags.Ephemeral });
  },

  async handleSelectMenu(interaction) {
    if (!interaction.memberPermissions.has('Administrator')) {
      return interaction.reply({ content: '🚫 للمشرفين فقط.', ephemeral: true });
    }

    if (interaction.customId === 'settings_view_section') {
      const section = interaction.values[0];
      return this._renderSection(interaction, interaction.guildId, section);
    }
  },

  async _paginateSection(interaction, section, page) {
    const guildId = interaction.guildId;
    const sectionData = await SettingsService.getSection(guildId, section);
    const keysInfo = SettingsService.getSectionKeys(section);
    const sInfo = SECTIONS.find(s => s.key === section);
    const emoji = SECTION_EMOJIS[section] || '📁';

    const CHUNK_SIZE = 8;
    const chunks = [];
    for (let i = 0; i < keysInfo.length; i += CHUNK_SIZE) {
      chunks.push(keysInfo.slice(i, i + CHUNK_SIZE));
    }

    const totalPages = chunks.length;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const chunk = chunks[currentPage - 1];

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${sInfo ? sInfo.name : section} — الإعدادات`)
      .setColor(0x3498DB)
      .setFooter({ text: `صفحة ${currentPage}/${totalPages}` })
      .setTimestamp();

    embed.addFields(
      chunk.map(info => {
        const current = sectionData[info.key] !== undefined ? sectionData[info.key] : info.defaultValue;
        const typeStr = info.type === 'boolean' ? boolEmoji(current) : current;
        return {
          name: `\`${info.key}\``,
          value: `📌 **القيمة:** \`${typeStr}\`\n📐 **النوع:** ${info.type}`,
          inline: false,
        };
      })
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`settings_prev_${section}_${currentPage}`)
        .setLabel('◀️ السابق')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage <= 1),
      new ButtonBuilder()
        .setCustomId(`settings_next_${section}_${currentPage}`)
        .setLabel('التالي ▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage >= totalPages),
    );

    await interaction.update({ embeds: [embed], components: [row] });
  },
};
