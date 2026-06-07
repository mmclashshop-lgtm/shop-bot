const { logger } = require('./logger');

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 30000;
    this.resetTimeout = options.resetTimeout || 60000;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = null;
  }

  async call(fn, fallback = null) {
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttempt) {
        this.state = 'HALF_OPEN';
        logger.info('CircuitBreaker ' + this.name + ': HALF_OPEN');
      } else {
        logger.warn('CircuitBreaker ' + this.name + ': OPEN, rejecting');
        if (fallback) return fallback();
        throw new Error('Circuit ' + this.name + ' is open');
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    let result;
    try {
      result = await fn(controller.signal);
    } catch (error) {
      clearTimeout(timeoutId);
      this.onFailure();
      if (fallback) return fallback();
      throw error;
    }
    clearTimeout(timeoutId);
    this.onSuccess();
    return result;
  }

  onSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.successCount = 0;
        logger.info('CircuitBreaker ' + this.name + ': CLOSED');
      }
    }
  }

  onFailure() {
    this.failureCount++;
    if (this.state === 'HALF_OPEN') {
      this.successCount = 0;
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
      logger.warn('CircuitBreaker ' + this.name + ': OPEN (failure in HALF_OPEN)');
      return;
    }
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
      logger.warn('CircuitBreaker ' + this.name + ': OPEN (threshold: ' + this.failureThreshold + ')');
    }
  }

  getState() {
    return { name: this.name, state: this.state, failureCount: this.failureCount, successCount: this.successCount };
  }
}

module.exports = CircuitBreaker;
