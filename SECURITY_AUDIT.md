# Security Audit Report

## Fixed Vulnerabilities

### CRITICAL: Double-Spend Race Condition (wallet pay/withdraw)
- **File**: `src/commands/wallet/main.js`
- **Fix**: Replaced read-then-write pattern with atomic `findOneAndUpdate` + `$inc` + `readConcern: 'snapshot'`
- **Attack**: Two concurrent requests could both see sufficient balance and both transfer, exceeding actual balance
- **Status**: ✅ FIXED

### CRITICAL: WEBHOOK_SECRET Empty Validation
- **File**: `src/config/index.js`
- **Fix**: Added startup crash if webhook port is configured but `WEBHOOK_SECRET` is < 32 characters
- **Attack**: Empty secret allows HMAC bypass → attacker can forge webhook callbacks
- **Status**: ✅ FIXED

### CRITICAL: In-Memory pendingActions Map → MongoDB TTL
- **Files**: `src/commands/wallet/main.js`, `src/database/models/PendingAction.js`
- **Fix**: Migrated from unbounded `Map` to MongoDB `PendingAction` model with 5-minute TTL index
- **Attack**: Memory exhaustion via unbounded pending action entries; data loss on restart
- **Status**: ✅ FIXED

### HIGH: Missing Rate Limits on Admin/Owner Endpoints
- **Files**: `src/commands/admin/main.js`, `src/commands/owner/main.js`, `src/cache/RateLimiter.js`, `src/config/index.js`
- **Fix**: Added admin quota 10/10s, owner quota 5/10s via `RateLimiter.consume()`
- **Attack**: Attacker with admin role can spam commands, causing resource exhaustion
- **Status**: ✅ FIXED

### HIGH: No Guild-Level AI Rate Limiting
- **File**: `src/services/AIService.js`
- **Fix**: Added 500 requests/day per guild, 250K tokens/day per guild via `_checkDailyLimits()`
- **Attack**: Single guild can exhaust AI quota for all users; unlimited AI requests cause cost overrun
- **Status**: ✅ FIXED

### HIGH: No IP Whitelist on Webhook Endpoints
- **Files**: `src/webhook/server.js`, `src/config/index.js`
- **Fix**: Added `WEBHOOK_ALLOWED_IPS` env variable; enforced in `_ipFilter` middleware
- **Attack**: Anyone who knows webhook URL can send fake ProBot transactions
- **Status**: ✅ FIXED

### HIGH: Review Deletion Without Audit Trail
- **File**: `src/commands/review/main.js`
- **Fix**: Added `auditService.log('review_deleted', ...)` before deletion
- **Attack**: Admin could delete reviews with no forensic trail
- **Status**: ✅ FIXED

### MEDIUM: MongoDB Operator Injection in User Input
- **File**: `src/utils/validation.js`
- **Fix**: Added `sanitizeMongoObject()` — strips `$`-prefixed keys from user-supplied objects recursively
- **Attack**: User sends `{ $ne: null }` as a query parameter → bypasses authorization
- **Status**: ✅ FIXED

### MEDIUM: Unhandled Promise Rejections
- **File**: `src/index.js`
- **Fix**: Added `process.on('unhandledRejection')` and `process.on('uncaughtException')` with logging
- **Attack**: Unhandled rejections crash Node.js process (deprecation → future crash)
- **Status**: ✅ FIXED

### MEDIUM: Commission Not in Transaction Scope
- **Files**: `src/services/PaymentService.js`, `src/services/CommissionService.js`
- **Fix**: Commission recording now accepts and uses the MongoDB session from parent transaction
- **Attack**: Transaction rolls back but commission record persists (or vice versa) → financial inconsistency
- **Status**: ✅ FIXED

### MEDIUM: CacheService Silent Redis Error Handling
- **File**: `src/cache/CacheService.js`
- **Fix**: Replaced empty error handlers `() => {}` with `(err) => logger.error(...)` and `reconnecting` handler
- **Attack**: Redis failures go undetected, returning stale data/undefined to callers
- **Status**: ✅ FIXED

## Remaining Security Advisories

### LOW: PanelManager Component IDs Expose Server Enumeration
- Component `customId` values are predictable strings (`panel_ai_chat`, `panel_wallet_view`, etc.)
- Attackers can enumerate available panels; no direct exploit, but reduces obscurity

### LOW: RateLimiter Key Enumeration via Timing
- `RateLimiterMemory` key format is predictable (`interaction:modal`, etc.)
- Cannot directly exploit; timing attacks on rate limits are impractical over Discord

### INFO: No CSRF Protection (N/A for Discord Bot)
- Discord interactions are signed by Discord; no CSRF vector exists

### INFO: Bot Token Exposed via Process Listing
- Standard Discord bot limitation; `DISCORD_TOKEN` is in environment variables
- Mitigation: OS-level process isolation, container sandboxing
