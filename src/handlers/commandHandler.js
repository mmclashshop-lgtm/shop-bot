const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { withTimeout, TimeoutError, scheduleAutoDefer } = require('../utils/Timeout');
const { EmbedBuilder, MessageFlags } = require('discord.js');
const MonitorService = require('../services/MonitorService');

const COMMAND_TIMEOUT = 15000;

const COOLDOWN_DURATIONS = {
  storecreate: 3600000,
  productadd: 5000,
  search: 3000,
  ai: 10000,
  ticketcreate: 300000,
  reviewcreate: 30000,
  transfer: 5000,
};

class CommandHandler {
  constructor(client) {
    this.client = client;
    this.commands = new Map();
    this.cooldowns = new Map();
    this._cleanupInterval = null;
  }

  startCleanup(intervalMs = 300000) {
    this._cleanupInterval = setInterval(() => this._cleanupCooldowns(), intervalMs);
  }

  stopCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  _cleanupCooldowns() {
    const now = Date.now();
    for (const [key, expiry] of this.cooldowns.entries()) {
      if (expiry < now) this.cooldowns.delete(key);
    }
  }

  _checkMemoryCooldown(userId, commandName) {
    const ms = COOLDOWN_DURATIONS[commandName.toLowerCase()];
    if (!ms) return false;
    const key = `${userId}:${commandName.toLowerCase()}`;
    const expiry = this.cooldowns.get(key);
    if (expiry && expiry > Date.now()) return Math.ceil((expiry - Date.now()) / 1000);
    return false;
  }

  _setMemoryCooldown(userId, commandName) {
    const ms = COOLDOWN_DURATIONS[commandName.toLowerCase()];
    if (!ms) return;
    const key = `${userId}:${commandName.toLowerCase()}`;
    this.cooldowns.set(key, Date.now() + ms);
  }

  async loadCommands() {
    const commandsPath = path.join(__dirname, '../commands');
    const categories = fs.readdirSync(commandsPath).filter(f => fs.statSync(path.join(commandsPath, f)).isDirectory());

    let loaded = 0;
    let failed = 0;

    for (const category of categories) {
      const categoryPath = path.join(commandsPath, category);
      const commandFiles = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));

      for (const file of commandFiles) {
        try {
          const command = require(path.join(categoryPath, file));
          if (command.data && command.execute) {
            this.commands.set(command.data.name, command);
            loaded++;
          } else {
            logger.warn(`Command missing data or execute: ${file}`);
            failed++;
          }
        } catch (error) {
          logger.error(`Failed to load command: ${file}`, { error: error.message });
          failed++;
        }
      }
    }

    logger.info(`Commands loaded: ${loaded}, Failed: ${failed}`);
    return { loaded, failed };
  }

  getCommand(name) {
    return this.commands.get(name);
  }

  getAllCommands() {
    return Array.from(this.commands.values());
  }

  getCommandsByCategory(category) {
    const commandsPath = path.join(__dirname, `../commands/${category}`);
    if (!fs.existsSync(commandsPath)) return [];

    return fs.readdirSync(commandsPath)
      .filter(f => f.endsWith('.js'))
      .map(f => {
        try {
          return require(path.join(commandsPath, f));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  async handleInteraction(interaction, traceId = '?') {
    if (!interaction.isChatInputCommand()) return;

    const startTime = Date.now();
    const commandName = interaction.commandName;
    const userId = interaction.user.id;

    logger.info('[CMD]', { traceId, event: 'HANDLE_INTERACTION', command: commandName, userId });

    const command = this.commands.get(commandName);
    if (!command) {
      logger.warn('[CMD]', { traceId, event: 'COMMAND_NOT_FOUND', command: commandName });
      return interaction.reply({ content: '❌ أمر غير معروف.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // EARLY DEFER: Guarantees Discord gets ACK within 3 seconds (before MongoDB middleware)
    // This prevents "The application did not respond" when MongoDB is slow/unavailable
    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        logger.info('[CMD]', { traceId, event: 'DEFERRED', command: commandName, elapsed: Date.now() - startTime });
        // Patch deferReply to no-op so commands that also call deferReply don't throw
        interaction.deferReply = async () => {};
      } catch (err) {
        logger.error('[CMD]', { traceId, event: 'DEFER_FAILED', command: commandName, error: err.message });
        try {
          await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة الأمر.', flags: MessageFlags.Ephemeral });
        } catch (replyErr) {
          logger.warn('[CMD]', { traceId, event: 'DEFER_FALLBACK_FAILED', error: replyErr?.message });
        }
        return;
      }
    }

    const { antiSpam, antiScam, checkBan, checkCooldown, setCooldown, logCommand } = require('../middleware/security');

    let cmdSuccess = true;

    try {
      await antiSpam(interaction, async () => {
        logger.info('[CMD]', { traceId, event: 'ANTI_SPAM_PASSED', command: commandName, elapsed: Date.now() - startTime });
        await antiScam(interaction, async () => {
          logger.info('[CMD]', { traceId, event: 'ANTI_SCAM_PASSED', command: commandName, elapsed: Date.now() - startTime });
          await checkBan(interaction, async () => {
            logger.info('[CMD]', { traceId, event: 'CHECK_BAN_PASSED', command: commandName, elapsed: Date.now() - startTime });
            const remaining = this._checkMemoryCooldown(userId, commandName);
            if (remaining) {
              return interaction.editReply({
                content: `⏳ يرجى الانتظار ${remaining} ثانية قبل استخدام هذا الأمر مرة أخرى.`,
              });
            }

            await checkCooldown(interaction, async () => {
              logger.info('[CMD]', { traceId, event: 'CHECK_COOLDOWN_PASSED', command: commandName, elapsed: Date.now() - startTime });
              await logCommand(interaction, async () => {
                logger.info('[CMD]', { traceId, event: 'EXECUTING', command: commandName, elapsed: Date.now() - startTime });
                const deferTimer = scheduleAutoDefer(interaction);
                try {
                  const { promise } = withTimeout(
                    command.execute(interaction, this.client),
                    COMMAND_TIMEOUT,
                    commandName
                  );
                  await promise;
                  logger.info('[CMD]', { traceId, event: 'EXECUTED', command: commandName, elapsed: Date.now() - startTime });
                } finally {
                  if (deferTimer) clearTimeout(deferTimer);
                }
                await setCooldown(interaction, () => Promise.resolve());
                this._setMemoryCooldown(userId, commandName);
              });
            });
          });
        });
      });
    } catch (error) {
      cmdSuccess = false;
      logger.error('[CMD]', { traceId, event: 'COMMAND_FAILED', command: commandName, error: error.message, elapsed: Date.now() - startTime });
      this._handleError(interaction, error, commandName, traceId);
    } finally {
      const duration = Date.now() - startTime;
      MonitorService.trackCommand(commandName, userId, duration, cmdSuccess);
      MonitorService.trackInteraction('command');
    }
  }

  async handleAutocomplete(interaction, traceId = '?') {
    if (!interaction.isAutocomplete()) return;

    const command = this.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;

    try {
      await command.autocomplete(interaction, this.client);
    } catch (error) {
      logger.error('Autocomplete error', {
        command: interaction.commandName,
        error: error.message,
      });
    }
  }

  async _rateLimitInteraction(interaction, type) {
    const key = `rl:${type}:${interaction.user.id}`;
    const now = Date.now();
    const window = 3000;
    const maxPerWindow = 5;

    const existing = this.cooldowns.get(key);
    if (existing) {
      const [count, resetAt] = existing.split(':').map(Number);
      if (now < resetAt) {
        if (count >= maxPerWindow) {
          const retryAfter = Math.ceil((resetAt - now) / 1000);
          const reply = { content: `⏳ يرجى الانتظار ${retryAfter} ثانية قبل استخدام هذا التفاعل.`, flags: MessageFlags.Ephemeral };
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply(reply).catch(() => {});
          } else {
            await interaction.reply(reply).catch(() => {});
          }
          return true;
        }
        this.cooldowns.set(key, `${count + 1}:${resetAt}`);
      } else {
        this.cooldowns.set(key, `1:${now + window}`);
      }
    } else {
      this.cooldowns.set(key, `1:${now + window}`);
    }
    return false;
  }

  async handleModalSubmit(interaction, traceId = '?') {
    console.log('[DIAG] handleModalSubmit ENTERED customId:', interaction.customId, 'deferred:', interaction.deferred);
    if (!interaction.isModalSubmit()) { console.log('[DIAG] Not a modal, returning'); return; }

    const { antiSpam, antiScam } = require('../middleware/security');

    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        logger.info('[CMD]', { traceId, event: 'MODAL_DEFERRED', customId: interaction.customId });
      } catch (err) {
        logger.error('[CMD]', { traceId, event: 'MODAL_DEFER_FAILED', error: err.message, customId: interaction.customId });
        try {
          await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة النموذج.', flags: MessageFlags.Ephemeral });
        } catch (e) { /* interaction expired */ }
        return;
      }
    }

    const limited = await this._rateLimitInteraction(interaction, 'modal');
    if (limited) { console.log('[DIAG] Rate limited, returning'); return; }

    try {
      await antiSpam(interaction, async () => {
        await antiScam(interaction, async () => {
          const cmdEnd = interaction.customId.indexOf('_');
          const commandName = cmdEnd > -1 ? interaction.customId.substring(0, cmdEnd) : interaction.customId;
          const action = cmdEnd > -1 ? interaction.customId.substring(cmdEnd + 1) : '';
          const command = this.commands.get(commandName);
          console.log('[DIAG] Parsed: commandName:', commandName, 'action:', action, 'found:', !!command, 'hasHandleModalSubmit:', command ? !!command.handleModalSubmit : 'N/A');

          const deferTimer = scheduleAutoDefer(interaction);

          if (!command || !command.handleModalSubmit) {
            console.log('[DIAG] Command/handleModalSubmit NOT FOUND');
            logger.warn('[CMD]', { traceId, event: 'MODAL_HANDLER_NOT_FOUND', customId: interaction.customId, commandName });
            if (deferTimer) clearTimeout(deferTimer);
            if (!interaction.deferred && !interaction.replied) {
              try {
                await interaction.reply({ content: '❌ هذا النموذج غير متاح حالياً.', flags: MessageFlags.Ephemeral });
              } catch (e) { /* interaction expired */ }
            }
            return;
          }

          try {
            console.log('[DIAG] Calling command.handleModalSubmit');
            const { promise } = withTimeout(
              command.handleModalSubmit(interaction, this.client, action),
              COMMAND_TIMEOUT,
              `${commandName} modal`
            );
            await promise;
            console.log('[DIAG] command.handleModalSubmit completed successfully');
          } finally {
            if (deferTimer) clearTimeout(deferTimer);
          }
        });
      });
      MonitorService.trackInteraction('modal');
      console.log('[DIAG] handleModalSubmit completed successfully');
    } catch (error) {
      console.log('[DIAG] handleModalSubmit outer catch:', error.message);
      MonitorService.trackError(`${interaction.customId} modal`, error);
      this._handleError(interaction, error, `${interaction.customId} modal`, traceId);
    }
  }

  async handleButtonClick(interaction, traceId = '?') {
    console.log('[DIAG] handleButtonClick ENTERED customId:', interaction.customId, 'deferred:', interaction.deferred);
    if (!interaction.isButton()) { console.log('[DIAG] Not a button, returning'); return; }

    const { antiSpam, antiScam } = require('../middleware/security');

    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferUpdate();
        logger.info('[CMD]', { traceId, event: 'BUTTON_DEFERRED', customId: interaction.customId });
      } catch (err) {
        if (err.message?.includes('already acknowledged') || err.code === 40060) {
          logger.info('[CMD]', { traceId, event: 'BUTTON_ALREADY_ACKNOWLEDGED', customId: interaction.customId });
        } else {
          logger.error('[CMD]', { traceId, event: 'BUTTON_DEFER_FAILED', error: err.message, customId: interaction.customId });
          try {
            await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة الزر.', flags: MessageFlags.Ephemeral });
          } catch (e) { /* interaction expired */ }
          return;
        }
      }
    }

    const limited = await this._rateLimitInteraction(interaction, 'button');
    if (limited) { console.log('[DIAG] Rate limited, returning'); return; }

    try {
      await antiSpam(interaction, async () => {
        await antiScam(interaction, async () => {
          const cmdEnd = interaction.customId.indexOf('_');
          const commandName = cmdEnd > -1 ? interaction.customId.substring(0, cmdEnd) : interaction.customId;
          const action = cmdEnd > -1 ? interaction.customId.substring(cmdEnd + 1) : '';
          const command = this.commands.get(commandName);
          console.log('[DIAG] Parsed: commandName:', commandName, 'action:', action, 'found:', !!command, 'hasHandleButton:', command ? !!command.handleButton : 'N/A');

          const deferTimer = scheduleAutoDefer(interaction);

          if (!command || !command.handleButton) {
            console.log('[DIAG] Command/handleButton NOT FOUND');
            logger.warn('[CMD]', { traceId, event: 'BUTTON_HANDLER_NOT_FOUND', customId: interaction.customId, commandName });
            if (deferTimer) clearTimeout(deferTimer);
            try {
              if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: '❌ هذا الزر غير متاح حالياً.', components: [] }).catch(() => {});
              } else {
                await interaction.reply({ content: '❌ هذا الزر غير متاح حالياً.', flags: MessageFlags.Ephemeral }).catch(() => {});
              }
            } catch (e) { /* interaction expired */ }
            return;
          }

          try {
            console.log('[DIAG] Calling command.handleButton');
            const { promise } = withTimeout(
              command.handleButton(interaction, this.client, action),
              COMMAND_TIMEOUT,
              `${commandName} button`
            );
            await promise;
            console.log('[DIAG] command.handleButton completed successfully');
          } finally {
            if (deferTimer) clearTimeout(deferTimer);
          }
        });
      });
      MonitorService.trackInteraction('button');
      console.log('[DIAG] handleButtonClick completed successfully');
    } catch (error) {
      console.log('[DIAG] handleButtonClick outer catch:', error.message);
      MonitorService.trackError(`${interaction.customId} button`, error);
      this._handleError(interaction, error, `${interaction.customId} button`, traceId);
    }
  }

  async handleSelectMenu(interaction, traceId = '?') {
    console.log('[DIAG] handleSelectMenu ENTERED customId:', interaction.customId, 'deferred:', interaction.deferred);
    if (!interaction.isStringSelectMenu()) { console.log('[DIAG] Not a select menu, returning'); return; }

    const { antiSpam, antiScam } = require('../middleware/security');

    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferUpdate();
        logger.info('[CMD]', { traceId, event: 'SELECT_DEFERRED', customId: interaction.customId });
      } catch (err) {
        if (err.message?.includes('already acknowledged') || err.code === 40060) {
          logger.info('[CMD]', { traceId, event: 'SELECT_ALREADY_ACKNOWLEDGED', customId: interaction.customId });
        } else {
          logger.error('[CMD]', { traceId, event: 'SELECT_DEFER_FAILED', error: err.message, customId: interaction.customId });
          try {
            await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة القائمة.', flags: MessageFlags.Ephemeral });
          } catch (e) { /* interaction expired */ }
          return;
        }
      }
    }

    const limited = await this._rateLimitInteraction(interaction, 'select');
    if (limited) { console.log('[DIAG] Rate limited, returning'); return; }

    try {
      await antiSpam(interaction, async () => {
        await antiScam(interaction, async () => {
          const cmdEnd = interaction.customId.indexOf('_');
          const commandName = cmdEnd > -1 ? interaction.customId.substring(0, cmdEnd) : interaction.customId;
          const action = cmdEnd > -1 ? interaction.customId.substring(cmdEnd + 1) : '';
          const command = this.commands.get(commandName);
          console.log('[DIAG] Parsed: commandName:', commandName, 'action:', action, 'found:', !!command, 'hasHandleSelectMenu:', command ? !!command.handleSelectMenu : 'N/A');

          const deferTimer = scheduleAutoDefer(interaction);

          if (!command || !command.handleSelectMenu) {
            console.log('[DIAG] Command/handleSelectMenu NOT FOUND');
            logger.warn('[CMD]', { traceId, event: 'SELECT_HANDLER_NOT_FOUND', customId: interaction.customId, commandName });
            if (deferTimer) clearTimeout(deferTimer);
            try {
              if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: '❌ هذه القائمة غير متاحة حالياً.', components: [] }).catch(() => {});
              } else {
                await interaction.reply({ content: '❌ هذه القائمة غير متاحة حالياً.', flags: MessageFlags.Ephemeral }).catch(() => {});
              }
            } catch (e) { /* interaction expired */ }
            return;
          }

          try {
            console.log('[DIAG] Calling command.handleSelectMenu');
            const { promise } = withTimeout(
              command.handleSelectMenu(interaction, this.client, action),
              COMMAND_TIMEOUT,
              `${commandName} select`
            );
            await promise;
            console.log('[DIAG] command.handleSelectMenu completed successfully');
          } finally {
            if (deferTimer) clearTimeout(deferTimer);
          }
        });
      });
      MonitorService.trackInteraction('select');
      console.log('[DIAG] handleSelectMenu completed successfully');
    } catch (error) {
      console.log('[DIAG] handleSelectMenu outer catch:', error.message);
      MonitorService.trackError(`${interaction.customId} select`, error);
      this._handleError(interaction, error, `${interaction.customId} select`, traceId);
    }
  }

  _handleError(interaction, error, label, traceId = '?') {
    MonitorService.trackError(label, error);

    if (error?.code === 10062 || error?.name === 'UnknownInteraction') {
      logger.warn('[CMD]', { traceId, event: 'INTERACTION_EXPIRED', label, userId: interaction.user?.id });
      return;
    }

    if (error instanceof TimeoutError) {
      logger.warn('[CMD]', { traceId, event: 'TIMEOUT', label, ms: error.ms });
      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('⏱️ انتهاء المهلة')
        .setDescription('استغرق الأمر أكثر من 15 ثانية. يرجى المحاولة مرة أخرى.')
        .setFooter({ text: `انتهت المهلة بعد ${error.ms / 1000} ثانية` })
        .setTimestamp();
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
      }
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    logger.error('[CMD]', { traceId, event: 'HANDLER_ERROR', label, error: error.message, stack: error.stack, userId: interaction.user?.id });

    const errorMessage = '❌ حدث خطأ أثناء تنفيذ الأمر. يرجى المحاولة لاحقاً.';
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ content: errorMessage, components: [] }).catch(() => {});
    }
    return interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

module.exports = CommandHandler;
