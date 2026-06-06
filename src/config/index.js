require('dotenv').config();

// Validate critical config on startup
const webhookPort = parseInt(process.env.WEBHOOK_PORT) || 0;
if (webhookPort > 0) {
  if (!process.env.WEBHOOK_SECRET || process.env.WEBHOOK_SECRET.length < 32) {
    console.error('FATAL: WEBHOOK_SECRET must be set and at least 32 characters when WEBHOOK_PORT is configured');
    process.exit(1);
  }
}

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    ownerId: process.env.OWNER_ID,
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/market-ai',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'qwen/qwen3-32b',
    baseURL: 'https://api.groq.com/openai/v1',
  },
  webhook: {
    url: process.env.WEBHOOK_URL,
    secret: process.env.WEBHOOK_SECRET,
    port: parseInt(process.env.WEBHOOK_PORT) || 0,
    allowedIps: process.env.WEBHOOK_ALLOWED_IPS || '',
  },
  probotApi: {
    key: process.env.PROBOT_API_KEY || '',
    baseUrl: process.env.PROBOT_API_URL || 'https://api.probot.io',
    enabled: process.env.PROBOT_API_ENABLED === 'true',
  },
  server: {
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
  },
  currency: {
    symbol: process.env.CURRENCY_SYMBOL || '💰',
    code: process.env.CURRENCY_CODE || 'SAR',
    name: process.env.CURRENCY_NAME || 'ريال سعودي',
  },
  commissions: {
    free: 0.10,
    vip: 0.05,
    premium: 0.03,
    verified: 0.01,
  },
  storeTypes: {
    FREE: 'free',
    VIP: 'vip',
    PREMIUM: 'premium',
    VERIFIED: 'verified',
  },
  trustLevels: {
    NONE: 'none',
    VERIFIED: 'verified',
    TRUSTED: 'trusted',
    PREMIUM: 'premium',
  },
  colors: {
    primary: 0x5865F2,
    success: 0x2ECC71,
    warning: 0xF39C12,
    error: 0xE74C3C,
    info: 0x3498DB,
    gold: 0xF1C40F,
    purple: 0x9B59B6,
  },
  emojis: {
    store: '🏪',
    product: '📦',
    wallet: '👛',
    money: '💰',
    star: '⭐',
    search: '🔍',
    ticket: '🎫',
    verified: '✅',
    trusted: '🏆',
    premium: '💎',
    ai: '🤖',
    service: '💼',
    coupon: '🎁',
    chart: '📊',
    settings: '⚙️',
    user: '👤',
    lock: '🔒',
    unlock: '🔓',
    plus: '➕',
    minus: '➖',
    edit: '✏️',
    delete: '🗑️',
    refresh: '🔄',
    arrowRight: '▶️',
    arrowLeft: '◀️',
  },
  limits: {
    maxStoresPerUser: 3,
    maxProductsPerStore: 100,
    maxServicesPerStore: 50,
    maxImagesPerProduct: 5,
    maxDescriptionLength: 2000,
    maxTitleLength: 100,
    cooldowns: {
      storeCreate: 3600000,
      productAdd: 5000,
      search: 3000,
      ai: 10000,
      ticketCreate: 300000,
    },
    rateLimits: {
      admin: { points: 10, duration: 10, blockDuration: 60 },
      owner: { points: 5, duration: 10, blockDuration: 120 },
    },
  },
  marketplace: {
    updateInterval: 300000,
    maxFeaturedStores: 5,
    maxTrendingProducts: 10,
    maxNewProducts: 10,
    maxTopRated: 10,
  },
  payment: {
    probotAccountId: process.env.PROBOT_ACCOUNT_ID || '',
    timeoutMinutes: 30,
    maxVerificationAttempts: 5,
    minWithdrawal: 1000,
    maxPendingWithdrawals: 5,
    withdrawalFee: 0,
    autoConfirm: {
      enabled: process.env.AUTO_CONFIRM_ENABLED === 'true',
      pollIntervalMs: parseInt(process.env.AUTO_CONFIRM_POLL_INTERVAL) || 30000,
      maxPendingPerCycle: parseInt(process.env.AUTO_CONFIRM_MAX_PER_CYCLE) || 10,
    },
  },
  loyalty: {
    pointsPerPurchase: 10,
    pointsPerReview: 5,
    pointsPerReferral: 50,
    rewards: {
      'discount_5': { cost: 500, name: 'خصم 5%', type: 'discount', value: 5 },
      'discount_10': { cost: 1000, name: 'خصم 10%', type: 'discount', value: 10 },
      'discount_20': { cost: 2000, name: 'خصم 20%', type: 'discount', value: 20 },
      'free_commission': { cost: 5000, name: 'إلغاء عمولة واحدة', type: 'commission_waiver', value: 1 },
      'store_boost': { cost: 10000, name: 'ترقية المتجر لأسبوع', type: 'store_boost', value: 7 },
      'verified_badge': { cost: 25000, name: 'شارة موثق', type: 'badge', value: 'verified' },
    },
  },
  aiChat: {
    categoryName: 'AI Chats',
    inactivityTimeoutHours: 24,
    cleanupIntervalMinutes: 30,
    cooldownMs: 2000,
    maxMessagesPerSession: 100,
    maxExportLength: 50000,
    normalExportLimit: 300,
    streamingExportLimit: 2000,
  },
  security: {
    maxWarnings: 3,
    banThreshold: 5,
    spamThreshold: 10,
    spamWindow: 60000,
    scamKeywords: ['scam', 'احتيال', 'نصب', 'fake', 'مزيف', 'stolen', 'مسروق'],
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    maxFiles: 30,
    maxSize: '10m',
  },
};