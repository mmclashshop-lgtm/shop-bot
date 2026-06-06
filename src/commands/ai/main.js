const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { PanelManager, NAV } = require('../../utils/PanelManager');
const config = require('../../config');
const { logger } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription('🧠 مساعد الذكاء الاصطناعي - ChatGPT-style chat'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    return this.showHome(interaction);
  },

  async showHome(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('✨ AI Workspace — ChatGPT Experience')
      .setColor(0x10A37F) // ChatGPT green
      .setDescription(
        'مرحباً بك في مساحة عمل الذكاء الاصطناعي الاحترافية! 🤖\n\n' +
        '**💬 بدء محادثة:** اختر فئة من القائمة أدناه لفتح قناة مخصصة.\n' +
        '**📊 إحصائياتي:** عرض استهلاكك للرموز والمحادثات.\n' +
        '**⭐ مفضلاتي:** تصفح محادثاتك المثبتة.\n' +
        '**📚 المساعدة:** دليل الاستخدام السريع.\n\n' +
        '*جميع المحادثات مزودة باقتراحات تفاعلية، ردود سريعة، وإمكانية تصدير كـ PDF!*'
      )
      .setFooter({ text: 'Powered by Advanced AI • Session Analytics Active' })
      .setTimestamp();

    const menuRow = new ActionRowBuilder().addComponents(
      new (require('discord.js').StringSelectMenuBuilder)()
        .setCustomId('ai_create_chat_category')
        .setPlaceholder('💬 بدء محادثة جديدة (اختر التخصص)')
        .addOptions([
           { label: 'محادثة عامة (General)', value: 'general', emoji: '💬', description: 'نقاش عام وإجابات شاملة' },
           { label: 'مساعد برمجة (Code)', value: 'code', emoji: '💻', description: 'كتابة ومراجعة وشرح الأكواد' },
           { label: 'مساعد دراسي (Study)', value: 'study', emoji: '📚', description: 'شرح مفاهيم وخطط دراسية' },
           { label: 'كتابة إبداعية (Creative)', value: 'creative', emoji: '✍️', description: 'كتابة مقالات، قصص، ومحتوى' },
           { label: 'تلخيص (Summarize)', value: 'summarize', emoji: '📝', description: 'تلخيص النصوص الطويلة' },
        ])
    );

    const btnRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ai_stats').setLabel('📊 إحصائياتي').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ai_favorites').setLabel('⭐ المفضلة').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ai_help').setLabel('📚 مساعدة').setStyle(ButtonStyle.Secondary),
      NAV.close('ai')
    );

    return PanelManager.update(interaction, { embeds: [embed], components: [menuRow, btnRow] });
  },

  async handleButton(interaction, client, action) {
    switch (action) {
      case 'home':
      case 'refresh':
        await PanelManager.defer(interaction);
        return this.showHome(interaction);

      case 'close':
        return interaction.deleteReply().catch(() => {});

      case 'create_chat_category':
        await PanelManager.defer(interaction);
        try {
          const type = interaction.values[0];
          const channel = await client.aiChatSessionManager.getOrCreateChannel(interaction.user, interaction.guild);
          const { AIChat } = require('../../database/models');
          await AIChat.updateOne({ channelId: channel.id }, { type });
          await interaction.editReply({
            content: `✅ تم فتح قناة المحادثة (${type}): <#${channel.id}>\nيمكنك الذهاب إليها وطرح سؤالك الأول!`,
            embeds: [],
            components: [],
          });
        } catch (error) {
          logger.error('AI chat creation error', { error: error.message });
          await interaction.editReply({
            content: `❌ حدث خطأ أثناء إنشاء القناة: ${error.message}`,
          });
        }
        break;

      case 'stats':
        await PanelManager.defer(interaction);
        return this.showStats(interaction);

      case 'favorites':
        await PanelManager.defer(interaction);
        return this.showFavorites(interaction);

      case 'help':
        await PanelManager.defer(interaction);
        return this.showHelp(interaction);

      case 'settings':
        await PanelManager.defer(interaction);
        return this.showSettings(interaction);

      default:
        if (client.aiChatSessionManager) {
          return client.aiChatSessionManager.handleChannelAction(interaction, client, action);
        }
        await PanelManager.defer(interaction);
        return this.showHome(interaction);
    }
  },

  async showHelp(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('📚 AI Chat — المساعدة')
      .setColor(config.colors.info)
      .setDescription(
        '**كيفية استخدام AI Chat**\n\n' +
        '**1. بدء محادثة**\n' +
        'اضغط **💬 New Chat** لإنشاء قناة خاصة.\n\n' +
        '**2. الكتابة**\n' +
        'اكتب أي رسالة عادية في القناة — سيرد AI تلقائياً.\n\n' +
        '**3. الأزرار**\n' +
        '• 🗑 **حذف المحادثة** — حذف القناة والرسائل\n' +
        '• 🔄 **مسح الذاكرة** — مسح تاريخ المحادثة\n' +
        '• 📋 **تصدير** — إرسال نسخة من المحادثة إلى DM\n' +
        '• ❌ **إغلاق** — حذف القناة\n\n' +
        '**4. المميزات**\n' +
        '• ذاكرة محادثة كاملة\n' +
        '• مؤشر كتابة (Typing)\n' +
        '• دعم العربية والإنجليزية\n' +
        '• حذف تلقائي بعد ' + config.aiChat.inactivityTimeoutHours + ' ساعة من عدم النشاط\n\n' +
        '**الحدود**\n' +
        '• 100 رسالة/يوم لكل مستخدم\n' +
        '• ثانيتين بين كل رسالة\n' +
        '• 500 رسالة/يوم لكل سيرفر'
      )
      .setFooter({ text: 'AI Chat System' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      PanelManager.panelButton('ai_new_chat', '💬 New Chat', '💬', ButtonStyle.Success),
      NAV.home('ai'), NAV.close('ai'),
    );

    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showStats(interaction) {
    const { AIChat } = require('../../database/models');
    const stats = await AIChat.aggregate([
      { $match: { userId: interaction.user.id } },
      { $group: {
          _id: null,
          totalChats: { $sum: 1 },
          totalTokens: { $sum: "$usage.totalTokens" },
          totalPrompts: { $sum: "$usage.promptTokens" },
      }}
    ]);

    const userStats = stats[0] || { totalChats: 0, totalTokens: 0, totalPrompts: 0 };

    const embed = new EmbedBuilder()
      .setTitle('📊 إحصائيات جلسات الذكاء الاصطناعي')
      .setColor(0x3498DB)
      .addFields(
        { name: '💬 إجمالي المحادثات', value: userStats.totalChats.toString(), inline: true },
        { name: '🔤 استهلاك الرموز (Tokens)', value: userStats.totalTokens.toString(), inline: true },
        { name: '📝 مدخلاتك (Prompts)', value: userStats.totalPrompts.toString(), inline: true },
      )
      .setFooter({ text: 'Session Analytics' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(NAV.home('ai'), NAV.close('ai'));
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },

  async showFavorites(interaction) {
    const { AIChat } = require('../../database/models');
    const favorites = await AIChat.find({ userId: interaction.user.id, $or: [{ isPinned: true }, { isFavorite: true }] }).lean()
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean();

    const embed = new EmbedBuilder()
      .setTitle('⭐ المحادثات المفضلة والمثبتة')
      .setColor(0xF1C40F);

    if (favorites.length === 0) {
      embed.setDescription('لا توجد محادثات مثبتة حالياً. استخدم زر 📌 في أي محادثة لتثبيتها.');
    } else {
      let desc = '';
      favorites.forEach((chat, i) => {
        desc += `**${i+1}. ${chat.title || 'محادثة'}** (${chat.type || 'general'})\n`;
        desc += `🗓️ ${new Date(chat.createdAt).toLocaleDateString('ar-EG')} | 💬 ${chat.messages?.length || 0} رسالة\n\n`;
      });
      embed.setDescription(desc);
    }

    const row = new ActionRowBuilder().addComponents(NAV.home('ai'), NAV.close('ai'));
    return PanelManager.update(interaction, { embeds: [embed], components: [row] });
  },
};

const AIService = require('../../services/AIService');
