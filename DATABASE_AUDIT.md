# Database Audit Report

## Model Validations Added

### User.js
| Field | Validation | Purpose |
|-------|-----------|---------|
| `username` | `minlength: 2, maxlength: 32` | Enforce Discord username limits |
| `discriminator` | `match: /^\d{4}$/` | Ensure 4-digit discriminator format |
| `loyaltyPoints` | `min: 0` | Prevent negative loyalty points |
| `stats.totalPurchases` | `min: 0` | Prevent negative counters |
| `stats.totalSales` | `min: 0` | Prevent negative counters |
| `stats.totalReviews` | `min: 0` | Prevent negative counters |
| `stats.averageRating` | `min: 0, max: 5` | Enforce rating range |

### Transaction.js
| Field | Validation | Purpose |
|-------|-----------|---------|
| `currency` | `enum: ['credits','usd','eur','sar','aed']` | Restrict to known currencies |
| `description` | `maxlength: 500` | Limit description length |
| `metadata.fee` | `min: 0` | Prevent negative fees |
| `metadata.netAmount` | `min: 0` | Prevent negative net amounts |

### AIChat.js
| Field | Validation | Purpose |
|-------|-----------|---------|
| `usage.promptTokens` | `min: 0` | Prevent negative token counts |
| `usage.completionTokens` | `min: 0` | Prevent negative token counts |
| `usage.totalTokens` | `min: 0` | Prevent negative token counts |
| `usage.cost` | `min: 0` | Prevent negative costs |
| `metadata.temperature` | `min: 0, max: 2` | Enforce model temperature range |
| `metadata.maxTokens` | `min: 1` | Ensure positive token limit |
| `metadata.responseTime` | `min: 0` | Prevent negative response time |

## Indexes Added

| Model | Index | Type | Purpose |
|-------|-------|------|---------|
| **User** | `{ isBanned: 1 }` | Regular | Fast ban lookups |
| **User** | `{ trustLevel: 1 }` | Regular | Fast trust level filtering |
| **User** | `{ username: 1 }` | Regular | Fast name searches |
| **User** | `{ 'stats.lastActive': -1 }` | Descending | Activity-based queries |
| **User** | `{ referredBy: 1 }` | Regular | Referral system queries |
| **AuditLog** | `{ createdAt: 1 }` | TTL (90 days) | Auto-cleanup old audit logs |
| **AuditLog** | `{ targetId: 1, targetType: 1 }` | Compound | Fast target lookups |
| **AuditLog** | `{ action: 1 }` | Regular | Fast action filtering |
| **AIChat** | `{ createdAt: 1 }` | TTL (30 days) | Auto-cleanup old AI chats |
| **Transaction** | `{ relatedTransactionId: 1 }` | Regular | Transaction linking |
| **Payment** | `{ idempotencyKey: 1 }` | Regular (unique if sparse) | Idempotency lookup |

## MongoDB Transaction Fixes

### PaymentService._completePayment
- Added `readConcern: { level: 'snapshot' }` — prevents phantom reads
- Added `writeConcern: { w: 'majority' }` — ensures data durability
- Commission recording now participates in the same transaction session

### PaymentService._expireStalePayments
- Uses `updateMany` with atomic `$set` + `$push` — safe for concurrent expiry

## Data Integrity Protections

### Financial Counters (all models)
- `balance`, `platformEarnings`, `totalSpent`, `totalEarned`, `loyaltyPoints` → `min: 0`
- All `stats.*` counters → `min: 0`
- All `usage.*` counters → `min: 0`

### Array Growth Protection
- **AIChat**: Pre-save hook caps `messages` to 100 entries (avoid unbounded array growth)
- **MemoryService**: User facts capped to 50 entries
- **MonitorService.trackCommand**: `users` set capped at 10,000 entries

## TTL (Auto-Cleanup) Indexes

| Collection | TTL | Purpose |
|-----------|-----|---------|
| `AIChat` | 30 days | Remove old AI conversation history |
| `AuditLog` | 90 days | Remove old audit logs |
| `PendingAction` | 5 minutes | Auto-expire pending payment actions |
