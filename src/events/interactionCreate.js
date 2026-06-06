const { logger } = require('../utils/logger');
const { EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    const traceId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const startTime = Date.now();
    const type = interaction.constructor.name;
    const identifier = interaction.commandName || interaction.customId || 'unknown';
    const userId = interaction.user?.id || 'unknown';
    const guildId = interaction.guildId || 'unknown';

    logger.info('[TRACE]', { traceId, event: 'INTERACTION_RECEIVED', type, identifier, userId, guildId });

    // Patch interaction response methods to track whether a response was sent
    const _origReply = interaction.reply.bind(interaction);
    const _origDeferReply = interaction.deferReply.bind(interaction);
    const _origEditReply = interaction.editReply.bind(interaction);
    const _origFollowUp = interaction.followUp.bind(interaction);
    const _origDeferUpdate = interaction.deferUpdate.bind(interaction);

    let responded = false;
    const track = (fn, label) => async (...args) => {
      const was = responded;
      const r = await fn(...args);
      if (!was) {
        responded = true;
        logger.info('[TRACE]', { traceId, event: 'FIRST_RESPONSE', method: label, identifier });
      }
      return r;
    };

    interaction.reply = track(_origReply, 'reply');
    interaction.deferReply = track(_origDeferReply, 'deferReply');
    interaction.editReply = track(_origEditReply, 'editReply');
    interaction.followUp = track(_origFollowUp, 'followUp');
    interaction.deferUpdate = track(_origDeferUpdate, 'deferUpdate');

    // Force early defer for ALL interaction types before routing to handler
    try {
      if (interaction.isChatInputCommand()) {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          logger.info('[TRACE]', { traceId, event: 'CHAT_INPUT_DEFERRED', identifier });
          interaction.deferReply = async () => {};
        }
      } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferUpdate();
          logger.info('[TRACE]', { traceId, event: 'COMPONENT_DEFERRED', identifier });
        }
      } else if (interaction.isModalSubmit()) {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          logger.info('[TRACE]', { traceId, event: 'MODAL_DEFERRED', identifier });
        }
      }
    } catch (err) {
      logger.error('[TRACE]', { traceId, event: 'EARLY_DEFER_FAILED', error: err.message, identifier });
      try {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.reply({ content: '❌ حدث خطأ، يرجى المحاولة مرة أخرى.', flags: MessageFlags.Ephemeral });
          logger.info('[TRACE]', { traceId, event: 'DEFER_FALLBACK_OK' });
        }
      } catch (e2) {
        logger.error('[TRACE]', { traceId, event: 'DEFER_FALLBACK_FAILED', error: e2.message });
      }
    }

    // Route to the appropriate handler
    try {
      if (interaction.isChatInputCommand()) {
        await client.commands.handleInteraction(interaction, traceId);
      } else if (interaction.isModalSubmit()) {
        await client.commands.handleModalSubmit(interaction, traceId);
      } else if (interaction.isButton()) {
        await client.commands.handleButtonClick(interaction, traceId);
      } else if (interaction.isStringSelectMenu()) {
        await client.commands.handleSelectMenu(interaction, traceId);
      } else if (interaction.isAutocomplete()) {
        await client.commands.handleAutocomplete(interaction, traceId);
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;
      logger.error('[TRACE]', {
        traceId, event: 'HANDLER_THREW', error: error.message,
        code: error.code, name: error.name, identifier, type, elapsed,
        responded,
      });

      if (error.code === 10062 || error.name === 'UnknownInteraction') {
        logger.warn('[TRACE]', { traceId, event: 'INTERACTION_EXPIRED', identifier });
      } else if (error.code === 10060 || error.message?.includes('Already replied')) {
        logger.warn('[TRACE]', { traceId, event: 'ALREADY_REPLIED', identifier });
      } else if (!responded) {
        try {
          const errorEmbed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('❌ خطأ')
            .setDescription('حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.')
            .setTimestamp();
          if (interaction.isButton() || interaction.isStringSelectMenu()) {
            await interaction.deferUpdate();
            await interaction.editReply({ embeds: [errorEmbed], components: [] });
          } else {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
          }
          logger.info('[TRACE]', { traceId, event: 'EMERGENCY_RESPONSE_SENT' });
        } catch (e3) {
          logger.error('[TRACE]', { traceId, event: 'EMERGENCY_RESPONSE_FAILED', error: e3.message });
        }
      }
    } finally {
      const elapsed = Date.now() - startTime;
      const finalResponded = responded || interaction.replied || interaction.deferred;
      if (!finalResponded) {
        logger.error('[TRACE]', {
          traceId, event: 'EXIT_WITHOUT_RESPONSE', type, identifier, userId,
          handler: 'interactionCreate', function: 'execute', elapsed,
          rootCause: 'All response paths failed. Interaction may have expired (10062) or Discord API was unreachable.',
        });
      }
      logger.info('[TRACE]', {
        traceId, event: 'INTERACTION_HANDLED', type, identifier, userId,
        elapsed, responded: finalResponded,
      });
    }
  },
};
