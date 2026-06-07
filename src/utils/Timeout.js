const { MessageFlags } = require('discord.js');
const { logger } = require('./logger');

class TimeoutError extends Error {
  constructor(ms, label) {
    super(`Command timed out after ${ms}ms: ${label}`);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
    this.ms = ms;
    this.label = label;
  }
}

function withTimeout(promise, ms, label = 'unknown') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms, label)), ms);
  });
  return {
    promise: Promise.race([promise, timeout]).finally(() => clearTimeout(timer)),
    cancel: () => clearTimeout(timer),
  };
}

const DEFER_TIMEOUT = 2000;

async function autoDefer(interaction) {
  if (interaction.replied || interaction.deferred) return;
  try {
    if (interaction.isChatInputCommand()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      logger.info('[AUTO_DEFER] Deferred ChatInputCommand', { command: interaction.commandName });
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await interaction.deferUpdate();
    } else if (interaction.isModalSubmit()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    logger.warn('[AUTO_DEFER] Failed to auto-defer', { error: err?.message });
  }
}

function scheduleAutoDefer(interaction) {
  if (interaction.replied || interaction.deferred) return null;
  const timer = setTimeout(() => autoDefer(interaction).catch(() => {}), DEFER_TIMEOUT);
  return { timer, interaction };
}

module.exports = { withTimeout, TimeoutError, autoDefer, scheduleAutoDefer, DEFER_TIMEOUT };
