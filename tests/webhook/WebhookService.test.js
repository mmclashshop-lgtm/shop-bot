jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock('../../src/config', () => ({
  webhook: { url: 'https://example.com/webhook', secret: 'test-secret-thirty-two-chars-minimum!!' },
}));

const WebhookService = require('../../src/services/WebhookService');

describe('WebhookService', () => {
  afterEach(() => {
    delete global.fetch;
  });

  describe('send', () => {
    it('should send a webhook and return true on success', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      const result = await WebhookService.send('test_event', { data: 'value' });

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should return false on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await WebhookService.send('test_event', { data: 'value' });

      expect(result).toBe(false);
    });

    it('should include HMAC signature header', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      await WebhookService.send('test_event', { data: 'value' });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-Webhook-Signature']).toBeDefined();
      expect(headers['X-Webhook-Timestamp']).toBeDefined();
    });
  });
});
