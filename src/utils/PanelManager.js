const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const { logger } = require('../utils/logger');

const NAV = {
  back: (panel, state = '') => new ButtonBuilder()
    .setCustomId(`${panel}_nav_back${state ? `_${state}` : ''}`)
    .setEmoji('◀️')
    .setLabel('رجوع')
    .setStyle(ButtonStyle.Secondary),
  home: (panel) => new ButtonBuilder()
    .setCustomId(`${panel}_nav_home`)
    .setEmoji('🏠')
    .setLabel('الرئيسية')
    .setStyle(ButtonStyle.Secondary),
  refresh: (panel, state = '') => new ButtonBuilder()
    .setCustomId(`${panel}_nav_refresh${state ? `_${state}` : ''}`)
    .setEmoji('🔄')
    .setLabel('تحديث')
    .setStyle(ButtonStyle.Secondary),
  close: (panel) => new ButtonBuilder()
    .setCustomId(`${panel}_nav_close`)
    .setEmoji('❌')
    .setLabel('إغلاق')
    .setStyle(ButtonStyle.Danger),
};

class PanelManager {
  static navRow(panel, options = {}) {
    const row = new ActionRowBuilder();
    if (options.back !== false) row.addComponents(NAV.back(panel, options.state || ''));
    if (options.home !== false) row.addComponents(NAV.home(panel));
    if (options.refresh !== false) row.addComponents(NAV.refresh(panel, options.state || ''));
    if (options.close !== false) row.addComponents(NAV.close(panel));
    return row;
  }

  static menuRow(customId, options, placeholder = 'اختر...') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder);
    for (const opt of options) {
      menu.addOptions({ label: opt.label, value: opt.value, description: opt.description, emoji: opt.emoji });
    }
    return new ActionRowBuilder().addComponents(menu);
  }

  static buttonRow(...buttons) {
    return new ActionRowBuilder().addComponents(...buttons);
  }

  static embed(title, description, color = config.colors.primary, options = {}) {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();
    if (options.footer) embed.setFooter(options.footer);
    if (options.thumbnail) embed.setThumbnail(options.thumbnail);
    if (options.image) embed.setImage(options.image);
    if (options.fields) embed.addFields(options.fields);
    return embed;
  }

  static panelButton(customId, label, emoji, style = ButtonStyle.Primary) {
    return new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(style);
  }

  static async defer(interaction) {
    if (!interaction.deferred && !interaction.replied) {
      try {
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
          await interaction.deferUpdate();
        } else {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
      } catch (err) {
        logger.warn('[PANEL] defer failed', { error: err?.message });
      }
    }
  }

  static async update(interaction, content, opts = {}) {
    const payload = { embeds: content.embeds || [], components: content.components || [] };
    if (content.content) payload.content = content.content;
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(payload);
      } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      logger.error('[PANEL] update failed', { error: err?.message, responded: interaction.replied || interaction.deferred });
    }
  }
}

module.exports = { PanelManager, NAV };
