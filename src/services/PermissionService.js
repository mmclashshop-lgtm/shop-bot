const { PermissionFlagsBits } = require('discord.js');
const { Role } = require('../database/models');
const { logger } = require('../utils/logger');

const PERMISSION_LEVELS = {
  BLOCKED:  0,
  USER:    10,
  MEMBER:  20,
  SUPPORT: 30,
  MOD:     40,
  ADMIN:   50,
  OWNER:   60,
  SYSTEM: 100,
};

const PERMISSIONS = {
  // User permissions
  MARKET_VIEW:     'market:view',
  PROFILE_VIEW:    'profile:view',
  CHAT_AI:         'chat:ai',

  // Member permissions
  STORE_CREATE:    'store:create',
  PRODUCT_CREATE:  'product:create',
  SERVICE_CREATE:  'service:create',
  REVIEW_CREATE:   'review:create',
  ORDER_CREATE:    'order:create',
  WALLET_VIEW:     'wallet:view',
  WITHDRAW:        'wallet:withdraw',
  TRANSFER:        'wallet:transfer',

  // Support permissions
  TICKET_VIEW:     'ticket:view',
  TICKET_REPLY:    'ticket:reply',
  USER_LOOKUP:     'user:lookup',

  // Mod permissions
  TICKET_MANAGE:   'ticket:manage',
  REVIEW_MODERATE: 'review:moderate',
  COUPON_CREATE:   'coupon:create',
  COUPON_MANAGE:   'coupon:manage',
  FRAUD_VIEW:      'fraud:view',
  TRUST_MANAGE:    'trust:manage',
  LOYALTY_MANAGE:  'loyalty:manage',

  // Admin permissions
  STORE_MANAGE:    'store:manage',
  PRODUCT_MANAGE:  'product:manage',
  SERVICE_MANAGE:  'service:manage',
  SETTINGS_VIEW:   'settings:view',
  SETTINGS_MANAGE: 'settings:manage',
  WITHDRAW_APPROVE:'wallet:approve',
  PAYMENT_VIEW:    'payment:view',
  PAYMENT_MANAGE:  'payment:manage',
  TAX_MANAGE:      'tax:manage',
  BACKUP_MANAGE:   'backup:manage',
  DASHBOARD_VIEW:  'dashboard:view',
  MONITOR_VIEW:    'monitor:view',
  ALERT_MANAGE:    'alert:manage',
  AUDIT_LOG:       'audit:log',

  // Owner permissions
  OWNER_MANAGE:    'owner:manage',
  SYSTEM_CONFIG:   'system:config',
};

const PERMISSION_LEVEL_MAP = {
  [PERMISSIONS.MARKET_VIEW]:     PERMISSION_LEVELS.USER,
  [PERMISSIONS.PROFILE_VIEW]:    PERMISSION_LEVELS.USER,
  [PERMISSIONS.CHAT_AI]:         PERMISSION_LEVELS.USER,
  [PERMISSIONS.STORE_CREATE]:    PERMISSION_LEVELS.MEMBER,
  [PERMISSIONS.PRODUCT_CREATE]:  PERMISSION_LEVELS.MEMBER,
  [PERMISSIONS.SERVICE_CREATE]:  PERMISSION_LEVELS.MEMBER,
  [PERMISSIONS.REVIEW_CREATE]:   PERMISSION_LEVELS.MEMBER,
  [PERMISSIONS.ORDER_CREATE]:    PERMISSION_LEVELS.MEMBER,
  [PERMISSIONS.WALLET_VIEW]:     PERMISSION_LEVELS.MEMBER,
  [PERMISSIONS.WITHDRAW]:        PERMISSION_LEVELS.MEMBER,
  [PERMISSIONS.TRANSFER]:        PERMISSION_LEVELS.MEMBER,
  [PERMISSIONS.TICKET_VIEW]:     PERMISSION_LEVELS.SUPPORT,
  [PERMISSIONS.TICKET_REPLY]:    PERMISSION_LEVELS.SUPPORT,
  [PERMISSIONS.USER_LOOKUP]:     PERMISSION_LEVELS.SUPPORT,
  [PERMISSIONS.TICKET_MANAGE]:   PERMISSION_LEVELS.MOD,
  [PERMISSIONS.REVIEW_MODERATE]: PERMISSION_LEVELS.MOD,
  [PERMISSIONS.COUPON_CREATE]:   PERMISSION_LEVELS.MOD,
  [PERMISSIONS.COUPON_MANAGE]:   PERMISSION_LEVELS.MOD,
  [PERMISSIONS.FRAUD_VIEW]:      PERMISSION_LEVELS.MOD,
  [PERMISSIONS.TRUST_MANAGE]:    PERMISSION_LEVELS.MOD,
  [PERMISSIONS.LOYALTY_MANAGE]:  PERMISSION_LEVELS.MOD,
  [PERMISSIONS.STORE_MANAGE]:    PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.PRODUCT_MANAGE]:  PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.SERVICE_MANAGE]:  PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.SETTINGS_VIEW]:   PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.SETTINGS_MANAGE]: PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.WITHDRAW_APPROVE]:PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.PAYMENT_VIEW]:    PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.PAYMENT_MANAGE]:  PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.TAX_MANAGE]:      PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.BACKUP_MANAGE]:   PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.DASHBOARD_VIEW]:  PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.MONITOR_VIEW]:    PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.ALERT_MANAGE]:    PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.AUDIT_LOG]:       PERMISSION_LEVELS.ADMIN,
  [PERMISSIONS.OWNER_MANAGE]:    PERMISSION_LEVELS.OWNER,
  [PERMISSIONS.SYSTEM_CONFIG]:   PERMISSION_LEVELS.OWNER,
};

class PermissionError extends Error {
  constructor(permission, level) {
    super(`Missing permission: ${permission} (required level: ${level})`);
    this.name = 'PermissionError';
    this.permission = permission;
    this.requiredLevel = level;
  }
}

class PermissionService {
  constructor() {
    this._roleCache = new Map();
    this._cacheCleanup = setInterval(() => this._roleCache.clear(), 300000);
  }

  destroy() {
    if (this._cacheCleanup) clearInterval(this._cacheCleanup);
    this._roleCache.clear();
  }

  get levels() { return PERMISSION_LEVELS; }
  get perms() { return PERMISSIONS; }

  async ensureDefaultRoles(guildId) {
    const existing = await Role.countDocuments({ guildId });
    if (existing > 0) return;

    const defaults = [
      { name: 'المالك', level: PERMISSION_LEVELS.OWNER, permissions: Object.values(PERMISSIONS), color: '#FFD700', isDefault: false },
      { name: 'مدير', level: PERMISSION_LEVELS.ADMIN, permissions: this._permsForLevel(PERMISSION_LEVELS.ADMIN), color: '#E74C3C', isDefault: false },
      { name: 'مشرف', level: PERMISSION_LEVELS.MOD, permissions: this._permsForLevel(PERMISSION_LEVELS.MOD), color: '#3498DB', isDefault: false },
      { name: 'دعم', level: PERMISSION_LEVELS.SUPPORT, permissions: this._permsForLevel(PERMISSION_LEVELS.SUPPORT), color: '#2ECC71', isDefault: false },
      { name: 'عضو', level: PERMISSION_LEVELS.MEMBER, permissions: this._permsForLevel(PERMISSION_LEVELS.MEMBER), color: '#99AAB5', isDefault: true },
      { name: 'مستخدم', level: PERMISSION_LEVELS.USER, permissions: this._permsForLevel(PERMISSION_LEVELS.USER), color: '#95A5A6', isDefault: false },
    ];

    await Role.insertMany(defaults.map(r => ({ ...r, guildId })));
    logger.info('Default roles created', { guildId });
  }

  async getUserLevel(interaction) {
    if (!interaction.guild) return PERMISSION_LEVELS.USER;
    if (interaction.user.id === interaction.guild.ownerId) return PERMISSION_LEVELS.OWNER;

    const guildId = interaction.guild.id;
    const member = interaction.member;

    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return PERMISSION_LEVELS.ADMIN;
    }

    const roles = await this._getGuildRoles(guildId);

    let highestLevel = PERMISSION_LEVELS.USER;
    for (const role of roles) {
      if (!role.discordRoleId) {
        if (role.isDefault) highestLevel = Math.max(highestLevel, role.level);
        continue;
      }
      if (member.roles.cache.has(role.discordRoleId)) {
        highestLevel = Math.max(highestLevel, role.level);
      }
    }

    return highestLevel;
  }

  async hasPermission(interaction, permission) {
    const requiredLevel = PERMISSION_LEVEL_MAP[permission];
    if (requiredLevel === undefined) return false;
    if (requiredLevel <= PERMISSION_LEVELS.USER) return true;

    const userLevel = await this.getUserLevel(interaction);
    return userLevel >= requiredLevel;
  }

  async requirePermission(interaction, permission) {
    const has = await this.hasPermission(interaction, permission);
    if (!has) {
      const requiredLevel = PERMISSION_LEVEL_MAP[permission] || PERMISSION_LEVELS.ADMIN;
      throw new PermissionError(permission, requiredLevel);
    }
    return true;
  }

  getRequiredLevel(permission) {
    return PERMISSION_LEVEL_MAP[permission] || PERMISSION_LEVELS.ADMIN;
  }

  getLevelName(level) {
    const names = {
      [PERMISSION_LEVELS.BLOCKED]: 'محظور',
      [PERMISSION_LEVELS.USER]: 'مستخدم',
      [PERMISSION_LEVELS.MEMBER]: 'عضو',
      [PERMISSION_LEVELS.SUPPORT]: 'دعم',
      [PERMISSION_LEVELS.MOD]: 'مشرف',
      [PERMISSION_LEVELS.ADMIN]: 'مدير',
      [PERMISSION_LEVELS.OWNER]: 'مالك',
      [PERMISSION_LEVELS.SYSTEM]: 'نظام',
    };
    return names[level] || 'غير معروف';
  }

  createPermissionGuard(permission) {
    return async (interaction, next) => {
      try {
        await this.requirePermission(interaction, permission);
        return next();
      } catch (err) {
        if (err instanceof PermissionError) {
          const levelName = this.getLevelName(this.getRequiredLevel(permission));
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: `🚫 لا تملك الصلاحية المطلوبة. هذا الأمر يتطلب صلاحية **${levelName}**.` });
          } else {
            await interaction.reply({ content: `🚫 لا تملك الصلاحية المطلوبة. هذا الأمر يتطلب صلاحية **${levelName}**.`, ephemeral: true });
          }
          return;
        }
        throw err;
      }
    };
  }

  async getEffectivePermissions(interaction) {
    const level = await this.getUserLevel(interaction);
    return this._permsForLevel(level);
  }

  async addRole(guildId, name, level, discordRoleId = null) {
    const role = await Role.create({
      guildId, name, level,
      permissions: this._permsForLevel(level),
      discordRoleId,
    });
    this._roleCache.delete(guildId);
    return role;
  }

  async updateRole(roleId, updates) {
    const role = await Role.findByIdAndUpdate(roleId, { ...updates, updatedAt: new Date() }, { new: true });
    if (role) this._roleCache.delete(role.guildId);
    return role;
  }

  async removeRole(roleId) {
    const role = await Role.findById(roleId);
    if (role) {
      await Role.deleteOne({ _id: roleId });
      this._roleCache.delete(role.guildId);
    }
  }

  async listRoles(guildId) {
    return Role.find({ guildId }).sort({ level: -1 }).lean();
  }

  async getMemberEffectiveRoles(interaction) {
    const guildId = interaction.guild.id;
    const member = interaction.member;
    const roles = await this._getGuildRoles(guildId);
    const memberRoles = [];

    for (const role of roles) {
      if (!role.discordRoleId && role.isDefault) {
        memberRoles.push(role);
      } else if (role.discordRoleId && member.roles.cache.has(role.discordRoleId)) {
        memberRoles.push(role);
      }
    }

    return memberRoles.sort((a, b) => b.level - a.level);
  }

  _permsForLevel(level) {
    return Object.entries(PERMISSION_LEVEL_MAP)
      .filter(([, l]) => l <= level)
      .map(([perm]) => perm);
  }

  async _getGuildRoles(guildId) {
    const cached = this._roleCache.get(guildId);
    if (cached) return cached;

    const roles = await Role.find({ guildId }).sort({ level: -1 }).lean();
    this._roleCache.set(guildId, roles);
    return roles;
  }
}

module.exports = new PermissionService();
module.exports.PermissionError = PermissionError;
module.exports.PERMISSIONS = PERMISSIONS;
module.exports.PERMISSION_LEVELS = PERMISSION_LEVELS;
