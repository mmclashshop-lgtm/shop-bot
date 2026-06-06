# DATABASE CHANGES REPORT

## Summary
Three new Mongoose models added (Payment, Withdrawal, Commission). One existing model (User) extended with new fields. Total: 3 new collections + 1 extended collection.

---

## New Collections

### 1. `payments`

**File:** `src/database/models/Payment.js`

**Indexes:**
| Index | Fields | Unique | Notes |
|-------|--------|--------|-------|
| paymentId | paymentId | Yes | Primary lookup |
| buyerId + status | buyerId (1), status (1) | No | User payment history |
| sellerId + status | sellerId (1), status (1) | No | Seller payment history |
| storeId + status | storeId (1), status (1) | No | Store payment history |
| referenceCode | referenceCode | Yes | Anti-replay |
| probotTransactionId | probotTransactionId | Sparse unique | Dedup check |
| expiresAt | expiresAt | No | TTL index (auto-delete) |

**Key fields:** paymentId, buyerId, sellerId, storeId, orderId, amount, commissionRate, commissionAmount, sellerAmount, status [pending/awaiting_verification/confirmed/completed/failed/expired/cancelled/disputed], probotTransactionId, referenceCode (8-char), verificationAttempts, expiresAt (30min TTL), fraudFlags [String], auditTrail [{ action, userId, timestamp, details }]

**TTL:** expiresAt field auto-deletes documents after expiry (cleanup every 60s)

### 2. `withdrawals`

**File:** `src/database/models/Withdrawal.js`

**Indexes:**
| Index | Fields | Unique | Notes |
|-------|--------|--------|-------|
| withdrawalId | withdrawalId | Yes | Primary lookup |
| userId + status | userId (1), status (1) | No | User withdrawal history |
| status + createdAt | status (1), createdAt (-1) | No | Pending/admin queries |
| userId + createdAt | userId (1), createdAt (-1) | No | Chronological user view |

**Key fields:** withdrawalId, userId, amount, fee, netAmount, status [pending/approved/rejected/processing/completed/cancelled], paymentMethod [probot_credits/bank/crypto/other], notes, reviewedBy, reviewedAt, balanceBefore, balanceAfter, processedAt, auditTrail [{ action, userId, timestamp, details }]

### 3. `commissions`

**File:** `src/database/models/Commission.js`

**Indexes:**
| Index | Fields | Unique | Notes |
|-------|--------|--------|-------|
| commissionId | commissionId | Yes | Primary lookup |
| storeId + createdAt | storeId (1), createdAt (-1) | No | Store reports |
| sellerId + createdAt | sellerId (1), createdAt (-1) | No | Seller reports |
| storeType + createdAt | storeType (1), createdAt (-1) | No | Type-based aggregation |
| paymentId | paymentId (1) | No | Payment lookup |

**Key fields:** commissionId, paymentId, storeId, sellerId, storeType [free/vip/premium/verified], rate, amount, sellerSplit, platformSplit, reversedAt

---

## Extended Collection

### `users`

**New fields added:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `platformEarnings` | Number | 0 | Internal balance for ProBot credit earnings |
| `totalEarned` | Number | 0 | Lifetime earnings through platform |

**Note:** These fields already existed in the User schema and are now being actively used by BalanceService.

---

## Migration

No migration script needed — Mongoose will create collections automatically on first document insert. All new fields have defaults (0) so existing documents remain valid.
