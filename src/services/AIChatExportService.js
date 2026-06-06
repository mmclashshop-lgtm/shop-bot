const { logger } = require('../utils/logger');
const config = require('../config');
const { AIChat } = require('../database/models');

class AIChatExportService {
  constructor(findChannelOwner, client) {
    this._findChannelOwner = findChannelOwner;
    this.client = client;
  }

  async handleExport(interaction, channel, format) {
    const userId = this._findChannelOwner(channel);
    if (!userId) return interaction.followUp({ content: '❌ لا يمكن العثور على صاحب المحادثة.', ephemeral: true });

    const chat = await AIChat.findOne({ channelId: channel.id }).lean();
    if (!chat || !chat.messages || chat.messages.length === 0) {
      return interaction.followUp({ content: '📭 لا توجد رسائل لتصديرها.', ephemeral: true });
    }

    const totalMessages = chat.messages.length;
    const normalLimit = config.aiChat.normalExportLimit || 300;
    const streamingLimit = config.aiChat.streamingExportLimit || 2000;

    if (totalMessages <= normalLimit) {
      return this._exportNormal(interaction, chat, format);
    }

    if (totalMessages <= streamingLimit) {
      return this._exportStreaming(interaction, chat, format);
    }

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
      try { fs.unlinkSync(tmpFile); } catch (err) { logger.error('Unhandled error in services/AIChatExportService.js', { error: err?.message }) }
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
}

module.exports = AIChatExportService;
