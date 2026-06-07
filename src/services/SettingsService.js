const crypto = require('crypto');
const { ServerSettings, SettingsHistory } = require('../database/models');
const { logger } = require('../utils/logger');
const AuditService = require('./AuditService');

const VALID_SECTIONS = [
  'ai', 'marketplace', 'commissions', 'wallet', 'payment', 'withdraw',
  'fraud', 'security', 'backup', 'alert', 'monitor', 'ticket',
  'loyalty', 'trust', 'roles', 'log',
];

const SECTION_NAMES = {
  ai: '🤖 AI', marketplace: '🏪 Marketplace', commissions: '💰 Commissions',
  wallet: '👛 Wallet', payment: '💳 Payment', withdraw: '🏧 Withdraw',
  fraud: '🚨 Fraud', security: '🔒 Security', backup: '💾 Backup',
  alert: '⚠️ Alert', monitor: '📊 Monitor', ticket: '🎫 Ticket',
  loyalty: '⭐ Loyalty', trust: '🏆 Trust', roles: '👥 Roles', log: '📝 Log',
};

const PRIORITY_SECTIONS = ['security', 'fraud', 'payment', 'withdraw'];

const VALIDATORS = {
  enabled:           v => typeof v === 'boolean',
  autoUpdate:        v => typeof v === 'boolean',
  showStats:         v => typeof v === 'boolean',
  rateLimitWarnings: v => typeof v === 'boolean',
  allowNegativeBalance: v => typeof v === 'boolean',
  antiSpam:          v => typeof v === 'boolean',
  antiScam:          v => typeof v === 'boolean',
  notifyOnFailure:   v => typeof v === 'boolean',
  notifyOnSuccess:   v => typeof v === 'boolean',
  autoVerify:        v => typeof v === 'boolean',
  notifyOnCritical:  v => typeof v === 'boolean',
  notifyOnHigh:      v => typeof v === 'boolean',
  notifyOnMedium:    v => typeof v === 'boolean',
  notifyOnLow:       v => typeof v === 'boolean',
  trackCommands:     v => typeof v === 'boolean',
  trackInteractions: v => typeof v === 'boolean',
  trackPayments:     v => typeof v === 'boolean',
  requireReason:     v => typeof v === 'boolean',
  allowAttachments:  v => typeof v === 'boolean',
  requireApproval:   v => typeof v === 'boolean',
  autoAssignVerified: v => typeof v === 'boolean',
  autoAssignPremium:  v => typeof v === 'boolean',
  logCommands:       v => typeof v === 'boolean',
  logErrors:         v => typeof v === 'boolean',
  logPayments:       v => typeof v === 'boolean',
  logWithdrawals:    v => typeof v === 'boolean',
  logFraud:          v => typeof v === 'boolean',
  logModActions:     v => typeof v === 'boolean',
  logBackups:        v => typeof v === 'boolean',
  logAlerts:         v => typeof v === 'boolean',
  autoConfirmEnabled: v => typeof v === 'boolean',
  suspiciousIpCheck: v => typeof v === 'boolean',
  duplicateAccountCheck: v => typeof v === 'boolean',
  rapidTransactionCheck: v => typeof v === 'boolean',
  notifyOnDetection: v => typeof v === 'boolean',
};

const DEFAULT_MODEL = new ServerSettings();

class SettingsService {
  async getGuildSettings(guildId) {
    let settings = await ServerSettings.findOne({ guildId }).lean();
    if (!settings) {
      settings = await ServerSettings.create({ guildId });
      settings = settings.toObject();
    }
    return settings;
  }

  async getSection(guildId, section) {
    if (!VALID_SECTIONS.includes(section)) throw new Error(`Invalid section: ${section}`);
    const settings = await this.getGuildSettings(guildId);
    return settings[section] || {};
  }

  async getKey(guildId, section, key) {
    const sectionData = await this.getSection(guildId, section);
    if (!(key in sectionData)) throw new Error(`Unknown key '${key}' in section '${section}'`);
    return sectionData[key];
  }

  validate(section, key, value, label) {
    if (!VALID_SECTIONS.includes(section)) return { valid: false, error: `Invalid section: ${section}` };

    const validator = VALIDATORS[key];
    if (validator && !validator(value)) {
      return { valid: false, error: `'${label}' must be a boolean` };
    }

    const defaults = this._getDefaultValue(section, key);
    if (defaults === undefined) return { valid: false, error: `Unknown setting: ${section}.${key}` };

    if (typeof defaults === 'number') {
      const num = Number(value);
      if (isNaN(num)) return { valid: false, error: `'${label}' must be a number` };

      const constraints = this._getConstraints(section, key);
      if (constraints) {
        if (constraints.min !== undefined && num < constraints.min) {
          return { valid: false, error: `'${label}' minimum is ${constraints.min}` };
        }
        if (constraints.max !== undefined && num > constraints.max) {
          return { valid: false, error: `'${label}' maximum is ${constraints.max}` };
        }
      }
      return { valid: true, value: num };
    }

    if (typeof defaults === 'boolean') {
      if (typeof value === 'boolean') return { valid: true, value };
      if (value === 'true' || value === '1') return { valid: true, value: true };
      if (value === 'false' || value === '0') return { valid: true, value: false };
      return { valid: false, error: `'${label}' must be true/false` };
    }

    if (typeof defaults === 'string') {
      const strVal = String(value);
      const enumValues = this._getEnumValues(section, key);
      if (enumValues && !enumValues.includes(strVal)) {
        return { valid: false, error: `'${label}' must be one of: ${enumValues.join(', ')}` };
      }
      return { valid: true, value: strVal };
    }

    return { valid: true, value };
  }

  async set(guildId, section, key, value, changedBy = 'system', options = {}) {
    const label = options.label || key;

    const validation = this.validate(section, key, value, label);
    if (!validation.valid) throw new Error(validation.error);

    const settings = await ServerSettings.findOne({ guildId }).lean();
    if (!settings) {
      await ServerSettings.create({ guildId });
    }

    const currentSettings = await ServerSettings.findOne({ guildId }).lean();
    let sectionData = currentSettings[section];
    if (!sectionData) {
      sectionData = {};
      currentSettings[section] = sectionData;
    }

    const oldValue = sectionData[key];
    const oldSectionSnapshot = JSON.parse(JSON.stringify(currentSettings[section]));

    if (oldValue !== undefined) {
      const path = `${section}.${key}`;
      const backupRequired = PRIORITY_SECTIONS.includes(section);

      await SettingsHistory.create({
        guildId,
        changeId: `chg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        section,
        key,
        oldValue,
        newValue: validation.value,
        changedBy,
        changedByTag: options.userTag || '',
        reason: options.reason || '',
        version: (currentSettings.version || 1),
        backup: backupRequired ? oldSectionSnapshot : null,
      });

      sectionData[key] = validation.value;
      currentSettings.version = (currentSettings.version || 1) + 1;
      await currentSettings.save();

      logger.info('Setting changed', { guildId, section, key, from: oldValue, to: validation.value, by: changedBy });

      AuditService.log('settings_changed', changedBy, {
        guildId,
        targetType: 'settings',
        details: { section, key, oldValue, newValue: validation.value, reason: options.reason },
      });

      return { oldValue, newValue: validation.value, version: currentSettings.version };
    }

    sectionData[key] = validation.value;
    currentSettings.version = (currentSettings.version || 1) + 1;
    await currentSettings.save();

    await SettingsHistory.create({
      guildId,
      changeId: `chg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      section, key,
      oldValue: null,
      newValue: validation.value,
      changedBy,
      changedByTag: options.userTag || '',
      reason: options.reason || '',
      version: currentSettings.version,
    });

    logger.info('Setting initialized', { guildId, section, key, value: validation.value, by: changedBy });
    return { oldValue: null, newValue: validation.value, version: currentSettings.version };
  }

  async rollback(guildId, changeId, rolledBackBy = 'system') {
    const change = await SettingsHistory.findOne({ changeId, guildId }).lean();
    if (!change) throw new Error(`Change not found: ${changeId}`);

    const result = await this.set(guildId, change.section, change.key, change.oldValue, rolledBackBy, {
      label: `rollback_${change.key}`,
      reason: `Rollback of ${change.changeId}: ${change.key} from ${change.newValue} to ${change.oldValue}`,
    });

    logger.info('Setting rolled back', { guildId, changeId, section: change.section, key: change.key });

    return result;
  }

  async getHistory(guildId, section = null, limit = 50) {
    const query = { guildId };
    if (section) query.section = section;
    return SettingsHistory.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async batchSet(guildId, section, updates, changedBy = 'system', options = {}) {
    const results = [];
    const errors = [];

    for (const [key, value] of Object.entries(updates)) {
      try {
        const result = await this.set(guildId, section, key, value, changedBy, options);
        results.push(result);
      } catch (err) {
        errors.push({ key, error: err.message });
      }
    }

    return { success: results.length, failed: errors, results };
  }

  async validateSection(guildId, section, updates) {
    const errors = [];
    const valid = {};
    const defaults = this._getDefaultsForSection(section);

    for (const [key, value] of Object.entries(updates)) {
      if (!(key in defaults)) {
        errors.push({ key, error: `Unknown setting: ${section}.${key}` });
        continue;
      }
      const validation = this.validate(section, key, value, key);
      if (validation.valid) {
        valid[key] = validation.value;
      } else {
        errors.push({ key, error: validation.error });
      }
    }
    return { valid, errors };
  }

  getDefaultsForSection(section) {
    return this._getDefaultsForSection(section);
  }

  getSections() {
    return VALID_SECTIONS.map(s => ({ key: s, name: SECTION_NAMES[s] }));
  }

  getSectionKeys(section) {
    const defaults = this._getDefaultsForSection(section);
    return Object.entries(defaults).map(([key, defaultValue]) => ({
      key,
      type: typeof defaultValue,
      defaultValue,
      label: this._formatKey(key),
    }));
  }

  _getDefaultsForSection(section) {
    const defaults = DEFAULT_MODEL[section];
    if (!defaults) return {};
    if (typeof defaults === 'object' && defaults.constructor === Object) return defaults;
    return {};
  }

  _getDefaultValue(section, key) {
    return DEFAULT_MODEL[section]?.[key];
  }

  _getConstraints(section, key) {
    const path = `serverSettings.${section}.${key}`;
    const schema = ServerSettings.schema.path(path);
    if (!schema || !schema.options) return null;
    return { min: schema.options.min, max: schema.options.max };
  }

  _getEnumValues(section, key) {
    const path = `serverSettings.${section}.${key}`;
    const schema = ServerSettings.schema.path(path);
    if (!schema || !schema.options) return null;
    return schema.options.enum || null;
  }

  _formatKey(key) {
    return key.replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  isPrioritySection(section) {
    return PRIORITY_SECTIONS.includes(section);
  }
}

module.exports = new SettingsService();
