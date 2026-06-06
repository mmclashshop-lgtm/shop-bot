jest.mock('../../src/services/MonitorService', () => ({
  getSnapshot: jest.fn().mockReturnValue({ commands: 100, uptime: 3600 }),
  getPerformanceReport: jest.fn().mockResolvedValue({ avgResponse: 150 }),
}));

jest.mock('../../src/services/PaymentService', () => ({
  verifyPayment: jest.fn(),
  autoConfirmPayment: jest.fn(),
  getPayment: jest.fn().mockResolvedValue({ paymentId: 'PAY-1', status: 'pending' }),
}));

jest.mock('../../src/config', () => ({
  webhook: { secret: 'test-secret-thirty-two-chars-minimum!!', port: 0, allowedIps: '127.0.0.1' },
  server: { port: 0, host: '127.0.0.1' },
  mongodb: { uri: 'mongodb://localhost:27017/test' },
  security: { scamKeywords: ['scam', 'free nitro', 'cheat', 'hack'], maxWarnings: 5 },
  limits: { cooldowns: { storeCreate: 10000, productAdd: 5000, search: 3000, ai: 2000, ticketCreate: 10000 } },
}));

jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));

const http = require('http');

describe('Webhook Server', () => {
  let server;
  let WebhookServer;

  beforeAll(async () => {
    WebhookServer = require('../../src/webhook/server');
    server = new WebhookServer();
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should return health on GET /api/health', (done) => {
    const req = http.request({ port: server.port, path: '/api/health', method: 'GET' }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(data);
        expect(body).toHaveProperty('uptime');
        done();
      });
    });
    req.end();
  });

  it('should return metrics on GET /api/metrics', (done) => {
    const req = http.request({ port: server.port, path: '/api/metrics', method: 'GET' }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(data);
        expect(body).toHaveProperty('commands');
        done();
      });
    });
    req.end();
  });

  it('should return 401 on missing webhook secret header', (done) => {
    const req = http.request({ port: server.port, path: '/api/webhook/probot', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        expect(res.statusCode).toBe(401);
        done();
      });
    });
    req.write(JSON.stringify({}));
    req.end();
  });

  it('should return 404 on unknown route', (done) => {
    const req = http.request({ port: server.port, path: '/api/unknown', method: 'GET' }, (res) => {
      expect(res.statusCode).toBe(404);
      done();
    });
    req.end();
  });
});
