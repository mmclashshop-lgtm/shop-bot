const crypto = require('crypto');
const config = require('../config');
const { logger } = require('../utils/logger');

class WebhookService {
  async send(type, data) {
    if (!config.webhook?.url) return;

    try {
      const payload = {
        type,
        timestamp: new Date().toISOString(),
        data,
      };

      const body = JSON.stringify(payload);
      const signature = config.webhook?.secret
        ? crypto.createHmac('sha256', config.webhook.secret).update(body).digest('hex')
        : '';

      const response = await fetch(config.webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': payload.timestamp,
        },
        body,
      });

      if (!response.ok) {
        logger.warn('Webhook send failed', { type, status: response.status });
        return false;
      }
      return true;
    } catch (error) {
      logger.error('Webhook error', { type, error: error.message });
      return false;
    }
  }

  async sendNewOrder(order, buyer, seller, store) {
    return this.send('new_order', {
      orderNumber: order.orderNumber,
      itemName: order.itemName,
      quantity: order.quantity,
      total: order.total,
      buyerId: buyer,
      sellerId: seller,
      storeName: store?.name || 'Unknown',
      status: order.status,
    });
  }

  async sendNewUser(userId, username) {
    return this.send('new_user', { userId, username });
  }

  async sendError(error, context = {}) {
    return this.send('error', { message: error.message, stack: error.stack, context });
  }
}

module.exports = new WebhookService();
