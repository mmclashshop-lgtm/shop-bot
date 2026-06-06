const { EmbedBuilder } = require('discord.js');
const { EmbedBuilderUtil } = require('../../utils/embeds');

const config = require('../../config');

const AI_COLORS = {
  primary: 0x6C5CE7,
  success: 0x00E676,
  error: 0xFF1744,
  warning: 0xFFC107,
  info: 0x00B0FF,
  loading: 0x9E9E9E,
};

// NOTE: AIEmbedUtil uses its own color scheme distinct from EmbedBuilderUtil.
// Common embed patterns (success, warning, etc.) could be migrated to use
// EmbedBuilderUtil methods with AI_COLORS overrides in the future.
class AIEmbedUtil {
  static panel({ status, model, memory, api, requests, tokens, userId }) {
    const embed = new EmbedBuilder()
      .setColor(AI_COLORS.primary)
      .setTitle('🧠 AI Assistant Panel')
      .setDescription('مرحباً بك في لوحة التحكم بالذكاء الاصطناعي\nاختر وظيفة من القائمة أدناه')
      .addFields(
        { name: '📡 الحالة', value: status === 'Online' ? '✅ متصل' : '❌ غير متصل', inline: true },
        { name: '🤖 النموذج', value: `\`${model}\``, inline: true },
        { name: '💾 الذاكرة', value: memory === 'Active' ? '✅ نشطة' : '❌ معطلة', inline: true },
        { name: '🔌 API', value: api === 'Connected' ? '✅ متصل' : '❌ منفصل', inline: true },
        { name: '📊 الطلبات', value: requests.toString(), inline: true },
        { name: '🔤 الرموز', value: tokens.toString(), inline: true },
      )
      .setFooter({ text: `👤 ${userId}` })
      .setTimestamp();

    return embed;
  }

  static loading(title, description) {
    return new EmbedBuilder()
      .setColor(AI_COLORS.loading)
      .setTitle(`⏳ ${title}`)
      .setDescription(description || 'جارٍ المعالجة... يرجى الانتظار')
      .setTimestamp();
  }

  static info(title, description, options = {}) {
    const embed = new EmbedBuilder()
      .setColor(AI_COLORS.info)
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    if (options.footer) embed.setFooter(options.footer);
    return embed;
  }

  static error(title, description) {
    return new EmbedBuilder()
      .setColor(AI_COLORS.error)
      .setTitle(`❌ ${title}`)
      .setDescription(description || 'حدث خطأ غير متوقع')
      .setTimestamp();
  }

  static aiResponse(title, response, options = {}) {
    const modelLabel = options.model || 'Groq';
    const tokensLabel = options.tokens || 'N/A';
    const timeLabel = options.responseTime ? `${(options.responseTime / 1000).toFixed(1)}s` : 'N/A';

    const embed = new EmbedBuilder()
      .setColor(AI_COLORS.primary)
      .setTitle(title)
      .setDescription(response)
      .setFooter({
        text: `🤖 ${modelLabel} | ⚡ ${timeLabel} | 🔤 ${tokensLabel}`,
      })
      .setTimestamp();

    return embed;
  }

  static welcome() {
    return new EmbedBuilder()
      .setColor(AI_COLORS.primary)
      .setTitle('🧠 AI Assistant')
      .setDescription('👋 مرحباً! أنا مساعد AI الذكي.\n\n📌 **اختر وظيفة من القائمة للبدء**\n\n**المميزات:**\n• 💬 محادثة عامة\n• 💻 مساعدة برمجية\n• 🐛 تصحيح أخطاء\n• 📖 شرح كود\n• 📝 تلخيص نصوص\n• 🌍 ترجمة\n• 🔍 بحث ذكي')
      .setFooter({ text: 'Market AI Assistant' })
      .setTimestamp();
  }

  static sessionExpired() {
    return new EmbedBuilder()
      .setColor(AI_COLORS.warning)
      .setTitle('⚠️ انتهت الجلسة')
      .setDescription('هذه الجلسة انتهت صلاحيتها.\nاستخدم `/ai` لإنشاء جلسة جديدة.')
      .setTimestamp();
  }

  static maintenance() {
    return new EmbedBuilder()
      .setColor(AI_COLORS.warning)
      .setTitle('🔧 الصيانة')
      .setDescription('خدمة الذكاء الاصطناعي قيد الصيانة حالياً.\nيرجى المحاولة لاحقاً.')
      .setTimestamp();
  }
}

module.exports = { AIEmbedUtil };
