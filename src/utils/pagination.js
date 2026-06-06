const { ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder } = require('discord.js');

class Pagination {
  constructor(items, pageSize = 10) {
    this.items = items;
    this.pageSize = pageSize;
    this.totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  }

  getPage(page) {
    const p = Math.max(0, Math.min(page, this.totalPages - 1));
    const start = p * this.pageSize;
    return {
      page: p,
      items: this.items.slice(start, start + this.pageSize),
      totalPages: this.totalPages,
      total: this.items.length,
      hasPrev: p > 0,
      hasNext: p < this.totalPages - 1,
    };
  }

  toSelectMenu(customId, placeholder = 'اختر صفحة...', startPage = 0) {
    if (this.totalPages <= 1) return null;
    const select = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder);

    for (let i = 0; i < this.totalPages; i++) {
      const label = `الصفحة ${i + 1}${i === startPage ? ' ✓' : ''}`;
      select.addOptions(
        new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(i))
      );
    }
    return new ActionRowBuilder().addComponents(select);
  }

  static navigationRow(customId, page, totalPages) {
    if (totalPages <= 1) return null;
    const row = new ActionRowBuilder();
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${customId}_prev`)
        .setLabel('⬅️ السابق')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`${customId}_next`)
        .setLabel('التالي ➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );
    return row;
  }

  static async handleButton(interaction, customIdPrefix, fetchPageFn) {
    const action = interaction.customId.replace(`${customIdPrefix}_`, '');
    if (action !== 'prev' && action !== 'next') return false;

    const match = interaction.message.embeds[0]?.footer?.text?.match(/(\d+)\/(\d+)/);
    const currentPage = Math.max(0, (parseInt(match?.[1], 10) || 1) - 1);
    const nextPage = action === 'next' ? currentPage + 1 : currentPage - 1;

    const result = await fetchPageFn(nextPage);
    if (result) {
      await interaction.update(result);
    }
    return true;
  }

  static parseCustomId(customId) {
    const parts = customId.split('_');
    const page = parseInt(parts.pop(), 10);
    const action = parts.pop();
    const prefix = parts.join('_');
    return { prefix, action, page };
  }

  static createButtons(customIdPrefix, currentPage, totalPages) {
    if (totalPages <= 1) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${customIdPrefix}_info`)
          .setLabel(`📄 1/1`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      return [row];
    }
    const row = new ActionRowBuilder();
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${customIdPrefix}_prev_${currentPage}`)
        .setLabel('⬅️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`${customIdPrefix}_next_${currentPage}`)
        .setLabel('➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1)
    );
    return [row];
  }

  static createPageEmbed(title, description, fields, currentPage, totalPages) {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .addFields(fields)
      .setFooter({ text: `الصفحة ${currentPage}/${totalPages}` });
  }
}

module.exports = Pagination;
