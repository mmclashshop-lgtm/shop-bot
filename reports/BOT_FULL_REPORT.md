# 🤖 Market AI Bot — Full Report

**Bot:** Discord Marketplace Bot with AI Integration  
**Language:** Node.js (JavaScript)  
**Database:** MongoDB (Mongoose ODM)  
**Cache:** Redis + In-Memory Fallback  
**AI Provider:** Groq (OpenAI-compatible)  
**Discord Library:** discord.js v14  
**Payment:** ProBot API Integration  
**Currency:** SAR (ريال سعودي)  
**UI Language:** Arabic (RTL)  
**Deployment:** Docker + GitHub Actions CI  
**Test Framework:** Jest (154 tests, 18 suites)

---

## 1. Project Structure

```
shop-bot/
├── src/
│   ├── index.js                 # Entry point — MarketAIBot class
│   ├── deploy-commands.js       # Slash command registration
│   ├── config/index.js           # Environment-based configuration
│   ├── cache/                    # 7 files — Redis + in-memory caching
│   ├── commands/                 # 25 command modules
│   ├── database/
│   │   ├── indexes.js            # Index management
│   │   └── models/              # 23 Mongoose models
│   ├── events/                   # 5 Discord event handlers
│   ├── handlers/                 # Command & event dispatchers
│   ├── interactions/embeds/      # AI embed builders
│   ├── middleware/               # Security & monitoring middleware
│   ├── services/                 # 18 business logic services
│   ├── utils/                    # 10 utility modules
│   └── webhook/                  # Express webhook server
├── tests/                        # 18 test suites (154 tests)
├── reports/                      # System analysis reports
├── .env                          # Environment variables
├── .env.example
├── package.json
├── jest.config.js
├── Dockerfile
└── docker-compose.yml
```

---

## 2. Dependencies (package.json)

### Runtime
| Package | Version | Purpose |
|---------|---------|---------|
| discord.js | ^14.14.1 | Discord API |
| mongoose | ^8.1.1 | MongoDB ODM |
| ioredis | ^5.3.2 | Redis client |
| openai | ^4.24.7 | Groq AI API |
| express | ^4.18.2 | Webhook server |
| winston | ^3.11.0 | Logging |
| cron / node-cron | latest | Scheduled tasks |
| rate-limiter-flexible | ^5.0.3 | Rate limiting |
| validator | ^13.11.0 | Input validation |
| pdfkit | ^0.18.0 | PDF generation |
| moment / ms | latest | Time utilities |
| dotenv | ^16.3.1 | Env management |

### Dev
- eslint ^8.56.0
- jest ^29.7.0
- prettier ^3.2.5

### Scripts
- `npm start` — `node src/index.js`
- `npm run dev` — `node --watch src/index.js`
- `npm run deploy` — `node src/deploy-commands.js`
- `npm test` — `jest`
- `npm run lint` — `eslint src/`

---

## 3. Entry Point — `src/index.js`

**Class: `MarketAIBot`** — Main bot controller

**Initialization flow:**
1. Creates Discord.js `Client` with intents: Guilds, GuildMessages, GuildMembers, MessageContent, GuildModeration, GuildVoiceStates
2. Initializes `CommandHandler`, `EventHandler`, `HealthService`, `AIChatSessionManager`
3. Connects to MongoDB
4. Connects to Redis (optional — graceful fallback to in-memory cache)
5. Registers event listeners
6. Starts services: `MonitorService`, `AISecurityService`, `PaymentService`, `FraudDetectionService`, `ProBotMonitorService`, `BackupService`, `AlertService`, `CacheInvalidator`, `WebhookServer`, `AIChatSessionManager`
7. Logs in to Discord with token

**Bot Shutdown:** Handles SIGTERM/SIGINT — closes all services gracefully

---

## 4. Configuration — `src/config/index.js`

```js
discord:     { token, clientId, guildId, ownerId }
mongodb:     { uri }
redis:       { host, port, password }
groq:        { apiKey, model (default: qwen/qwen3-32b), baseURL }
webhook:     { url, secret, port, allowedIps }
probotApi:   { key, baseUrl, enabled }
server:      { port (default: 3000), host (default: 0.0.0.0) }
currency:    { symbol (💰), code (SAR), name (ريال سعودي) }
commissions: { free: 10%, vip: 5%, premium: 3%, verified: 1% }
storeTypes:  { FREE, VIP, PREMIUM, VERIFIED }
trustLevels: { NONE, VERIFIED, TRUSTED, PREMIUM }
colors:      { primary, success, warning, error, info, gold, purple }
emojis:      { store, product, wallet, money, star, search, ticket, ... }
limits:      { maxStoresPerUser: 3, maxProductsPerStore: 100, cooldowns, rateLimits }
marketplace: { updateInterval: 5min, maxFeaturedStores: 5, ... }
payment:     { timeoutMinutes: 30, minWithdrawal: 1000, autoConfirm, ... }
loyalty:     { pointsPerPurchase: 10, rewards: discount_5/10/20, free_commission, store_boost, verified_badge }
aiChat:      { inactivityTimeoutHours: 24, cooldownMs: 2000, maxMessagesPerSession: 100 }
security:    { maxWarnings: 3, scamKeywords: ['scam', 'احتيال', 'نصب', 'fake', ...] }
logging:     { level: 'info', maxFiles: 30, maxSize: '10m' }
```

---

## 5. Database Models (23 Models) — `src/database/models/`

### User
```
discordId, username, globalName, discriminator, avatar, email
isBanned, banReason, banDate
platformEarnings, totalEarned, totalSpent
cooldowns: { storeCreate, productAdd, search, ai, ticketCreate }
warnings: [{ reason, issuedBy, issuedAt }]
stats: { totalSales, totalPurchases, totalReviews, totalTickets, joinedAt }
lastActive, lastCommandAt
referralCode, referredBy
trustLevel, isVerifiedSeller, isPremiumBuyer
createdAt, updatedAt
Indexes: discordId, email, referralCode
```

### Store
```
ownerId, name, description, type (free/vip/premium/verified)
isActive, isSuspended, isFeatured
featuredExpiresAt
images: [{ url, isPrimary }]
socialLinks: { discord, telegram, website }
stats: { totalRevenue, totalSales, totalProducts, totalServices, rating, totalReviews }
settings: { autoResponder, requireApproval, commissionRate }
createdAt, updatedAt
Indexes: ownerId, name, type, isActive, isFeatured
```

### Product
```
storeId, name, description, price, type, category
images: [{ url, isPrimary }]
stock, isActive, isDigital, isLimited
limitedTo: { roles: [], users: [] }
downloadUrl, fileSize
metadata: {}
stats: { totalSold, totalRevenue, rating, totalReviews }
createdAt, updatedAt
Indexes: storeId, name, type, category, isActive, price
```

### Service
*(Same structure as Product but for services)*
```
storeId, name, description, price, type, category
deliveryType, deliveryTime, requirements
...
Indexes: storeId, name, type, category, isActive, price
```

### Order
```
orderNumber (ORD- prefix)
storeId, productId/serviceId, type (product/service)
buyerId, sellerId
quantity, unitPrice, total, commissionAmount, sellerAmount, platformAmount
status (pending/confirmed/shipped/delivered/completed/disputed/refunded/cancelled)
paymentId, paymentMethod
notes, disputeReason, resolvedAt
timeline: [{ status, timestamp, by }]
createdAt, updatedAt
Indexes: orderNumber, buyerId, sellerId, storeId, status
```

### Payment
```
paymentId (PAY- prefix)
storeId, orderId, buyerId, sellerId
amount, commissionAmount, sellerAmount, platformAmount
currency, status (pending/verified/confirmed/completed/failed/expired/cancelled)
paymentMethod (probot/manual/coins)
idempotencyKey (unique)
referenceCode
verifiedBy, verifiedAt
auditTrail: [{ action, timestamp, by, details }]
commissionRate
metadata: {}
createdAt, updatedAt
Indexes: paymentId, storeId, buyerId, sellerId, status, idempotencyKey (unique)
```

### Transaction
```
transactionId, type (sale/commission/withdrawal/refund/fee)
amount, currency, status
orderId, paymentId, userId, storeId
description, metadata: {}
createdAt
Indexes: transactionId, userId, storeId, type, status
```

### Withdrawal
```
withdrawalId (WTH- prefix)
userId, amount, fee, netAmount
status (pending/approved/rejected/completed/cancelled)
paymentMethod, paymentDetails
adminId, approvedAt, completedAt
notes, reason
createdAt
Indexes: withdrawalId, userId, status
```

### Review
```
storeId, productId/serviceId, type (product/service)
authorId, rating (1-5), title, content, isVerifiedPurchase
sellerResponse: { content, repliedAt }
createdAt, updatedAt
Indexes: storeId, productId, authorId
```

### Ticket
```
ticketNumber (TKT- prefix)
storeId, productId/serviceId, type (product/service)
buyerId, sellerId, orderId
subject, description, status (open/responded/resolved/closed)
priority (low/medium/high/urgent)
messages: [{ authorId, content, timestamp, attachments }]
createdAt, updatedAt
Indexes: ticketNumber, buyerId, sellerId, storeId, status
```

### Coupon
```
code, storeId, type (percentage/fixed)
value, minPurchase, maxUses, usedCount
isActive, expiresAt
allowedUsers: [], allowedRoles: []
createdBy, createdAt, updatedAt
Indexes: code, storeId
```

### Commission
```
storeId, orderId, sellerId, type (store/product)
rate, amount, status
createdAt
Indexes: storeId, sellerId, status
```

### MarketplaceSettings
```
guildId, updateInterval, maxFeaturedStores, maxTrendingProducts
featuredStores: [], excludedStores: []
categories: {}
lastUpdated, updatedAt
```

### AIChat
```
channelId, userId, guildId, type (public/private)
isActive, messageCount, lastActivity
createdAt, updatedAt
Indexes: channelId, userId, guildId
```

### LoyaltyReward
```
userId, points, lifetimePoints
redeemedRewards: [{ rewardId, redeemedAt }]
lastUpdated
```

### AuditLog
```
action, userId, guildId, targetId, targetType
details: {}, timestamp
```

### FraudAlert
```
alertId, type (transfer/withdrawal/rapid/multi-account)
severity (warning/suspicious/high_risk/fraud)
userId, targetId, amount, reason, evidence: {}
isResolved, resolvedAt, resolvedBy
createdAt
Indexes: alertId, userId, type, severity, isResolved
```

### BackupLog
```
backupId, type (daily/weekly/monthly/manual), status (running/completed/failed)
filePath, compressedSizeBytes, durationMs
stats: { databases, collections, documents, size }
error: { message, stack }
createdAt, completedAt
Indexes: backupId, type, status
```

### Role *(Custom RBAC)*
```
guildId, name, level (0-100), permissions: [], discordRoleId, isDefault
color, hoist, mentionable
createdAt, updatedAt
Indexes: { guildId, level }, { guildId, discordRoleId } (sparse)
```

### ServerSettings
```
guildId, prefix, locale, timezone
modules: {}
createdAt, updatedAt
```

### SettingsHistory
```
guildId, setting, oldValue, newValue, changedBy, changedAt
```

### PendingAction
```
actionId, type, userId, guildId, data: {}, expiresAt, createdAt
```

### AlertLog
```
guildId, type, severity, title, description, userId, metadata: {}, isRead, createdAt
```

---

## 6. Services (19 files)

| Service | File | Key Methods |
|---------|------|-------------|
| **AIService** | `AIService.js` | `getAIResponse()`, `streamAIResponse()`, `getUsageStats()` |
| **AIChatSessionManager** | `AIChatSessionManager.js` | `createSession()`, `sendMessage()`, `destroy()`, session lifecycle mgmt |
| **AISecurityService** | `AISecurityService.js` | `validatePrompt()`, `sanitizeOutput()`, `checkRateLimit()` |
| **AlertService** | `AlertService.js` | `sendAlert()`, `checkErrorRate()`, `checkPaymentFailure()` |
| **AuditService** | `AuditService.js` | `log()` |
| **BackupService** | `BackupService.js` | `startBackup()`, `scheduleBackups()`, `getBackup()`, `listBackups()`, `getStatus()`, `getHealth()`, `getStorageStats()`, `restoreBackup()`, `stop()` |
| **BalanceService** | `BalanceService.js` | `getSellerBalance()`, `getPlatformBalance()`, `getTopSellers()`, `getWithdrawal()`, `getUserWithdrawals()`, `getWithdrawalStats()`, `getMonthlyRevenue()` |
| **CommissionService** | `CommissionService.js` | `getEffectiveCommissionRate()`, `calculateCommission()`, `recordCommission()` |
| **FraudDetectionService** | `FraudDetectionService.js` | `checkWalletTransfer()`, `checkWithdrawal()`, `getAllAlerts()`, `getAlertById()`, `archiveOldAlerts()` |
| **HealthService** | `HealthService.js` | `getHealth()`, `getStatus()` |
| **MarketplaceService** | `MarketplaceService.js` | Marketplace listing, trending, featured logic |
| **MemoryService** | `MemoryService.js` | User memory/conversation persistence |
| **MonitorService** | `MonitorService.js` | `trackCommand()`, `trackError()`, `trackPayment()`, `trackInteraction()`, `getSnapshot()`, `getErrorReport()`, `getPerformanceReport()`, `reset()` |
| **PaymentService** | `PaymentService.js` | `createPayment()`, `getPayment()`, `verifyPayment()`, `confirmPayment()`, `autoConfirmPayment()`, `cancelPayment()`, `getUserPayments()`, `getPaymentStats()`, `generatePaymentId()` |
| **PermissionService** | `PermissionService.js` | `ensureDefaultRoles()`, `getUserLevel()`, `hasPermission()`, `requirePermission()`, `createPermissionGuard()`, `addRole()`, `updateRole()`, `removeRole()`, `listRoles()`, `getEffectivePermissions()` |
| **ProBotApiService** | `ProBotApiService.js` | ProBot API integration for payments |
| **ProBotMonitorService** | `ProBotMonitorService.js` | Payment monitoring via ProBot |
| **SettingsService** | `SettingsService.js` | Guild settings CRUD |
| **WebhookService** | `WebhookService.js` | `send(type, data)`, `sendNewOrder()`, `sendNewUser()`, `sendError()` |

---

## 7. Cache Layer — `src/cache/`

| File | Purpose |
|------|---------|
| `CacheService.js` | Redis with in-memory fallback — `get()`, `set()`, `del()`, `delPattern()`, `exists()`, `ttl()`, `keys()` |
| `CacheMonitor.js` | Hit/miss tracking, TTL jitter utility |
| `CacheInvalidator.js` | Write-event-driven cache invalidation for 6 models (User, Store, Product, Order, Payment, MarketplaceSettings) |
| `QueryCache.js` | Typed getCached helpers with TTL jitter — `getCached()`, `getUser()`, `getSettings()`, `getStore()`, `getProduct()`, `getAIResponse()` |
| `RateLimiter.js` | Rate limiting service |
| `cacheHelper.js` | Cache key generation helpers |
| `index.js` | Unified exports |

---

## 8. Middleware — `src/middleware/`

### `security.js` — 8 exported functions
| Function | Purpose |
|----------|---------|
| `antiSpam(interaction, next)` | Rate-limit per user + auto-ban after max warnings |
| `antiScam(interaction, next)` | Detect scam keywords in content |
| `checkBan(interaction, next)` | Block banned users |
| `checkCooldown(interaction, next)` | Enforce command cooldowns |
| `setCooldown(interaction, next)` | Set cooldown after command execution |
| `validateOwnership(interaction, next)` | Verify store ownership for protected commands |
| `validateStoreActive(interaction, next)` | Check store is active/not suspended |
| `logCommand(interaction, next)` | Log command execution to logger |

### `mongoMonitor.js`
- Monitors MongoDB connection status and ops

---

## 9. Webhook System — `src/webhook/server.js`

**Class: `WebhookServer`** — Express-based HTTP server

### Middleware Stack
1. `express.json({ limit: '1mb' })`
2. Security headers (X-Content-Type-Options, X-Frame-Options)
3. IP whitelist filter (`config.webhook.allowedIps`)
4. Request logger (method, path, status, duration)
5. HMAC-SHA256 signature verification for `/api/webhook/*`
6. Rate limiter (30 req/60s per IP)
7. Replay attack protection (5min window via timestamp)

### Routes
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Health check — uptime, DB state, memory |
| `GET` | `/api/metrics` | Prometheus-style metrics |
| `POST` | `/api/webhook/:source` | External webhook receiver (ProBot etc.) |
| `*` | `/*` | 404 fallback |

### WebhookService
- `send(type, data)` — Sends webhook with HMAC signature
- `sendNewOrder(order, buyer, seller, store)`
- `sendNewUser(userId, username)`
- `sendError(error, context)`

---

## 10. Events — `src/events/`

| File | Event | Purpose |
|------|-------|---------|
| `ready.js` | `ready` | Bot startup — set status, register commands, start services |
| `interactionCreate.js` | `interactionCreate` | Route all interactions (slash commands, buttons, modals, selects) |
| `messageCreate.js` | `messageCreate` | Handle AI chat messages, prefix commands |
| `warn.js` | `warn` | Log Discord client warnings |
| `error.js` | `error` | Log Discord client errors |

---

## 11. Handlers — `src/handlers/`

| File | Purpose |
|------|---------|
| `commandHandler.js` | Load and register slash commands from `src/commands/` directories |
| `eventHandler.js` | Load and register event listeners from `src/events/` |

---

## 12. Commands — 25 Modules

```
admin/          — Administrative commands
ai-status/      — AI service status
ai/             — AI chat interactions
alert/          — Alert management
backup/         — Database backup management
coupon/         — Coupon CRUD
dashboard/      — Dashboard statistics
loyalty/        — Loyalty points & rewards
market/         — Market overview
marketplace/    — Marketplace browsing
monitor/        — System monitoring
owner/          — Owner-only commands
payment/        — Payment processing
product/        — Product CRUD
profile/        — User profile
review/         — Review & rating
search/         — Search products/services
service/        — Service CRUD
settings/       — Guild settings
store/          — Store CRUD
tax/            — Tax management
ticket/         — Ticket/support system
trust/          — Trust level management
wallet/         — Wallet management
withdraw/       — Withdrawal requests
```

---

## 13. Utilities — `src/utils/`

| File | Exports | Purpose |
|------|---------|---------|
| `logger.js` | `logger` (winston) | Logging with levels, files, console |
| `errors.js` | 10 error classes | `AppError`, `ValidationError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `RateLimitError`, `InsufficientFundsError`, `AIError`, `DatabaseError` |
| `helpers.js` | 25+ functions | `generateOrderNumber()`, `generateTicketNumber()`, `generateReferralCode()`, `generateCouponCode()`, `formatCurrency()`, `formatNumber()`, `calculateCommission()`, `calculateDiscount()`, `calculateFinalPrice()`, `isValidUrl()`, `sanitizeInput()`, `truncate()`, `slugify()`, `clamp()`, `chunkArray()`, `toArabicNumbers()`, `toEnglishNumbers()` |
| `validation.js` | `validateStoreCreate`, `validateProductCreate`, `validateServiceCreate`, `validateReviewCreate` + primitive validators | Input validation |
| `embeds.js` | `createEmbed()`, `createErrorEmbed()`, `createSuccessEmbed()`, `createWarningEmbed()`, `createInfoEmbed()`, `createStoreEmbed()`, `createProductEmbed()`, etc. | Discord embed builders |
| `pagination.js` | `class Pagination` | `getPage()`, `toSelectMenu()`, `navigationRow()`, `handleButton()`, `parseCustomId()`, `createButtons()`, `createPageEmbed()` |
| `export.js` | `toCSV()`, `toJSON()`, `escapeCSV()`, `exportOrders()`, `exportTransactions()`, `exportProducts()` | Data export utilities |
| `PanelManager.js` | Panel management | UI panel helpers |
| `Timeout.js` | Timeout utility | Promise-based timeout wrapper |
| `CircuitBreaker.js` | `CircuitBreaker` class | Circuit breaker pattern for external API calls |

---

## 14. Test Suite — 18 Suites, 154 Tests

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `tests/services/PermissionService.test.js` | 21 | RBAC hierarchy, level resolution, guards, CRUD |
| `tests/services/PaymentService.test.js` | 8 | Idempotency, validation, creation, stats |
| `tests/services/BalanceService.test.js` | 9 | Balance, top sellers, withdrawals, revenue |
| `tests/services/FraudDetectionService.test.js` | 6 | Transfer/withdrawal fraud, alerts, archive |
| `tests/services/BackupService.test.js` | 7 | Health, storage, CRUD, status |
| `tests/services/MonitorService.test.js` | 5 | Command/error/payment tracking, reports |
| `tests/cache/CacheMonitor.test.js` | 9 | Hit/miss tracking, hitRate, reset, ttlJitter |
| `tests/cache/CacheInvalidator.test.js` | 7 | Rules, queuing, flush, wildcard patterns |
| `tests/cache/QueryCache.test.js` | 7 | getCached hit/miss, typed helpers, invalidation |
| `tests/webhook/server.test.js` | 4 | Health, metrics, auth, 404 |
| `tests/webhook/WebhookService.test.js` | 3 | Send success/failure, HMAC signature |
| `tests/middleware/security.test.js` | 6 | Ban, ownership, anti-scam |
| `tests/database/models.test.js` | 6 | Role schema, User schema validation |
| `tests/utils/helpers.test.js` | 20 | Numbers, codes, formatting, validation, utility |
| `tests/utils/validation.test.js` | 16 | String, number, boolean, URL, Discord ID, array |
| `tests/utils/pagination.test.js` | 5 | parseCustomId, createButtons, createPageEmbed |
| `tests/utils/errors.test.js` | 10 | All error classes |
| `tests/utils/export.test.js` | 6 | CSV, JSON, orders, transactions, products |

---

## 15. Permission System (RBAC)

**7 Permission Levels:**
| Level | Name (Arabic) | Name (English) |
|-------|---------------|----------------|
| 0 | محظور | BLOCKED |
| 10 | مستخدم | USER |
| 20 | عضو | MEMBER |
| 30 | دعم | SUPPORT |
| 40 | مشرف | MOD |
| 50 | مدير | ADMIN |
| 60 | مالك | OWNER |
| 100 | نظام | SYSTEM |

**35+ Permissions:** `market:view`, `store:create`, `product:manage`, `order:manage`, `payment:manage`, `withdrawal:manage`, `ticket:manage`, `review:manage`, `coupon:manage`, `settings:manage`, `backup:manage`, `monitor:view`, `alert:manage`, `ai:chat`, `admin:manage`, `owner:manage`, `system:config`, etc.

---

## 16. Commission Tiers

| Store Type | Commission Rate |
|-----------|----------------|
| FREE | 10% |
| VIP | 5% |
| PREMIUM | 3% |
| VERIFIED | 1% |

---

## 17. Key Business Rules

- **Max stores per user:** 3
- **Max products per store:** 100
- **Max services per store:** 50
- **Max images per product:** 5
- **Payment timeout:** 30 minutes
- **Min withdrawal:** 1000 SAR
- **Max pending withdrawals:** 5
- **Loyalty points:** 10 per purchase, 5 per review, 50 per referral
- **AI cooldown:** 2 seconds
- **Max AI messages per session:** 100
- **Ban threshold:** 3 warnings → auto-ban
- **Verification attempts max:** 5

---

## 18. Security Features

- Rate limiting (global + per-interaction type)
- Anti-spam with progressive warnings → auto-ban
- Anti-scam keyword detection
- Ban system with reason tracking
- Command cooldowns
- HMAC-SHA256 webhook verification
- IP whitelist for webhook server
- Replay attack protection (5min timestamp window)
- Content sanitization (`@everyone` etc.)
- Input validation on all CRUD operations

---

## 19. Deployment

### Docker
- `Dockerfile` — Node.js 18+ container
- `docker-compose.yml` — Bot + Redis sidecar
- Health checks configured

### CI/CD
- GitHub Actions workflow (`.github/workflows/ci.yml`)
- Runs lint + tests on push

---

## 20. Recent Improvements (Priority 1 Remediation)

- 130+ `.lean()` calls added across 26 files (Mongoose query optimization)
- 27 empty catch blocks replaced with `logger.error()`
- Timer leak fixed in `AIChatSessionManager` (all `setTimeout` tracked via `_setTimeout()`)
- `BackupService` converted from sync `fs.*Sync()` to async `fsp.*` (16 calls)
- `execSync(df)` → `execAsync()` for disk stats
- PermissionService RBAC with Arabic interface
- Cache Layer v2: `CacheMonitor`, `CacheInvalidator`, `QueryCache` TTL jitter
- 154 passing tests across 18 test suites
