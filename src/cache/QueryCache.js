const { ttlJitter } = require('./CacheMonitor');

const TTL = {
  USER_PROFILE: ttlJitter(120),
  SETTINGS: ttlJitter(300),
  STORE: ttlJitter(180),
  MARKETPLACE: ttlJitter(300),
  AI_RESPONSE: ttlJitter(3600),
  PRODUCT: ttlJitter(180),
  SERVICE: ttlJitter(180),
  ORDER: ttlJitter(120),
  DASHBOARD: ttlJitter(60),
  TOP_SELLERS: ttlJitter(300),
};

const cache = require('./CacheService');
const { CacheMonitor } = require('./CacheMonitor');

async function getCached(key, fetchFn, ttl) {
  CacheMonitor.track('get');
  const cached = await cache.get(key);
  if (cached !== null) {
    CacheMonitor.track('get', true);
    return cached;
  }
  CacheMonitor.track('get', false);
  const value = await fetchFn();
  if (value !== null && value !== undefined) {
    CacheMonitor.track('set');
    await cache.set(key, value, ttl || TTL.STORE);
  }
  return value;
}

async function getUser(discordId, fetchFn) {
  return getCached(`market-ai:user:${discordId}`, fetchFn, TTL.USER_PROFILE);
}

async function getSettings(guildId, fetchFn) {
  return getCached(`market-ai:settings:${guildId || 'global'}`, fetchFn, TTL.SETTINGS);
}

async function getStore(storeId, fetchFn) {
  return getCached(`market-ai:store:${storeId}`, fetchFn, TTL.STORE);
}

async function getProduct(productId, fetchFn) {
  return getCached(`market-ai:product:${productId}`, fetchFn, TTL.PRODUCT);
}

async function getAIResponse(input, type, fetchFn) {
  const key = `market-ai:ai:${type}:${Buffer.from(input).toString('base64').slice(0, 40)}`;
  return getCached(key, fetchFn, TTL.AI_RESPONSE);
}

function invalidateUser(discordId) {
  cache.del(`market-ai:user:${discordId}`);
}

function invalidateSettings(guildId) {
  cache.del(`market-ai:settings:${guildId || 'global'}`);
}

function invalidateStore(storeId) {
  cache.del(`market-ai:store:${storeId}`);
}

function invalidateMarketplace() {
  cache.delPattern('market-ai:marketplace:*');
}

function invalidateDashboard() {
  cache.delPattern('market-ai:dashboard:*');
}

module.exports = {
  getCached,
  getUser, getSettings, getStore, getProduct, getAIResponse,
  invalidateUser, invalidateSettings, invalidateStore, invalidateMarketplace, invalidateDashboard,
  TTL,
};
