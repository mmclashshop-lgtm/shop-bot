const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { logger } = require('../utils/logger');
const AIService = require('./AIService');
const MemoryService = require('./MemoryService');
const { AIChat } = require('../database/models');

class AIChatSessionManager {
  constructor(client) {
    this.client = client;
    this.activeTyping = new Map();
    this.cooldowns = new Map();
    this.channelMap = new Map();
    this.suggestionsCache = new Map();
    this._autoCleanup = null;
    this._timeouts = [];
  }

  initialize() {
    const intervalMs = config.aiChat.cleanupIntervalMinutes * 60 * 1000;
    this._autoCleanup = setInterval(() => this._cleanupInactiveChannels(), intervalMs);
    this._cooldownCleanup = setInterval(() => {
      const cutoff = Date.now() - config.aiChat.cooldownMs;
      for (const [userId, ts] of this.cooldowns.entries()) {
        if (ts < cutoff) this.cooldowns.delete(userId);
      }
    }, 60000);
    this._suggestionsCleanup = setInterval(() => {
      this.suggestionsCache.clear();
    }, 1800000);
    this._rebuildChannelMap();
    logger.info('AIChatSessionManager initialized');
  }

  _setTimeout(fn, ms) {
    const id = setTimeout(() => {
      const idx = this._timeouts.indexOf(id);
      if (idx >= 0) this._timeouts.splice(idx, 1);
      fn();
    }, ms);
    this._timeouts.push(id);
    return id;
  }

  async _rebuildChannelMap() {
    try {
      for (const guild of this.client.guilds.cache.values()) {
        const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === config.aiChat.categoryName);
        if (!category) continue;
        for (const channel of category.children.cache.values()) {
          if (channel.name.startsWith('ai-')) {
            const userId = this._extractUserId(channel);
            if (userId) {
              this.channelMap.set(`${userId}:${guild.id}`, channel.id);
            }
          }
        }
      }
    } catch (err) {
      logger.error('Failed to rebuild channel map', { error: err.message });
    }
  }

  _extractUserId(channel) {
    const permissionOverwrites = channel.permissionOverwrites.cache;
    for (const [id, overwrite] of permissionOverwrites) {
      if (overwrite.type === 1 && overwrite.allow.has('ViewChannel') && id !== this.client.user.id) {
        return id;
      }
    }
    return null;
  }

  _sanitizeChannelName(username) {
    return `ai-${username.replace(/[^a-zA-Z0-9\u0600-\u06FF\s-]/g, '').replace(/\s+/g, '-').toLowerCase().substring(0, 80)}`;
  }

  async getOrCreateChannel(user, guild) {
    const key = `${user.id}:${guild.id}`;

    // 1. Check in-memory cache first
    const existingId = this.channelMap.get(key);
    if (existingId) {
      const existing = guild.channels.cache.get(existingId);
      if (existing) return existing;
      this.channelMap.delete(key);
    }

    // 2. Check Discord channels cache
    let channel = guild.channels.cache.find(c => c.name.startsWith(`ai-`) && c.parent?.name === config.aiChat.categoryName && c.permissionOverwrites.cache.has(user.id));
    if (channel) {
      this.channelMap.set(key, channel.id);
      return channel;
    }

    // 3. DB-level lock: atomically claim the slot using the unique partial index on {userId, guildId, channelId}
    //    Only one process can create a channel per user+guild at a time.
    const lockId = `creating_${Date.now()}`;
    try {
      await AIChat.create({
        userId: user.id,
        guildId: guild.id,
        channelId: lockId,
        type: 'general',
        messages: [],
      });
    } catch (err) {
      if (err.code === 11000) {
        // Duplicate key — another process already created or is creating a channel
        const existingDoc = await AIChat.findOne({ userId: user.id, guildId: guild.id, channelId: { $ne: null } }).lean();
        if (existingDoc && existingDoc.channelId && existingDoc.channelId !== lockId) {
          const cached = guild.channels.cache.get(existingDoc.channelId);
          if (cached) {
            this.channelMap.set(key, cached.id);
            return cached;
          }
        }
        // Fallback: wait briefly then re-check cache
        await new Promise(r => setTimeout(r, 1000));
        const retry = guild.channels.cache.find(c => c.name.startsWith(`ai-`) && c.parent?.name === config.aiChat.categoryName && c.permissionOverwrites.cache.has(user.id));
        if (retry) {
          this.channelMap.set(key, retry.id);
          return retry;
        }
      }
      // Allow retry without lock doc
    }

    // 4. Create the Discord channel
    const category = await this._ensureCategory(guild);
    const name = this._sanitizeChannelName(user.displayName || user.username);

    try {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `AI Chat session for ${user.username}`,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
          {
            id: this.client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.ManageChannels,
            ],
          },
        ],
      });
    } catch (createErr) {
      // Clean up the lock document on failure
      await AIChat.deleteOne({ userId: user.id, guildId: guild.id, channelId: lockId }).catch(() => {});
      throw createErr;
    }

    // 5. Update the lock document with the real channelId
    await AIChat.updateOne(
      { userId: user.id, guildId: guild.id, channelId: lockId },
      { $set: { channelId: channel.id } }
    ).catch(() => {
      // Fallback: create a new document if the lock was cleaned up
      AIChat.create({ userId: user.id, guildId: guild.id, channelId: channel.id, type: 'general', messages: [] }).catch(() => {});
    });

    this.channelMap.set(key, channel.id);
    await this._sendWelcome(channel, user);
    return channel;
  }

  async _ensureCategory(guild) {
    let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === config.aiChat.categoryName);
    if (!category) {
      category = await guild.channels.create({
        name: config.aiChat.categoryName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: this.client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageRoles,
            ],
          },
        ],
      });
      logger.info('Created AI Chats category', { guildId: guild.id });
    }
    return category;
  }

  async _sendWelcome(channel, user) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.purple)
      .setTitle(`🤖 AI Chat — ${user.displayName || user.username}`)
      .setDescription(
        `مرحباً بك في محادثة الذكاء الاصطناعي! 🎉

اكتب أي شيء وسأرد عليك فوراً.

**المميزات:**
• ذاكرة محادثة كاملة
• ردود سريعة
• دعم اللغة العربية والإنجليزية

**ملاحظة:** يتم حذف القنوات غير النشطة بعد ${config.aiChat.inactivityTimeoutHours} ساعة.`
      )
      .setFooter({ text: 'AI Chat • استخدم الأزرار أدناه لإدارة المحادثة' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ai_chat_delete')
        .setLabel('🗑 حذف المحادثة')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('ai_chat_pin')
        .setLabel('📌 تثبيت المحادثة')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('ai_chat_clear')
        .setLabel('🔄 مسح الذاكرة')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('ai_chat_export')
        .setLabel('📋 تصدير')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('ai_chat_close')
        .setLabel('❌ إغلاق')
        .setStyle(ButtonStyle.Danger),
    );

    await channel.send({ embeds: [embed], components: [row] });
  }

  async handleMessage(message) {
    if (message.author.bot) return false;
    if (!message.guild) return false;

    const channelName = message.channel.name;
    if (!channelName.startsWith('ai-')) return false;

    const category = message.channel.parent;
    if (!category || category.name !== config.aiChat.categoryName) return false;

    const userId = message.author.id;
    const guildId = message.guild.id;

    const cooldownRemaining = this._checkCooldown(userId);
    if (cooldownRemaining > 0) {
      try {
        const reply = await message.reply({ content: `⏳ يرجى الانتظار ${Math.ceil(cooldownRemaining / 1000)} ثانية بين الرسائل.` });
        this._setTimeout(() => reply.delete().catch(() => {}), 3000);
      } catch (err) { logger.error('Unhandled error in services/AIChatSessionManager.js', { error: err?.message }) }
      return false;
    }

    this._setCooldown(userId);
    let isTyping = true;
    const sendTyping = () => { if (isTyping) message.channel.sendTyping().catch(() => {}); };
    sendTyping();
    const typingInterval = setInterval(sendTyping, 9000);
    this.activeTyping.set(message.channel.id, typingInterval);

    try {
      const memory = await MemoryService.getUserMemory(userId, guildId, 20);
      const messages = [];

      if (memory && memory.messages && memory.messages.length > 0) {
        for (const msg of memory.messages.slice(-10)) {
          if (msg.role && msg.content) {
            messages.push({ role: msg.role, content: msg.content });
          }
        }
      }

      messages.push({ role: 'user', content: message.content });

      const isFirstMessage = messages.length === 1;

      const result = await AIService.chat(messages, {
        userId,
        guildId,
        type: 'general',
        includeSuggestions: true,
      });

      const responseText = result.content || result || '';
      const suggestions = result.suggestions || [];
      const messageId = Date.now().toString();

      const components = this._buildResponseComponents(suggestions, messageId);
      await this._sendLongMessage(message.channel, responseText, components);

      const dbChat = await AIChat.findOneAndUpdate(
        { channelId: message.channel.id },
        {
          $setOnInsert: { userId, guildId, type: 'general' },
          $push: {
            messages: {
              $each: [
                { role: 'user', content: message.content, timestamp: new Date() },
                { role: 'assistant', content: responseText, timestamp: new Date() },
              ]
            }
          },
          $inc: {
            'usage.promptTokens': result.usage?.promptTokens || 0,
            'usage.completionTokens': result.usage?.completionTokens || 0,
            'usage.totalTokens': result.usage?.totalTokens || 0,
          },
          $set: {
            'metadata.model': result.model || config.groq.model,
            'metadata.responseTime': result.responseTime || 0,
          }
        },
        { upsert: true, new: true }
      );

      if (isFirstMessage) {
         AIService.generateTitle(message.content).then(async title => {
             const cleanTitle = this._sanitizeChannelName(title);
             await message.channel.setName(cleanTitle).catch(()=>{});
             await AIChat.updateOne({ _id: dbChat._id }, { title: cleanTitle });
         });
      }

      MemoryService.invalidateUserCache(userId, guildId);
      return true;
    } catch (error) {
      logger.error('AI Chat message error', { userId, error: error.message });
      try {
        const reply = await message.reply({ content: `❌ ${error.message}` });
        this._setTimeout(() => reply.delete().catch(() => {}), 10000);
      } catch (err) { logger.error('Unhandled error in services/AIChatSessionManager.js', { error: err?.message }) }
      return false;
    } finally {
      isTyping = false;
      const interval = this.activeTyping.get(message.channel.id);
      if (interval) clearInterval(interval);
      this.activeTyping.delete(message.channel.id);
    }
  }

  _buildResponseComponents(suggestions, messageId) {
    if (suggestions && suggestions.length > 0) {
      this.suggestionsCache.set(messageId, suggestions);
      this._setTimeout(() => this.suggestionsCache.delete(messageId), 3600000); // 1 hour cache
    }
    const rows = [];
    if (suggestions && suggestions.length > 0) {
      const suggestRow = new ActionRowBuilder();
      suggestions.forEach((sugg, i) => {
         suggestRow.addComponents(
           new ButtonBuilder()
             .setCustomId(`ai_suggest_${messageId}_${i}`)
             .setLabel(sugg.length > 80 ? sugg.substring(0, 77) + '...' : sugg)
             .setStyle(ButtonStyle.Primary)
         );
      });
      rows.push(suggestRow);
    }
    const feedbackRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ai_feedback_up_${messageId}`).setEmoji('👍').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ai_feedback_down_${messageId}`).setEmoji('👎').setStyle(ButtonStyle.Secondary)
    );
    rows.push(feedbackRow);
    return rows;
  }

  async _sendLongMessage(channel, text, components = []) {
    const maxLen = 2000;
    if (text.length <= maxLen) {
      await channel.send({ content: text, components });
      return;
    }

    const parts = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        parts.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n', maxLen);
      if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', maxLen);
      if (splitAt <= 0) splitAt = maxLen;
      parts.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trim();
    }

    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1 && components.length > 0) {
        await channel.send({ content: parts[i], components });
      } else {
        await channel.send({ content: parts[i] });
      }
    }
  }

  async handleChannelAction(interaction, client, action) {
    const channel = interaction.channel;
    if (!channel?.name?.startsWith('ai-')) return;

    if (action.startsWith('suggest_')) {
      const parts = action.split('_');
      const msgId = parts[1];
      const index = parseInt(parts[2], 10);
      const suggestions = this.suggestionsCache.get(msgId);
      if (!suggestions || !suggestions[index]) {
         return interaction.reply({ content: '❌ انتهت صلاحية هذا الاقتراح.', ephemeral: true });
      }
      const suggestionText = suggestions[index];
      await interaction.reply({ content: `> ${suggestionText}\n` });
      
      const mockMessage = {
         author: interaction.user,
         guild: interaction.guild,
         channel: interaction.channel,
         content: suggestionText,
         reply: async (opts) => interaction.followUp(opts),
      };
      return this.handleMessage(mockMessage);
    }

    if (action.startsWith('feedback_')) {
      const isUp = action.includes('_up_');
      const msgId = action.split('_').pop();
      await interaction.deferReply({ ephemeral: true });
      
      const rating = isUp ? 1 : -1;
      await AIChat.updateOne(
        { channelId: channel.id },
        { $push: { feedback: { messageId: msgId, rating } } }
      );
      
      return interaction.editReply({ content: '✅ شكراً لتقييمك!' });
    }

    if (action === 'export_format') {
      await interaction.deferUpdate();
      const format = interaction.values[0];
      return this._handleExport(interaction, channel, format);
    }

    const normalizedAction = action.replace(/^chat_/, '');

    switch (normalizedAction) {
      case 'pin': {
        await interaction.deferReply({ ephemeral: true });
        const dbChat = await AIChat.findOne({ channelId: channel.id }).lean();
        if (!dbChat) return interaction.editReply({ content: '❌ لا توجد محادثة في قاعدة البيانات.' });
        
        const isPinned = !dbChat.isPinned;
        await AIChat.updateOne({ channelId: channel.id }, { isPinned });
        
        return interaction.editReply({ content: isPinned ? '📌 تم تثبيت المحادثة بنجاح ولن يتم حذفها تلقائياً.' : '📌 تم إلغاء تثبيت المحادثة.' });
      }

      case 'delete':
      case 'close': {
        await interaction.deferReply({ ephemeral: true });
        const userId = this._findChannelOwner(channel);
        if (userId && userId !== interaction.user.id) {
          const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
          if (!member || !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.editReply({ content: '🚫 فقط صاحب المحادثة أو المشرف يمكنه حذفها.' });
          }
        }
        const key = `${userId}:${interaction.guildId}`;
        this.channelMap.delete(key);
        // Nullify channelId to free the unique index slot
        await AIChat.updateMany({ userId, guildId: interaction.guildId }, { $set: { channelId: null } }).catch(() => {});
        await interaction.editReply({ content: '🗑 جاري حذف المحادثة...' });
        this._setTimeout(() => channel.delete().catch(() => {}), 1000);
        break;
      }

      case 'clear': {
        await interaction.deferReply({ ephemeral: true });
        const userId = this._findChannelOwner(channel);
        if (userId) {
          await AIChat.deleteMany({ userId, guildId: interaction.guildId, channelId: channel.id });
          MemoryService.invalidateUserCache(userId, interaction.guildId);
          await AIService.clearHistory(userId, interaction.guildId);
        }
        await interaction.editReply({ content: '✅ تم مسح ذاكرة المحادثة.' });
        await channel.send({ content: '🔄 تم مسح الذاكرة! ابدأ محادثة جديدة.' });
        break;
      }

      case 'export': {
        const { StringSelectMenuBuilder } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
           new StringSelectMenuBuilder()
             .setCustomId('ai_export_format')
             .setPlaceholder('اختر صيغة التصدير')
             .addOptions([
                { label: 'PDF Document', value: 'pdf', emoji: '📄' },
                { label: 'Markdown', value: 'md', emoji: '📝' },
                { label: 'JSON Data', value: 'json', emoji: '🗃️' },
             ])
        );
        return interaction.reply({ content: 'كيف تود تصدير المحادثة؟', components: [row], ephemeral: true });
      }
    }
  }

  async _handleExport(interaction, channel, format) {
    const userId = this._findChannelOwner(channel);
    if (!userId) return interaction.followUp({ content: '❌ لا يمكن العثور على صاحب المحادثة.', ephemeral: true });

    const chat = await AIChat.findOne({ channelId: channel.id }).lean();
    if (!chat || !chat.messages || chat.messages.length === 0) {
      return interaction.followUp({ content: '📭 لا توجد رسائل لتصديرها.', ephemeral: true });
    }

    const totalMessages = chat.messages.length;
    const normalLimit = config.aiChat.normalExportLimit || 300;
    const streamingLimit = config.aiChat.streamingExportLimit || 2000;

    // Tier 1: Normal export (≤300 messages) — direct in-memory
    if (totalMessages <= normalLimit) {
      return this._exportNormal(interaction, chat, format);
    }

    // Tier 2: Streaming export (301-2000 messages) — write to temp file, stream back
    if (totalMessages <= streamingLimit) {
      return this._exportStreaming(interaction, chat, format);
    }

    // Tier 3: Chunked export (>2000 messages) — split into multiple files
    return this._exportChunked(interaction, chat, format);
  }

  async _exportNormal(interaction, chat, format) {
    const result = this._buildExportContent(chat.messages, chat.title, format);
    if (!result) {
      return interaction.followUp({ content: '❌ صيغة غير مدعومة.', ephemeral: true });
    }

    try {
      await interaction.user.send({
        content: `📋 نسخة من محادثة AI: ${chat.title || 'محادثة'} (${chat.messages.length} رسالة)`,
        files: [{ attachment: result.buffer, name: result.filename }],
      });
      await interaction.followUp({ content: '✅ تم إرسال نسخة المحادثة إلى رسائلك الخاصة.', ephemeral: true });
    } catch {
      await interaction.followUp({ content: '❌ لا يمكن إرسال رسالة خاصة. يرجى فتح الرسائل الخاصة.', ephemeral: true });
    }
  }

  async _exportStreaming(interaction, chat, format) {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const ext = format === 'json' ? 'json' : format === 'md' ? 'md' : 'pdf';
    const tmpFile = path.join(os.tmpdir(), `chat-export-${Date.now()}.${ext}`);

    try {
      if (format === 'json') {
        fs.writeFileSync(tmpFile, '[\n', 'utf-8');
        const stream = fs.createWriteStream(tmpFile, { flags: 'a' });
        for (let i = 0; i < chat.messages.length; i++) {
          const comma = i > 0 ? ',' : '';
          stream.write(`${comma}${JSON.stringify(chat.messages[i], null, 2)}\n`);
        }
        stream.write(']');
        await new Promise(resolve => stream.end(resolve));
      } else if (format === 'md') {
        const stream = fs.createWriteStream(tmpFile, { flags: 'a' });
        stream.write(`# ${chat.title || 'AI Chat Transcript'}\n\n`);
        for (const msg of chat.messages) {
          const role = msg.role === 'user' ? '👤 User' : '🤖 AI';
          stream.write(`### ${role}\n${msg.content}\n\n---\n`);
        }
        await new Promise(resolve => stream.end(resolve));
      } else if (format === 'pdf') {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ margin: 50 });
        const writeStream = fs.createWriteStream(tmpFile);
        doc.pipe(writeStream);
        doc.fontSize(20).text(`AI Chat Transcript`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12);
        for (const msg of chat.messages) {
          const role = msg.role === 'user' ? 'User:' : 'AI Assistant:';
          doc.font('Helvetica-Bold').text(role);
          doc.font('Helvetica').text(msg.content);
          doc.moveDown();
        }
        doc.end();
        await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
      }

      const buffer = fs.readFileSync(tmpFile);
      const filename = `chat-${chat.title || 'export'}.${ext}`;

      await interaction.user.send({
        content: `📋 نسخة من محادثة AI: ${chat.title || 'محادثة'} (${chat.messages.length} رسالة)`,
        files: [{ attachment: buffer, name: filename }],
      });
      await interaction.followUp({ content: '✅ تم إرسال نسخة المحادثة إلى رسائلك الخاصة.', ephemeral: true });
    } catch (err) {
      logger.error('Streaming export error', { error: err.message });
      await interaction.followUp({ content: '❌ حدث خطأ أثناء تصدير المحادثة.', ephemeral: true });
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (err) { logger.error('Unhandled error in services/AIChatSessionManager.js', { error: err?.message }) }
    }
  }

  async _exportChunked(interaction, chat, format) {
    const CHUNK_SIZE = 1500;
    const chunks = [];
    for (let i = 0; i < chat.messages.length; i += CHUNK_SIZE) {
      chunks.push(chat.messages.slice(i, i + CHUNK_SIZE));
    }

    await interaction.followUp({
      content: `📋 جاري تصدير ${chat.messages.length} رسالة (${chunks.length} جزء)...`,
      ephemeral: true,
    });

    const ext = format === 'json' ? 'json' : format === 'md' ? 'md' : 'pdf';

    for (let i = 0; i < chunks.length; i++) {
      const result = this._buildExportContent(chunks[i], `${chat.title || 'chat'}_part${i + 1}`, format);
      if (!result) continue;

      try {
        await interaction.user.send({
          content: `📋 الجزء ${i + 1}/${chunks.length} من محادثة AI: ${chat.title || 'محادثة'}`,
          files: [{ attachment: result.buffer, name: `chat-${chat.title || 'export'}_part${i + 1}.${ext}` }],
        });
      } catch {
        await interaction.followUp({
          content: `❌ فشل إرسال الجزء ${i + 1}. يرجى التحقق من الرسائل الخاصة.`,
          ephemeral: true,
        });
        return;
      }
    }

    await interaction.followUp({
      content: `✅ تم إرسال ${chunks.length} أجزاء من المحادثة إلى رسائلك الخاصة.`,
      ephemeral: true,
    });
  }

  _buildExportContent(messages, title, format) {
    if (format === 'json') {
      const data = JSON.stringify(messages, null, 2);
      return { buffer: Buffer.from(data, 'utf-8'), filename: `chat-${title || 'export'}.json` };
    }

    if (format === 'md') {
      let md = `# ${title || 'AI Chat Transcript'}\n\n`;
      for (const msg of messages) {
        const role = msg.role === 'user' ? '👤 User' : '🤖 AI';
        md += `### ${role}\n${msg.content}\n\n---\n`;
      }
      return { buffer: Buffer.from(md, 'utf-8'), filename: `chat-${title || 'export'}.md` };
    }

    if (format === 'pdf') {
      try {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ margin: 50 });
        const docChunks = [];
        doc.on('data', chunk => docChunks.push(chunk));
        doc.fontSize(20).text(`AI Chat Transcript`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12);
        for (const msg of messages) {
          const role = msg.role === 'user' ? 'User:' : 'AI Assistant:';
          doc.font('Helvetica-Bold').text(role);
          doc.font('Helvetica').text(msg.content);
          doc.moveDown();
        }
        doc.end();
        return new Promise(resolve => {
          doc.on('end', () => {
            const buffer = Buffer.concat(docChunks);
            resolve({ buffer, filename: `chat-${title || 'export'}.pdf` });
          });
        });
      } catch {
        return null;
      }
    }

    return null;
  }

  _findChannelOwner(channel) {
    for (const [id, overwrite] of channel.permissionOverwrites.cache) {
      if (overwrite.type === 1 && overwrite.allow.has('ViewChannel') && id !== this.client.user.id) {
        return id;
      }
    }
    return null;
  }

  _checkCooldown(userId) {
    const lastMsg = this.cooldowns.get(userId);
    if (!lastMsg) return 0;
    const elapsed = Date.now() - lastMsg;
    return elapsed < config.aiChat.cooldownMs ? config.aiChat.cooldownMs - elapsed : 0;
  }

  _setCooldown(userId) {
    this.cooldowns.set(userId, Date.now());
  }

  async _cleanupInactiveChannels() {
    try {
      const timeoutMs = config.aiChat.inactivityTimeoutHours * 60 * 60 * 1000;
      const cutoff = Date.now() - timeoutMs;

      for (const guild of this.client.guilds.cache.values()) {
        const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === config.aiChat.categoryName);
        if (!category) continue;

        for (const channel of category.children.cache.values()) {
          if (!channel.name.startsWith('ai-')) continue;

          try {
            const lastMsg = await channel.messages.fetch({ limit: 1 });
            const lastActivity = lastMsg.size > 0 ? lastMsg.first().createdTimestamp : channel.createdTimestamp;

            if (lastActivity && lastActivity < cutoff) {
              const ownerId = this._findChannelOwner(channel);
              const dbChat = await AIChat.findOne({ channelId: channel.id }).lean();
              
              if (dbChat && dbChat.isPinned) {
                // Skip deletion if pinned
                continue;
              }

              if (ownerId) {
                try {
                  const user = await this.client.users.fetch(ownerId);
                  await user.send({ content: `🗑 تم أرشفة قناة AI Chat الخاصة بك في **${guild.name}** بسبب عدم النشاط لأكثر من ${config.aiChat.inactivityTimeoutHours} ساعة.\nلا يزال بإمكانك تصفحها أو تصديرها من لوحة تحكم AI.` }).catch(() => {});
                } catch (err) { logger.error('Unhandled error in services/AIChatSessionManager.js', { error: err?.message }) }
                const key = `${ownerId}:${guild.id}`;
                this.channelMap.delete(key);
                // Nullify channelId to free the unique index slot for future re-creation
                await AIChat.updateMany({ userId: ownerId, guildId: guild.id }, { $set: { channelId: null } }).catch(() => {});
              }
              await channel.delete();
              logger.info('Archived inactive AI channel', { channel: channel.name, guildId: guild.id });
            }
          } catch (err) { logger.error('Unhandled error in services/AIChatSessionManager.js', { error: err?.message }) }
        }
      }
    } catch (err) {
      logger.error('AI channel cleanup error', { error: err.message });
    }
  }

  destroy() {
    if (this._autoCleanup) {
      clearInterval(this._autoCleanup);
      this._autoCleanup = null;
    }
    if (this._cooldownCleanup) {
      clearInterval(this._cooldownCleanup);
      this._cooldownCleanup = null;
    }
    if (this._suggestionsCleanup) {
      clearInterval(this._suggestionsCleanup);
      this._suggestionsCleanup = null;
    }
    for (const id of this._timeouts) clearTimeout(id);
    this._timeouts = [];
    this.suggestionsCache.clear();
    this.channelMap.clear();
    this.cooldowns.clear();
    this.activeTyping.clear();
  }
}

module.exports = AIChatSessionManager;
