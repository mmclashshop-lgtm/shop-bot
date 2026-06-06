const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const { logger } = require('../utils/logger');
const { User } = require('../database/models');
const rateLimiter = require('../cache/RateLimiter');

function safeReply(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(content).catch(() => {});
  }
  return interaction.reply(content).catch(() => {});
}

const userCache = new Map();
const CACHE_TTL = 60000;

// Periodic cleanup of expired cache entries
setInterval(() => {
  try {
    const now = Date.now();
    for (const [discordId, cached] of userCache.entries()) {
      if (now - cached.ts >= CACHE_TTL * 2) {
        userCache.delete(discordId);
      }
    }
  } catch (err) { logger.error('Unhandled error in middleware/security.js', { error: err?.message }) }
}, 120000);

function getCachedUser(discordId) {
  const cached = userCache.get(discordId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  return null;
}

function setCachedUser(discordId, data) {
  userCache.set(discordId, { data, ts: Date.now() });
}

function invalidateCachedUser(discordId) {
  userCache.delete(discordId);
}

async function findCachedUser(discordId) {
  const cached = getCachedUser(discordId);
  if (cached) return cached;
  const user = await User.findOne({ discordId }).lean();
  if (user) setCachedUser(discordId, user);
  return user;
}

async function antiSpam(interaction, next) {
  const userId = interaction.user.id;
  let type = 'command';
  if (interaction.isModalSubmit()) type = 'modal';
  else if (interaction.isButton()) type = 'button';
  else if (interaction.isStringSelectMenu()) type = 'select';

  const points = type === 'command' ? 1 : 2;
  const limiterName = type === 'command' ? 'global' : `interaction:${type}`;

  try {
    await rateLimiter.consume(`spam:${userId}:${type}`, points, limiterName);
    return next();
  } catch (error) {
    if (error?.msBeforeNext !== undefined) {
      logger.warn('[SECURITY] Anti-spam triggered', { userId, type });

      const userData = await findCachedUser(userId).catch(() => null);
      const warningCount = (userData?.warnings?.length || 0) + 1;

      if (warningCount >= (config.security?.maxWarnings || 5)) {
        await User.findOneAndUpdate(
          { discordId: userId },
          { $set: { isBanned: true, banReason: 'تجاوز حد التحذيرات - سبام' } }
        ).catch(() => {});
        invalidateCachedUser(userId);

        return safeReply(interaction, { content: '🚫 تم حظرك بسبب تكرار السبام. تواصل مع الإدارة للمراجعة.', flags: MessageFlags.Ephemeral });
      }

      return safeReply(interaction, { content: `⚠️ تحذير ${warningCount}/${config.security?.maxWarnings || 5}: يرجى التبطؤ في استخدام الأوامر.`, flags: MessageFlags.Ephemeral });
    }

    return next();
  }
}

async function antiScam(interaction, next) {
  let content = JSON.stringify(interaction.options?.data || {}).toLowerCase();

  if (interaction.isModalSubmit()) {
    interaction.fields?.fields?.forEach(field => {
      content += ' ' + field.value.toLowerCase();
    });
  }

  if (interaction.isMessageComponent()) {
    content += ' ' + (interaction.customId || '').toLowerCase();
  }

  if (interaction.isButton()) {
    content += ' ' + (interaction.component?.label || '').toLowerCase();
  }

  if (interaction.isStringSelectMenu()) {
    const vals = interaction.values || [];
    content += ' ' + vals.join(' ').toLowerCase();
  }

  for (const keyword of config.security.scamKeywords) {
    if (content.includes(keyword.toLowerCase())) {
      logger.warn('[SECURITY] Anti-scam triggered', { userId: interaction.user.id, keyword });

      await User.findOneAndUpdate(
        { discordId: interaction.user.id },
        { $push: { warnings: { reason: `محاولة احتيال محتملة: ${keyword}`, issuedBy: 'system', issuedAt: new Date() } } }
      ).catch(() => {});
      invalidateCachedUser(interaction.user.id);

      return safeReply(interaction, {
        content: '🚫 تم اكتشاف محتوى مشبوه. تم تسجيل المحاولة.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  return next();
}

async function checkBan(interaction, next) {
  const user = await findCachedUser(interaction.user.id).catch(() => null);
  if (user?.isBanned) {
    logger.info('[SECURITY] Banned user blocked', { userId: interaction.user.id, reason: user.banReason });
    return safeReply(interaction, {
      content: `🚫 أنت محظور من استخدام البوت.\nالسبب: ${user.banReason || 'غير محدد'}\nتواصل مع الإدارة للمراجعة.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  return next();
}

const cooldownMap = {
  storecreate: 'storeCreate',
  productadd: 'productAdd',
  search: 'search',
  ai: 'ai',
  ticketcreate: 'ticketCreate',
  reviewcreate: 'reviewCreate',
  transfer: 'transfer',
};

async function checkCooldown(interaction, next) {
  const user = await findCachedUser(interaction.user.id).catch(() => null);
  if (!user) return next();

  const commandKey = cooldownMap[interaction.commandName.toLowerCase()];
  if (!commandKey) return next();

  const cooldownUntil = user.cooldowns?.[commandKey];
  if (cooldownUntil && new Date(cooldownUntil) > new Date()) {
    const remaining = Math.ceil((new Date(cooldownUntil) - new Date()) / 1000);
    logger.info('[SECURITY] Cooldown active', { userId: interaction.user.id, command: interaction.commandName, remaining });
    return safeReply(interaction, {
      content: `⏳ يرجى الانتظار ${remaining} ثانية قبل استخدام هذا الأمر مرة أخرى.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  return next();
}

const cooldownDurations = {
  storeCreate: config.limits.cooldowns.storeCreate,
  productAdd: config.limits.cooldowns.productAdd,
  search: config.limits.cooldowns.search,
  ai: config.limits.cooldowns.ai,
  ticketCreate: config.limits.cooldowns.ticketCreate,
  reviewCreate: 30000,
  transfer: 5000,
};

async function setCooldown(interaction, next) {
  const result = await next();

  const commandKey = cooldownMap[interaction.commandName.toLowerCase()];
  if (!commandKey) return result;

  const ms = cooldownDurations[commandKey];
  if (ms) {
    await User.findOneAndUpdate(
      { discordId: interaction.user.id },
      { $set: { [`cooldowns.${commandKey}`]: new Date(Date.now() + ms) } }
    );
    invalidateCachedUser(interaction.user.id);
  }

  return result;
}

async function validateOwnership(interaction, next) {
  const subcommand = interaction.options.getSubcommand();
  const protectedCommands = ['edit', 'delete', 'stats'];

  if (!protectedCommands.includes(subcommand)) return next();

  const storeId = interaction.options.getString('store_id') || interaction.options.getString('id');
  if (!storeId) return next();

  const { Store } = require('../database/models');
  const store = await Store.findById(storeId).lean();

  if (!store) {
    return safeReply(interaction, {
      content: '❌ المتجر غير موجود.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (store.ownerId !== interaction.user.id) {
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) {
      return safeReply(interaction, {
        content: '🚫 غير مصرح: يمكنك إدارة متاجرك فقط.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  return next();
}

async function validateStoreActive(interaction, next) {
  const storeId = interaction.options.getString('store_id') || interaction.options.getString('id');
  if (!storeId) return next();

  const { Store } = require('../database/models');
  const store = await Store.findById(storeId).lean();

  if (!store || !store.isActive || store.isSuspended) {
    return safeReply(interaction, {
      content: '🚫 المتجر غير نشط أو موقوف.',
      flags: MessageFlags.Ephemeral,
    });
  }

  return next();
}

async function logCommand(interaction, next) {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;

  logger.info('[CMD] Command executed', {
    command: interaction.commandName,
    subcommand: interaction.options.getSubcommand(false),
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    duration,
  });

  return result;
}

module.exports = {
  antiSpam,
  antiScam,
  checkBan,
  checkCooldown,
  setCooldown,
  validateOwnership,
  validateStoreActive,
  logCommand,
  invalidateCachedUser,
};
