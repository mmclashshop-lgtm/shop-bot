const mongoose = require('mongoose');

async function ensureIndexes() {
  const db = mongoose.connection.db;
  if (!db) {
    console.warn('No database connection for index creation');
    return;
  }

  const { logger } = require('../utils/logger');
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map(c => c.name);

  const additions = [];

  // User: cooldowns lookups + platform earnings
  if (collectionNames.includes('users')) {
    additions.push(
      db.collection('users').createIndex({ 'cooldowns.search': 1 }, { background: true }).catch(() => {}),
      db.collection('users').createIndex({ 'cooldowns.ai': 1 }, { background: true }).catch(() => {}),
      db.collection('users').createIndex({ 'platformEarnings.total': -1 }, { background: true }).catch(() => {}),
    );
  }

  // Order: common list queries
  if (collectionNames.includes('orders')) {
    additions.push(
      db.collection('orders').createIndex({ buyerId: 1, createdAt: -1, type: 1 }, { background: true }).catch(() => {}),
      db.collection('orders').createIndex({ sellerId: 1, createdAt: -1, status: 1 }, { background: true }).catch(() => {}),
    );
  }

  // Transaction: pagination + filtering
  if (collectionNames.includes('transactions')) {
    additions.push(
      db.collection('transactions').createIndex({ userId: 1, createdAt: -1, type: 1 }, { background: true }).catch(() => {}),
    );
  }

  // Ticket: staff dashboards
  if (collectionNames.includes('tickets')) {
    additions.push(
      db.collection('tickets').createIndex({ assignedTo: 1, status: 1, priority: -1, createdAt: -1 }, { background: true }).catch(() => {}),
      db.collection('tickets').createIndex({ userId: 1, createdAt: -1 }, { background: true }).catch(() => {}),
    );
  }

  // AIChat: session cleanup + user history
  if (collectionNames.includes('aichats')) {
    additions.push(
      db.collection('aichats').createIndex({ userId: 1, guildId: 1, createdAt: -1, type: 1 }, { background: true }).catch(() => {}),
      db.collection('aichats').createIndex({ createdAt: 1 }, { expireAfterSeconds: 2592000, background: true }).catch(() => {}),
    );
  }

  // Payment: auto-confirm + probot transaction lookups
  if (collectionNames.includes('payments')) {
    additions.push(
      db.collection('payments').createIndex({ probotTransactionId: 1 }, { background: true, sparse: true }).catch(() => {}),
    );
  }

  await Promise.allSettled(additions);
  logger.info('Index optimization complete');
}

module.exports = { ensureIndexes };
