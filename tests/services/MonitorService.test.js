jest.mock('../../src/database/models', () => ({}));
jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

describe('MonitorService', () => {
  let MonitorService;

  beforeAll(() => {
    MonitorService = require('../../src/services/MonitorService');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    MonitorService.reset();
  });

  describe('trackCommand', () => {
    it('should track command execution', () => {
      MonitorService.trackCommand('test', 150);
      const snapshot = MonitorService.getSnapshot();
      expect(snapshot.commands.executions).toBe(1);
      expect(snapshot.commands.total).toBe(1);
    });
  });

  describe('trackError', () => {
    it('should track errors', () => {
      MonitorService.trackError('test_command', new Error('test error'));
      const snapshot = MonitorService.getSnapshot();
      expect(snapshot.errors.total).toBe(1);
      expect(snapshot.errors.recent).toHaveLength(1);
    });
  });

  describe('trackPayment', () => {
    it('should track payment events', () => {
      MonitorService.trackPayment('created');
      MonitorService.trackPayment('completed');
      const snapshot = MonitorService.getSnapshot();
      expect(snapshot.payments.created).toBe(2);
      expect(snapshot.payments.completed).toBe(1);
    });
  });

  describe('getErrorReport', () => {
    it('should return error report', () => {
      MonitorService.trackError('cmd1', new Error('err1'));
      const report = MonitorService.getErrorReport();

      expect(Array.isArray(report)).toBe(true);
      expect(report[0]).toHaveProperty('time');
      expect(report[0]).toHaveProperty('context');
      expect(report[0]).toHaveProperty('message');
    });
  });

  describe('getPerformanceReport', () => {
    it('should return performance metrics', async () => {
      const report = await MonitorService.getPerformanceReport();
      expect(report).toHaveProperty('avg');
      expect(report).toHaveProperty('count');
    });
  });
});
