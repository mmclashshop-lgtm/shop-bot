const mongoose = require('mongoose');

jest.mock('../../src/database/models', () => ({
  Payment: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
  },
  Order: { findById: jest.fn(), findByIdAndUpdate: jest.fn() },
  User: { findOneAndUpdate: jest.fn() },
  Store: { findById: jest.fn(), findByIdAndUpdate: jest.fn() },
  Transaction: { create: jest.fn() },
  AuditLog: { create: jest.fn() },
}));

jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock('../../src/services/CommissionService', () => ({
  getEffectiveCommissionRate: jest.fn().mockResolvedValue(0.05),
  calculateCommission: jest.fn().mockReturnValue({ commissionAmount: 50, sellerAmount: 950, platformAmount: 50 }),
  recordCommission: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/services/MonitorService', () => ({
  trackPayment: jest.fn(),
  trackFraud: jest.fn(),
}));
jest.mock('../../src/services/AuditService', () => ({
  log: jest.fn(),
}));

jest.mock('mongoose', () => {
  const mMongoose = {
    startSession: jest.fn().mockResolvedValue({
      startTransaction: jest.fn(),
      abortTransaction: jest.fn().mockResolvedValue(),
      commitTransaction: jest.fn().mockResolvedValue(),
      endSession: jest.fn(),
    }),
    Types: { ObjectId: { isValid: jest.fn().mockReturnValue(true) } },
  };
  return mMongoose;
});

const PaymentService = require('../../src/services/PaymentService');
const { Payment, Store } = require('../../src/database/models');

describe('PaymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    PaymentService.destroy();
  });

  describe('generatePaymentId', () => {
    it('should generate a PAY- prefixed ID', () => {
      const id = PaymentService.generatePaymentId();
      expect(id).toMatch(/^PAY-/);
    });
  });

  describe('generateReferenceCode', () => {
    it('should generate a hex string', () => {
      const code = PaymentService.generateReferenceCode();
      expect(code).toMatch(/^[0-9A-F]{12}$/);
    });
  });

  describe('createPayment', () => {
    it('should throw on invalid amount', async () => {
      await expect(PaymentService.createPayment({ amount: -100 })).rejects.toThrow('positive finite number');
      await expect(PaymentService.createPayment({ amount: 0 })).rejects.toThrow('positive finite number');
      await expect(PaymentService.createPayment({ amount: NaN })).rejects.toThrow('positive finite number');
    });

    it('should return existing payment on idempotency hit', async () => {
      const existing = { paymentId: 'PAY-EXISTING' };
      Payment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(existing) });

      const result = await PaymentService.createPayment({ amount: 100, idempotencyKey: 'key1', storeId: 'store1' });

      expect(result).toBe(existing);
    });

    it('should create a new payment', async () => {
      Payment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      Store.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ ownerId: 'seller1', type: 'basic' }) });
      Payment.create.mockResolvedValue({
        paymentId: 'PAY-NEW', amount: 1000, commissionAmount: 50, sellerAmount: 950,
        platformAmount: 50, status: 'pending', auditTrail: [],
      });

      const result = await PaymentService.createPayment({
        amount: 1000, storeId: 'store1', buyerId: 'buyer1', itemName: 'Test Item', itemType: 'product',
      });

      expect(result.paymentId).toBe('PAY-NEW');
      expect(Payment.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPayment', () => {
    it('should find payment by paymentId', async () => {
      Payment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ paymentId: 'PAY-1' }) });

      const result = await PaymentService.getPayment('PAY-1');
      expect(result.paymentId).toBe('PAY-1');
    });
  });

  describe('getUserPayments', () => {
    it('should return user payments sorted by date', async () => {
      Payment.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ paymentId: 'PAY-1' }]) }) }),
      });

      const result = await PaymentService.getUserPayments('user1');
      expect(result).toHaveLength(1);
    });
  });

  describe('getPaymentStats', () => {
    it('should return aggregated stats', async () => {
      Payment.countDocuments.mockResolvedValue(100);
      Payment.aggregate
        .mockResolvedValueOnce([{ total: 50000 }])
        .mockResolvedValueOnce([{ total: 2500 }])
        .mockResolvedValueOnce([{ _id: 'completed', count: 80 }, { _id: 'pending', count: 20 }]);

      const stats = await PaymentService.getPaymentStats();

      expect(stats.total).toBe(100);
      expect(stats.revenue).toBe(50000);
      expect(stats.commissions).toBe(2500);
      expect(stats.byStatus.completed).toBe(80);
    });
  });
});
