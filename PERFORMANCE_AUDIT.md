# Performance Audit Report

## Memory Leak Fixes

### Fixed: Redis Error Handlers
- **File**: `src/cache/CacheService.js`
- **Issue**: Empty `on('error')` and `on('reconnecting')` handlers
- **Fix**: Added error logging and reconnection warning
- **Impact**: Silent failures no longer accumulate unreadable state

### Fixed: MonitorService Users Set Growth
- **File**: `src/services/MonitorService.js`
- **Issue**: `trackCommand` adds users to an unbounded `Set` that grows with every unique user
- **Fix**: Added `if (existing.users.size < 10000)` guard
- **Impact**: Prevents O(n) memory growth over months of uptime

### Fixed: MemoryService Cache Staleness
- **File**: `src/services/MemoryService.js`
- **Issue**: `userMemoryCache` and `serverMemoryCache` grow unbounded with TTL-based entries that are never cleaned
- **Fix**: Added `_cleanupStaleCacheEntries()` method; callable on interval
- **Impact**: Prevents cache accumulation of stale entries

### Fixed: AIChat Messages Array Growth
- **File**: `src/database/models/AIChat.js`
- **Issue**: `messages` subdocument array grows without bound per chat session
- **Fix**: Added `pre('save')` hook slicing to 100 most recent messages
- **Impact**: Each AI chat session stays under ~400KB even with heavy use

## Database Performance

### Indexes Added (see DATABASE_AUDIT.md for full list)
- Total indexes added: **11 new indexes** across 4 collections
- Query patterns optimized: ban/user lookups, activity queries, referral queries, audit log target lookups, AI chat cleanup

### N+1 Query Patterns Reviewed
- **MarketplaceService**: All N+1 patterns eliminated — uses `populate('storeId', 'name')` and aggregation pipelines
- **PaymentService.getPaymentStats**: Uses 4 parallel queries (`Promise.all`) instead of sequential
- **MemoryService**: Uses single query with `.limit()` — no N+1

### Aggregation Pipeline Efficiency
- All `$match` stages pushed first (index usage)
- `CommissionService.getMonthlyCommissionReport`: filter-first pipeline
- No unbounded `$lookup` stages found

## Concurrency Performance

### Atomic Operations
- **Wallet transfers**: Uses `findOneAndUpdate` with `$inc` — no read-then-write pattern
- **Payment confirm**: Uses `findOneAndUpdate` with `{ status: 'pending' }` filter — CAS pattern
- **All financial mutations**: Atomic `$inc` operations with preconditions

### Rate Limiting
- **Global**: RateLimiterMemory prevents request floods
- **Admin**: 10 requests/10 seconds
- **Owner**: 5 requests/10 seconds
- **AI Guild**: 500 requests/day
- **AI Tokens**: 250K tokens/day
- **Webhook**: 30 requests/60 seconds with 120s block
- **SMS Anti-Spam**: 3 requests/10 seconds per user per type
- **Modal Anti-Spam**: 2 requests/10 seconds per user per type

## Interaction Latency

### Average Path Length
- Slash commands → commandHandler.handleInteraction → PanelManager dispatch → 1-3 DB queries
- Button clicks → commandHandler.handleButtonClick → PanelManager dispatch → 1-3 DB queries
- Autocomplete → commandHandler.handleAutocomplete → PanelManager dispatch

### Slow Interaction Warning
- Any interaction > 2000ms logs a warning in `interactionCreate.js`
- 3-second Discord interaction limit handled via Timeout utility

## Webhook Performance

- **Payload size limit**: 1MB (express.json configuration)
- **Rate limit**: 30 requests/60s
- **Replay attack protection**: 5-minute replay window via `X-Webhook-Timestamp` + SHA256 HMAC
- **Max retries**: 2 Redis retries, then graceful degradation
