const { execFile } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');
const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);
const mongoose = require('mongoose');
const { EmbedBuilder } = require('discord.js');
const { BackupLog } = require('../database/models');
const { logger } = require('../utils/logger');
const AuditService = require('./AuditService');
const config = require('../config');

const BACKUP_ROOT = path.join(process.cwd(), 'data', 'backups');
const SCHEDULE_CONFIG = {
  daily:   { retention: 7,  cron: '0 0 * * *',     dir: 'daily' },
  weekly:  { retention: 4,  cron: '0 0 * * 0',     dir: 'weekly' },
  monthly: { retention: 12, cron: '0 0 1 * *',     dir: 'monthly' },
};

class BackupService {
  constructor() {
    this._runningBackups = new Map();
    this._scheduler = null;
    this._healthInterval = null;
    this._lastHealth = null;
    this.client = null;
  }

  setClient(discordClient) {
    this.client = discordClient;
  }

  async initialize() {
    await this._ensureDirectories();
    this._startScheduler();
    this._startHealthMonitor();
    logger.info('BackupService initialized', {
      root: BACKUP_ROOT,
      schedules: Object.fromEntries(
        Object.entries(SCHEDULE_CONFIG).map(([k, v]) => [k, { retention: v.retention, cron: v.cron }])
      ),
    });
  }

  async _ensureDirectories() {
    for (const cfg of Object.values(SCHEDULE_CONFIG)) {
      const dir = path.join(BACKUP_ROOT, cfg.dir);
      await fsp.mkdir(dir, { recursive: true }).catch(() => {});
    }
  }

  _startScheduler() {
    const { CronJob } = require('cron');
    this._scheduler = [];
    for (const [type, cfg] of Object.entries(SCHEDULE_CONFIG)) {
      const job = new CronJob(cfg.cron, () => {
        this.createBackup(type).catch(err => logger.error('Scheduled backup failed', { type, error: err.message }));
      }, null, true, 'UTC');
      this._scheduler.push(job);
      logger.info('Scheduler registered', { type, cron: cfg.cron });
    }
  }

  _startHealthMonitor() {
    this._healthInterval = setInterval(() => this._checkHealth(), 3600000);
  }

  async _checkHealth() {
    try {
      const recent = await BackupLog.findOne().sort({ createdAt: -1 }).lean();
      const stats = await this.getStorageStats();
      const oldestHealthy = await BackupLog.findOne({ status: { $in: ['completed', 'verified'] } }).sort({ createdAt: 1 }).lean();

      this._lastHealth = {
        healthy: true,
        lastBackup: recent ? { id: recent.backupId, type: recent.type, status: recent.status, time: recent.createdAt } : null,
        totalBackups: stats.totalBackups,
        totalSize: stats.totalSize,
        storageUsed: stats.storageUsed,
        oldestBackup: oldestHealthy ? oldestHealthy.createdAt : null,
        issues: [],
      };

      if (!recent) {
        this._lastHealth.issues.push('No backups exist yet');
        this._lastHealth.healthy = false;
      } else if (recent.status === 'failed') {
        this._lastHealth.issues.push(`Last backup failed: ${recent.errorMessage}`);
        this._lastHealth.healthy = false;
      } else {
        const age = Date.now() - new Date(recent.createdAt).getTime();
        if (age > 86400000 * 2) {
          this._lastHealth.issues.push(`Last successful backup is ${Math.round(age / 86400000)} days old`);
          this._lastHealth.healthy = false;
        }
      }

      if (stats.storagePercentage > 80) {
        this._lastHealth.issues.push(`Storage at ${stats.storagePercentage}% capacity`);
        this._lastHealth.healthy = false;
      }

      logger.info('Backup health check', this._lastHealth);
      return this._lastHealth;
    } catch (err) {
      this._lastHealth = { healthy: false, issues: [`Health check failed: ${err.message}`] };
      return this._lastHealth;
    }
  }

  getHealth() {
    return this._lastHealth || { healthy: true, issues: ['Health check not yet run'] };
  }

  getRecoverySuggestions() {
    const suggestions = [];
    const health = this.getHealth();

    if (!health.healthy) {
      for (const issue of health.issues) {
        if (issue.includes('No backups exist')) {
          suggestions.push({ priority: 'critical', action: 'Create first backup immediately', command: '/backup create' });
        } else if (issue.includes('failed')) {
          suggestions.push({ priority: 'high', action: 'Check disk space and MongoDB connection, then retry', command: '/backup status' });
        } else if (issue.includes('days old')) {
          suggestions.push({ priority: 'medium', action: 'Manual backup trigger recommended', command: '/backup create' });
        } else if (issue.includes('capacity')) {
          suggestions.push({ priority: 'critical', action: 'Free disk space or increase storage', command: 'Check backup retention policy' });
        }
      }
    }

    if (!health.healthy || !health.lastBackup) {
      suggestions.push({ priority: 'info', action: 'Verify mongodump is installed: run `which mongodump` on server' });
    }

    return suggestions;
  }

  async getStorageStats() {
    const backups = await BackupLog.find({ status: { $ne: 'running' } }).lean();
    const totalSize = backups.reduce((s, b) => s + (b.compressedSizeBytes || 0), 0);

    let storageUsed = 0;
    let storageTotal = 0;
    try {
      const { stdout } = await new Promise((resolve, reject) => {
        execFile('df', ['-B1', '.'], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
          if (err) return reject(err);
          resolve({ stdout });
        });
      });
      if (stdout) {
        const lines = stdout.trim().split('\n');
        const parts = lines[lines.length - 1]?.trim().split(/\s+/) || [];
        storageUsed = parseInt(parts[2], 10) || 0;
        storageTotal = parseInt(parts[1], 10) || 1;
      }
    } catch (err) { logger.error('Unhandled error in services/BackupService.js', { error: err?.message }) }

    return {
      totalBackups: backups.length,
      totalSize,
      totalSizeFormatted: this._formatSize(totalSize),
      storageUsed,
      storageTotal,
      storagePercentage: storageTotal > 0 ? Math.round((storageUsed / storageTotal) * 100) : 0,
      byType: {
        daily: backups.filter(b => b.type === 'daily').length,
        weekly: backups.filter(b => b.type === 'weekly').length,
        monthly: backups.filter(b => b.type === 'monthly').length,
      },
    };
  }

  async createBackup(type = 'daily', options = {}) {
    const backupId = `backup_${type}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const dirConfig = SCHEDULE_CONFIG[type];
    if (!dirConfig) throw new Error(`Invalid backup type: ${type}`);

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `mongodb_${type}_${dateStr}.gz`;
    const filePath = path.join(BACKUP_ROOT, dirConfig.dir, fileName);

    if (this._runningBackups.has(type)) {
      throw new Error(`Backup of type '${type}' already running`);
    }

    const logEntry = await BackupLog.create({
      backupId, type, status: 'running', filePath, fileName,
    });

    this._runningBackups.set(type, { backupId, startTime: Date.now() });

    try {
      const uri = config.mongodb.uri;
      const startTime = Date.now();

      const result = await this._execMongodump(uri, filePath);
      const duration = Date.now() - startTime;

      const stats = await fsp.stat(filePath);
      const md5Hash = await this._computeMd5(filePath);
      const compressionRatio = result.rawSize > 0 ? stats.size / result.rawSize : 0;

      const dbInfo = await this._getDatabaseInfo();

      await BackupLog.updateOne({ backupId }, {
        $set: {
          status: 'completed',
          sizeBytes: result.rawSize || 0,
          compressedSizeBytes: stats.size,
          compressionRatio: Math.round(compressionRatio * 100) / 100,
          md5Hash,
          databaseSize: dbInfo.totalSize,
          collectionCount: dbInfo.collectionCount,
          documentCount: dbInfo.documentCount,
          durationMs: duration,
          metadata: {
            mongodumpVersion: result.version || '',
            nodeVersion: process.version,
            platform: os.platform(),
            hostname: os.hostname(),
            totalDbSize: dbInfo.totalSize,
          },
        },
      });

      this._runningBackups.delete(type);
      await this._enforceRetention(type);

      const metaFile = filePath + '.meta.json';
      const meta = {
        backupId, type, createdAt: new Date().toISOString(), fileName, sizeBytes: stats.size,
        md5Hash, duration, databaseSize: dbInfo.totalSize, collectionCount: dbInfo.collectionCount,
        documentCount: dbInfo.documentCount, mongodumpVersion: result.version,
      };
      await fsp.writeFile(metaFile, JSON.stringify(meta, null, 2));

      logger.info('Backup completed', { backupId, type, size: this._formatSize(stats.size), duration: `${duration}ms` });

      AuditService.log('backup_created', 'system', {
        details: { backupId, type, size: stats.size, duration, fileName },
      });

      await this._notifyAdmins('backup_completed', { backupId, type, size: this._formatSize(stats.size), duration });

      return { backupId, type, filePath, size: stats.size, duration, md5Hash };
    } catch (error) {
      this._runningBackups.delete(type);
      await BackupLog.updateOne({ backupId }, { $set: { status: 'failed', errorMessage: error.message } });

      logger.error('Backup failed', { backupId, type, error: error.message });

      AuditService.log('backup_failed', 'system', {
        details: { backupId, type, error: error.message },
      });

      await this._notifyAdmins('backup_failed', { backupId, type, error: error.message });

      try { await fsp.unlink(filePath).catch(() => {}); } catch (err) { logger.error('Unhandled error in services/BackupService.js', { error: err?.message }) }
      try { await fsp.unlink(filePath + '.meta.json').catch(() => {}); } catch (err) { logger.error('Unhandled error in services/BackupService.js', { error: err?.message }) }

      throw error;
    }
  }

  _execMongodump(uri, outputPath) {
    return new Promise((resolve, reject) => {
      const args = [
        `--uri=${uri}`,
        `--gzip`,
        `--archive=${outputPath}`,
        '--quiet',
      ];

      const child = execFile('mongodump', args, { timeout: 600000, maxBuffer: 1024 * 1024 * 100 }, (err, stdout, stderr) => {
        if (err) {
          if (err.killed) return reject(new Error('mongodump timed out after 10 minutes'));
          return reject(new Error(`mongodump failed: ${stderr || err.message}`));
        }
        resolve({ rawSize: 0, version: '' });
      });

      child.on('error', reject);
    });
  }

  async verifyBackup(backupId, verifier = 'system') {
    const log = await BackupLog.findOne({ backupId }).lean();
    if (!log) throw new Error(`Backup not found: ${backupId}`);
    const exists = await fsp.access(log.filePath).then(() => true).catch(() => false);
    if (!exists) throw new Error(`Backup file not found: ${log.filePath}`);

    const issues = [];

    const stats = await fsp.stat(log.filePath);
    if (stats.size === 0) issues.push('Backup file is empty');

    const md5 = await this._computeMd5(log.filePath);
    if (log.md5Hash && md5 !== log.md5Hash) issues.push('MD5 hash mismatch — file may be corrupted');

    try {
      await this._verifyGzipIntegrity(log.filePath);
    } catch (e) {
      issues.push(`Gzip integrity check failed: ${e.message}`);
    }

    const isValid = issues.length === 0;
    const status = isValid ? 'verified' : 'corrupted';

    await BackupLog.updateOne({ backupId }, {
      $set: { status, verifiedAt: new Date(), verifiedBy: verifier, verifiedSuccess: isValid },
    });

    if (!isValid) {
      logger.error('Backup verification failed', { backupId, issues });
      AuditService.log('backup_verification_failed', 'system', {
        details: { backupId, issues },
      });
      await this._notifyAdmins('backup_verification_failed', { backupId, issues });
    } else {
      logger.info('Backup verified', { backupId });
      AuditService.log('backup_verified', 'system', {
        details: { backupId },
      });
    }

    return { valid: isValid, issues, md5 };
  }

  _verifyGzipIntegrity(filePath) {
    return new Promise((resolve, reject) => {
      const gunzip = zlib.createGunzip();
      const stream = fs.createReadStream(filePath).pipe(gunzip);
      let bytesRead = 0;
      stream.on('data', chunk => { bytesRead += chunk.length; });
      stream.on('end', () => {
        if (bytesRead === 0) return reject(new Error('No data after decompression'));
        resolve(bytesRead);
      });
      stream.on('error', (err) => reject(new Error(`Gzip corruption: ${err.message}`)));
    });
  }

  async restoreBackup(backupId, restorer = 'system') {
    const log = await BackupLog.findOne({ backupId }).lean();
    if (!log) throw new Error(`Backup not found: ${backupId}`);
    const exists = await fsp.access(log.filePath).then(() => true).catch(() => false);
    if (!exists) throw new Error(`Backup file not found: ${log.filePath}`);

    await BackupLog.updateOne({ backupId }, { $set: { restoredAt: new Date(), restoredBy: restorer, restoredSuccess: false } });

    const verifyResult = await this.verifyBackup(backupId, restorer);
    if (!verifyResult.valid) {
      throw new Error(`Restore aborted: backup verification failed\nIssues: ${verifyResult.issues.join(', ')}`);
    }

    const uri = config.mongodb.uri;
    const dbName = new URL(uri.replace('mongodb+srv://', 'mongodb://')).pathname.replace('/', '') || 'market-ai';

    try {
      await this._execMongorestore(log.filePath, uri, dbName);
      await BackupLog.updateOne({ backupId }, { $set: { restoredSuccess: true } });

      logger.info('Backup restored', { backupId, dbName });
      AuditService.log('backup_restored', 'system', {
        details: { backupId, dbName, restoredBy: restorer },
      });
      await this._notifyAdmins('backup_restored', { backupId, dbName });

      return { success: true, dbName };
    } catch (error) {
      await BackupLog.updateOne({ backupId }, { $set: { restoredSuccess: false } });

      logger.error('Restore failed', { backupId, error: error.message });
      AuditService.log('backup_restore_failed', 'system', {
        details: { backupId, error: error.message, restorer },
      });
      await this._notifyAdmins('backup_restore_failed', { backupId, error: error.message });

      throw error;
    }
  }

  _execMongorestore(archivePath, uri, dbName) {
    return new Promise((resolve, reject) => {
      const args = [
        `--uri=${uri}`,
        `--gzip`,
        `--archive=${archivePath}`,
        '--drop',
        '--quiet',
      ];

      const child = execFile('mongorestore', args, { timeout: 600000, maxBuffer: 1024 * 1024 * 100 }, (err, stdout, stderr) => {
        if (err) {
          if (err.killed) return reject(new Error('mongorestore timed out after 10 minutes'));
          return reject(new Error(`mongorestore failed: ${stderr || err.message}`));
        }
        resolve(true);
      });

      child.on('error', reject);
    });
  }

  async _enforceRetention(type) {
    const cfg = SCHEDULE_CONFIG[type];
    if (!cfg) return;

    const dir = path.join(BACKUP_ROOT, cfg.dir);
    try {
      let entries;
      try { entries = await fsp.readdir(dir); } catch { return; }
      const gzFiles = entries.filter(f => f.endsWith('.gz'));

      const files = (await Promise.all(
        gzFiles.map(async (name) => {
          const filePath = path.join(dir, name);
          try {
            const stat = await fsp.stat(filePath);
            return { name, path: filePath, mtime: stat.mtime };
          } catch { return null; }
        })
      )).filter(Boolean);

      files.sort((a, b) => b.mtime - a.mtime);
      if (files.length <= cfg.retention) return;

      const toDelete = files.slice(cfg.retention);
      await Promise.all(toDelete.map(async (file) => {
        try {
          await fsp.unlink(file.path);
          await fsp.unlink(file.path + '.meta.json').catch(() => {});
          BackupLog.deleteOne({ fileName: file.name }).catch(() => {});
          logger.info('Retention: deleted old backup', { type, file: file.name });
        } catch (err) {
          logger.warn('Retention: failed to delete', { file: file.name, error: err.message });
        }
      }));
    } catch (err) {
      logger.error('Retention enforcement failed', { type, error: err.message });
    }
  }

  async listBackups(type = null, limit = 20) {
    const query = type ? { type, status: { $ne: 'running' } } : { status: { $ne: 'running' } };
    return BackupLog.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async getBackup(backupId) {
    return BackupLog.findOne({ backupId }).lean();
  }

  async getStatus() {
    const running = Array.from(this._runningBackups.entries()).map(([type, info]) => ({
      type,
      backupId: info.backupId,
      elapsed: Date.now() - info.startTime,
    }));

    const lastBackup = await BackupLog.findOne().sort({ createdAt: -1 }).lean();
    const stats = await this.getStorageStats();
    const health = this.getHealth();
    const suggestions = this.getRecoverySuggestions();

    return {
      healthy: health.healthy,
      runningBackups: running,
      lastBackup: lastBackup ? {
        id: lastBackup.backupId,
        type: lastBackup.type,
        status: lastBackup.status,
        time: lastBackup.createdAt,
        size: lastBackup.compressedSizeBytes,
      } : null,
      storage: stats,
      health,
      suggestions,
    };
  }

  async _getDatabaseInfo() {
    try {
      const db = mongoose.connection.db;
      if (!db) return { totalSize: 'N/A', collectionCount: 0, documentCount: 0 };

      const stats = await db.stats();
      const totalSize = stats.dataSize + stats.indexSize;
      return {
        totalSize: this._formatSize(totalSize),
        collectionCount: stats.collections || 0,
        documentCount: stats.objects || 0,
      };
    } catch {
      return { totalSize: 'N/A', collectionCount: 0, documentCount: 0 };
    }
  }

  _computeMd5(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  _formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }

  async _notifyAdmins(event, data) {
    if (!this.client || !this.client.isReady()) return;
    try {
      const ownerId = config.discord.ownerId;
      if (!ownerId) return;

      const user = await this.client.users.fetch(ownerId).catch(() => null);
      if (!user) return;

      const embed = new EmbedBuilder()
        .setTimestamp();

      switch (event) {
        case 'backup_completed': {
          embed.setTitle('✅ نسخ احتياطي ناجح');
          embed.setColor(0x2ECC71);
          embed.setDescription(`تم إنشاء نسخة احتياطية من نوع **${data.type}**`);
          embed.addFields(
            { name: '🆔 المعرف', value: `\`${data.backupId}\``, inline: true },
            { name: '📦 الحجم', value: data.size || 'N/A', inline: true },
            { name: '⏱️ المدة', value: `${data.duration}ms` || 'N/A', inline: true },
          );
          break;
        }
        case 'backup_failed': {
          embed.setTitle('❌ فشل النسخ الاحتياطي');
          embed.setColor(0xE74C3C);
          embed.setDescription(`فشل إنشاء نسخة احتياطية من نوع **${data.type}**`);
          embed.addFields(
            { name: '🆔 المعرف', value: `\`${data.backupId}\``, inline: true },
            { name: '⚠️ الخطأ', value: `\`\`\`${data.error.substring(0, 500)}\`\`\``, inline: false },
          );
          break;
        }
        case 'backup_restored': {
          embed.setTitle('🔄 استعادة نسخة احتياطية');
          embed.setColor(0x3498DB);
          embed.setDescription(`تمت استعادة النسخة **${data.backupId}**`);
          embed.addFields(
            { name: '🗄️ قاعدة البيانات', value: `\`${data.dbName}\``, inline: true },
          );
          break;
        }
        case 'backup_restore_failed': {
          embed.setTitle('❌ فشل استعادة النسخة الاحتياطية');
          embed.setColor(0xE74C3C);
          embed.setDescription(`فشلت استعادة النسخة **${data.backupId}**`);
          embed.addFields(
            { name: '⚠️ الخطأ', value: `\`\`\`${data.error.substring(0, 500)}\`\`\``, inline: false },
          );
          break;
        }
        case 'backup_verification_failed': {
          embed.setTitle('⚠️ فشل التحقق من النسخة الاحتياطية');
          embed.setColor(0xF39C12);
          embed.setDescription(`النسخة **${data.backupId}** قد تكون تالفة`);
          embed.addFields(
            { name: '📋 المشاكل', value: data.issues.map(i => `• ${i}`).join('\n'), inline: false },
          );
          break;
        }
        default: return;
      }

      await user.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      logger.warn('Failed to notify admin', { event, error: err.message });
    }
  }

  stop() {
    if (this._scheduler) {
      for (const job of this._scheduler) job.stop();
      this._scheduler = null;
    }
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
    this._runningBackups.clear();
    logger.info('BackupService stopped');
  }

  destroy() {
    this.stop();
  }
}

module.exports = new BackupService();
