const config = require('../config');
const { logger } = require('../utils/logger');

class ProBotApiService {
  constructor() {
    this.enabled = config.probotApi.enabled && config.probotApi.key.length > 0;
    this.baseUrl = config.probotApi.baseUrl;
    this.apiKey = config.probotApi.key;
    this._lastRateLimitReset = 0;
    this._remainingCalls = 60;
  }

  async _request(endpoint, options = {}) {
    if (!this.enabled) return null;

    try {
      const https = require('https');
      const url = new URL(endpoint, this.baseUrl);

      return new Promise((resolve, reject) => {
        const req = https.request(
          url,
          {
            method: options.method || 'GET',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              ...options.headers,
            },
            timeout: 10000,
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve(data);
              }
            });
          }
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (options.body) req.write(JSON.stringify(options.body));
        req.end();
      });
    } catch (error) {
      logger.warn('ProBot API request failed', { endpoint, error: error.message });
      return null;
    }
  }

  async getUserBalance(userId) {
    const data = await this._request(`/api/v1/users/${userId}/balance`);
    return data?.balance ?? null;
  }

  async getUserTransactions(userId, limit = 10) {
    const data = await this._request(`/api/v1/users/${userId}/transactions?limit=${limit}`);
    return data?.transactions ?? [];
  }

  async verifyTransaction(transactionId) {
    const data = await this._request(`/api/v1/transactions/${transactionId}`);
    return data ?? null;
  }

  isAvailable() {
    return this.enabled;
  }
}

module.exports = new ProBotApiService();
