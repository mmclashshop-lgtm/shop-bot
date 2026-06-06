jest.mock('../../src/database/models', () => ({
  BackupLog: {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  },
}));

jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock('../../src/services/AuditService', () => ({ log: jest.fn() }));
jest.mock('../../src/config', () => ({ mongodb: { uri: 'mongodb://localhost:27017/test' } }));

jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, opts, cb) => {
    if (cmd === 'mongodump') cb(null, '', '');
    else if (cmd === 'mongorestore') cb(null, '', '');
  }),
  exec: jest.fn((...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : args.pop();
    cb(null, '1024 2048 512 /', '');
  }),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      mkdir: jest.fn().mockResolvedValue(),
      stat: jest.fn().mockResolvedValue({ size: 1024, mtime: new Date() }),
      writeFile: jest.fn().mockResolvedValue(),
      unlink: jest.fn().mockResolvedValue(),
      readdir: jest.fn().mockResolvedValue(['backup1.gz', 'backup2.gz']),
      access: jest.fn().mockResolvedValue(),
    },
    createReadStream: actual.createReadStream,
    existsSync: jest.fn().mockReturnValue(true),
    statSync: jest.fn().mockReturnValue({ size: 1024, mtime: new Date() }),
  };
});

const BackupService = require('../../src/services/BackupService');

describe('BackupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    BackupService._runningBackups.clear();
  });

  describe('getHealth', () => {
    it('should return default health before check', () => {
      const health = BackupService.getHealth();
      expect(health.healthy).toBe(true);
    });
  });

  describe('getStorageStats', () => {
    it('should return stats with no backups', async () => {
      const { BackupLog } = require('../../src/database/models');
      BackupLog.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const stats = await BackupService.getStorageStats();

      expect(stats.totalBackups).toBe(0);
      expect(stats.totalSize).toBe(0);
    });

    it('should calculate total size from backups', async () => {
      const { BackupLog } = require('../../src/database/models');
      BackupLog.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ compressedSizeBytes: 500, type: 'daily' }, { compressedSizeBytes: 1000, type: 'weekly' }]) });

      const stats = await BackupService.getStorageStats();

      expect(stats.totalBackups).toBe(2);
      expect(stats.totalSize).toBe(1500);
    });
  });

  describe('getBackup', () => {
    it('should find backup by ID', async () => {
      const { BackupLog } = require('../../src/database/models');
      BackupLog.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ backupId: 'backup1' }) });

      const result = await BackupService.getBackup('backup1');
      expect(result.backupId).toBe('backup1');
    });
  });

  describe('getStatus', () => {
    it('should return status object', async () => {
      const { BackupLog } = require('../../src/database/models');
      BackupLog.findOne.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ backupId: 'backup1', type: 'daily', status: 'completed', createdAt: new Date(), compressedSizeBytes: 500 }) }) });
      BackupLog.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const status = await BackupService.getStatus();

      expect(status).toHaveProperty('healthy');
      expect(status).toHaveProperty('runningBackups');
      expect(status).toHaveProperty('lastBackup');
      expect(status).toHaveProperty('suggestions');
    });
  });

  describe('listBackups', () => {
    it('should list backups with filtering', async () => {
      const { BackupLog } = require('../../src/database/models');
      BackupLog.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ backupId: 'b1' }, { backupId: 'b2' }]) }) }) });

      const result = await BackupService.listBackups('daily', 5);
      expect(result).toHaveLength(2);
    });
  });

  describe('stop', () => {
    it('should clear running backups', () => {
      BackupService._runningBackups.set('daily', { backupId: 'test' });
      BackupService.stop();
      expect(BackupService._runningBackups.size).toBe(0);
    });
  });
});
