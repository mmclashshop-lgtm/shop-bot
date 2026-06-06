const AuditLog = require('\.\./database/models/AuditLog');
const { logger } = require('../utils/logger');

class AuditService {
  async log(action, userId, options = {}) {
    try {
      await AuditLog.create({
        action,
        userId,
        targetId: options.targetId || null,
        targetType: options.targetType || null,
        details: options.details || {},
        ip: options.ip || null,
        guildId: options.guildId || null,
        metadata: {
          userTag: options.userTag || null,
          channelId: options.channelId || null,
          commandName: options.commandName || null,
        },
      });
    } catch (error) {
      logger.error('Audit log error', { action, userId, error: error.message });
    }
  }

  async getLogs(query = {}, limit = 50, skip = 0) {
    return AuditLog.find(query.lean())
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .lean();
  }

  async getLogsByUser(userId, limit = 50) {
    return this.getLogs({ userId }, limit);
  }

  async getLogsByAction(action, limit = 50) {
    return this.getLogs({ action }, limit);
  }

  async countLogs(query = {}) {
    return AuditLog.countDocuments(query);
  }
}

module.exports = new AuditService();
