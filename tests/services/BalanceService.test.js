jest.mock('../../src/database/models', () => ({
  User: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    aggregate: jest.fn(),
  },
  Withdrawal: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
  },
  Transaction: {
    create: jest.fn(),
    aggregate: jest.fn(),
    countDocuments: jest.fn(),
  },
  Payment: {
    aggregate: jest.fn(),
  },
  MarketplaceSettings: { findOne: jest.fn() },
  AuditLog: { create: jest.fn() },
}));

jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock('../../src/services/MonitorService', () => ({ trackWithdrawal: jest.fn() }));
jest.mock('../../src/services/AuditService', () => ({ log: jest.fn() }));
jest.mock('../../src/services/CommissionService', () => ({}));

const BalanceService = require('../../src/services/BalanceService');
const { User, Withdrawal, Transaction, Payment, MarketplaceSettings } = require('../../src/database/models');

describe('BalanceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSellerBalance', () => {
    it('should return 0 for unknown user', async () => {
      User.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      expect(await BalanceService.getSellerBalance('unknown')).toBe(0);
    });

    it('should return platformEarnings', async () => {
      User.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ platformEarnings: 5000 }) });
      expect(await BalanceService.getSellerBalance('user1')).toBe(5000);
    });
  });

  describe('getPlatformBalance', () => {
    it('should return 0 when no commissions', async () => {
      Transaction.aggregate.mockResolvedValue([]);
      expect(await BalanceService.getPlatformBalance()).toBe(0);
    });

    it('should return total commission', async () => {
      Transaction.aggregate.mockResolvedValue([{ total: 15000 }]);
      expect(await BalanceService.getPlatformBalance()).toBe(15000);
    });
  });

  describe('getTopSellers', () => {
    it('should return top sellers', async () => {
      User.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ discordId: 'user1', platformEarnings: 10000 }]) }) }) }),
        }),
      });

      const result = await BalanceService.getTopSellers(5);
      expect(result).toHaveLength(1);
    });
  });

  describe('getWithdrawal', () => {
    it('should find withdrawal by ID', async () => {
      Withdrawal.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ withdrawalId: 'WTH-1' }) });
      expect(await BalanceService.getWithdrawal('WTH-1')).toBeTruthy();
    });
  });

  describe('getUserWithdrawals', () => {
    it('should return user withdrawals', async () => {
      Withdrawal.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ withdrawalId: 'WTH-1' }]) }) }),
      });

      const result = await BalanceService.getUserWithdrawals('user1');
      expect(result).toHaveLength(1);
    });
  });

  describe('getWithdrawalStats', () => {
    it('should return aggregated stats', async () => {
      Withdrawal.countDocuments
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(80);
      Withdrawal.aggregate.mockResolvedValue([{ total: 500000 }]);

      const stats = await BalanceService.getWithdrawalStats();
      expect(stats.total).toBe(100);
      expect(stats.totalPaid).toBe(500000);
    });
  });

  describe('getMonthlyRevenue', () => {
    it('should return monthly revenue aggregation', async () => {
      Payment.aggregate.mockResolvedValue([{ _id: '2026-01-01', revenue: 1000, commissions: 50, count: 1 }]);

      const result = await BalanceService.getMonthlyRevenue(2026, 1);
      expect(result).toHaveLength(1);
    });
  });
});
