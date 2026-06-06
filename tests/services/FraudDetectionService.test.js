jest.mock('../../src/database/models', () => ({
  FraudAlert: {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
    updateMany: jest.fn(),
  },
  PendingAction: { countDocuments: jest.fn(), find: jest.fn() },
  Transaction: { countDocuments: jest.fn() },
  User: { findOne: jest.fn(), find: jest.fn() },
}));

jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock('../../src/services/MonitorService', () => ({ trackFraud: jest.fn() }));
jest.mock('../../src/services/AuditService', () => ({ log: jest.fn() }));
jest.mock('../../src/config', () => ({ aiChat: {}, fraud: {} }));

const FraudDetectionService = require('../../src/services/FraudDetectionService');
const { FraudAlert, User, PendingAction, Transaction } = require('../../src/database/models');

describe('FraudDetectionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    FraudDetectionService.stop();
  });

  describe('getAlertById', () => {
    it('should return alert by ID', async () => {
      FraudAlert.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ alertId: 'fraud_1' }) });
      const result = await FraudDetectionService.getAlertById('fraud_1');
      expect(result.alertId).toBe('fraud_1');
    });
  });

  describe('checkWalletTransfer', () => {
    it('should return no fraud for clean transfer', async () => {
      FraudAlert.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      Transaction.countDocuments.mockResolvedValue(0);
      PendingAction.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      User.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ balance: 50000 }) });

      const result = await FraudDetectionService.checkWalletTransfer('user1', 'user2', 1000);

      expect(result.isFraud).toBe(false);
    });

    it('should detect rapid transfers', async () => {
      FraudAlert.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      Transaction.countDocuments.mockResolvedValue(10);
      PendingAction.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      User.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ balance: 50000 }) });

      const result = await FraudDetectionService.checkWalletTransfer('user1', 'user2', 1000);

      expect(result.riskScore).toBeGreaterThan(0);
    });
  });

  describe('checkWithdrawal', () => {
    it('should return no fraud for normal withdrawal', async () => {
      FraudAlert.countDocuments.mockResolvedValue(0);
      FraudAlert.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      User.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ platformEarnings: 50000 }) });
      Transaction.countDocuments.mockResolvedValue(0);

      const result = await FraudDetectionService.checkWithdrawal('user1', 1000, 'bank');

      expect(result.isFraud).toBe(false);
    });
  });

  describe('getAllAlerts', () => {
    it('should return paginated alerts', async () => {
      FraudAlert.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ hint: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ alertId: 'a1' }]) }) }) }) }) });
      FraudAlert.countDocuments.mockResolvedValue(1);

      const result = await FraudDetectionService.getAllAlerts({}, 1, 20);

      expect(result.alerts).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('archiveOldAlerts', () => {
    it('should archive old alerts', async () => {
      FraudAlert.updateMany.mockResolvedValue({ modifiedCount: 5 });

      const count = await FraudDetectionService.archiveOldAlerts(90);
      expect(count).toBe(5);
    });
  });
});
