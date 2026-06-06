const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config');
const AIService = require('../../services/AIService');
const { logger } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai-status')
    .setDescription('تشخيص حالة الذكاء الاصطناعي'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const apiKey = config.groq.apiKey;
    const model = config.groq.model;
    const baseURL = config.groq.baseURL;
    const clientReady = AIService.client !== null;

    const checks = [];

    checks.push(`**GROQ_API_KEY:** ${apiKey ? '✓ موجود' : '✗ غير موجود'}`);
    if (apiKey) {
      const prefix = apiKey.startsWith('gsk_') ? '✓' : '✗';
      checks.push(`**التنسيق:** ${prefix} ${apiKey.substring(0, 20)}...`);
      if (apiKey.includes('PLACE_YOUR') || apiKey.includes('YOUR_KEY') || apiKey.includes('EXAMPLE')) {
        checks.push('**❌ هذا المفتاح هو placeholder!**');
      }
    }

    checks.push(`**النموذج:** \`${model}\``);
    checks.push(`**Base URL:** \`${baseURL}\``);
    checks.push(`**الـ Client نشط:** ${clientReady ? '✓ نعم' : '✗ لا'}`);

    let groqStatus = 'غير معروف';
    if (!apiKey) {
      groqStatus = '❌ لا يوجد مفتاح API';
    } else if (apiKey.includes('PLACE_YOUR') || apiKey.includes('YOUR_KEY') || apiKey.includes('EXAMPLE')) {
      groqStatus = '❌ مفتاح placeholder - استبدل بمفتاح حقيقي';
    } else if (!apiKey.startsWith('gsk_')) {
      groqStatus = '❌ مفتاح غير صحيح - يجب أن يبدأ بـ gsk_';
    } else if (clientReady) {
      groqStatus = '✅ جاهز (تم التهيئة)';
    } else {
      groqStatus = '⚠️ تم التهيئة ولكن الـ client غير نشط';
    }

    checks.push(`**حالة Groq:** ${groqStatus}`);

    const lastError = AIService.lastError || null;
    if (lastError) {
      checks.push(`**آخر خطأ:** \`${lastError}\``);
    }

    const embed = new EmbedBuilder()
      .setColor(clientReady ? 0x2ECC71 : 0xE74C3C)
      .setTitle('🤖 تشخيص الذكاء الاصطناعي')
      .setDescription(checks.join('\n'))
      .setFooter({ text: `تم التشخيص في ${new Date().toLocaleString('ar-EG')}` });

    await interaction.editReply({ embeds: [embed] });
  },
};
