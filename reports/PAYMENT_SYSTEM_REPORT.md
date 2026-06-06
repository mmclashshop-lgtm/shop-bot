# PAYMENT SYSTEM REPORT — ProBot Credits Integration

## Overview
The Marketplace payment system has been upgraded to support **ProBot Credits** as the primary payment method using a **platform escrow model**. This report covers the new database models, services, commands, and integration points.

## Architecture

```
Buyer → pays ProBot Credits → Platform ProBot Account
         ↓
    Payment created (status: pending)
         ↓
  ┌── [Manual] ──────────────┬── [Auto-Confirm] ───────┐
  │                          │                          │
Buyer submits ProBot txn    Webhook receives txn       ProBotMonitorService
(/payment verify)           (POST /api/webhook/probot)  polls pending payments
         ↓                          ↓                          ↓
  Payment: awaiting_verification   Auto-verify + confirm     Auto-confirm
         ↓                          ↓                          ↓
Staff confirms payment         ── Payment completed ──
(/payment confirm or button)         ↓                          ↓
         ↓                    Seller credited               Seller credited
  ── Payment completed ──
         ↓
```

### Auto-Confirm Flow
```
                              ┌─────────────────────────────┐
                              │    Webhook Server           │
                              │  GET  /api/health           │
                              │  GET  /api/metrics          │
                              │  POST /api/webhook/probot   │
                              │  POST /api/webhook/probot/verify │
                              │  POST /api/webhook/probot/confirm│
                              └──────────┬──────────────────┘
                                         │ HTTP POST { paymentId, transactionId, secret }
                                         ▼
                              ┌─────────────────────────────┐
                              │  ProBotMonitorService        │
                              │  • autoConfirmByTransaction()│
                              │  • _checkPendingPayments()   │
                              │    (polling every 30s)       │
                              └──────────┬──────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────────────┐
                              │  PaymentService              │
                              │  • verifyPayment()           │
                              │  • autoConfirmPayment()       │
                              │  • _completePayment()         │
                              └─────────────────────────────┘
```

### Manual Flow (Original)
```
Buyer → /product buy or /service order (payment_method: probot)
         ↓
    Payment created (status: pending)
         ↓
Buyer transfers credits → sends to platform's ProBot account
         ↓
Buyer runs /payment verify payment_id:<id> transaction_id:<txn_id>
         ↓
    Payment status: awaiting_verification
         ↓
Admin confirms via /payment confirm or log channel button
         ↓
PaymentService.confirmPayment() — MongoDB atomic session:
  • Credit seller's platformEarnings
  • Deduct commission via CommissionService
  • Update store stats (totalRevenue, totalCommission)
  • Create order (if applicable)
  • Update product/service stock
  • Record Transaction records (purchase + sale + commission)
  • Write to AuditLog
         ↓
Seller withdraws earnings via /withdraw request
         ↓
Staff approves (/withdraw approve) → credits returned to seller
```

## New Database Models

### Payment (`src/database/models/Payment.js`)
| Field | Type | Description |
|-------|------|-------------|
| paymentId | String (unique) | Human-readable ID (PAY-XXXXXX) |
| buyerId | String | Discord ID of buyer |
| sellerId | String | Discord ID of seller |
| storeId | ObjectId | Store reference |
| orderId | ObjectId | Order reference (optional, set on confirm) |
| amount | Number | Total payment amount |
| commissionRate | Number | Commission rate (0-1) |
| commissionAmount | Number | Platform commission |
| sellerAmount | Number | Net seller earnings |
| status | String | pending → awaiting_verification → confirmed → completed |
| probotTransactionId | String | ProBot txn ID (unique check) |
| referenceCode | String | 8-char unique reference code |
| verificationAttempts | Number | Max 5 attempts |
| expiresAt | Date | 30-min TTL |
| fraudFlags | [String] | duplicate_txn, suspicious_amount, rapid_attempts, etc. |
| auditTrail | [Object] | Timestamped action log |
| Indexes: 7 compound indexes | | buyerId+status, sellerId+status, referenceCode, etc. |

### Withdrawal (`src/database/models/Withdrawal.js`)
| Field | Type | Description |
|-------|------|-------------|
| withdrawalId | String (unique) | Human-readable ID (WTH-XXXXXX) |
| userId | String | Discord ID |
| amount/fee/netAmount | Number | With full fee breakdown |
| status | String | pending → approved/rejected → processing → completed/cancelled |
| paymentMethod | String | probot_credits, bank, crypto, other |
| notes | String | User-provided details |
| reviewedBy/reviewedAt | String/Date | Staff review tracking |
| balanceBefore/After | Number | User's platformEarnings snapshot |
| auditTrail | [Object] | Timestamped action log |
| Indexes: 4 compound indexes | | userId+status, status+createdAt, etc. |

### Commission (`src/database/models/Commission.js`)
| Field | Type | Description |
|-------|------|-------------|
| commissionId | String (unique) | Human-readable ID (COM-XXXXXX) |
| paymentId | String | Payment reference |
| storeId | ObjectId | Store reference |
| sellerId | String | Discord ID |
| storeType | String | free, vip, premium, verified |
| rate/amount | Number | Rate (0-1) and absolute amount |
| sellerSplit/platformSplit | Number | How revenue is divided |
| reversedAt | Date | If commission is reversed |
| Indexes: 5 compound indexes | | storeId+createdAt, sellerId+createdAt, etc. |

## New Commands

### `/payment`
| Sub-command | Permission | Description |
|-------------|-----------|-------------|
| status | Owner + Admin | View payment details |
| verify | Owner | Submit ProBot transaction ID |
| cancel | Owner | Cancel a pending payment |
| history | Owner | View all user payments |
| pending | Admin | List payments awaiting confirmation |
| confirm | Admin | Confirm a payment (credits seller) |

### `/withdraw`
| Sub-command | Permission | Description |
|-------------|-----------|-------------|
| request | Owner | Request withdrawal of platformEarnings |
| balance | Owner + Admin | View current platformEarnings balance |
| history | Owner | View withdrawal history |
| pending | Admin | List pending withdrawal requests |
| approve | Admin | Approve withdrawal |
| reject | Admin | Reject withdrawal with reason |

## Commission Rates (Config-driven)

| Store Type | Rate | Config Key |
|------------|------|------------|
| Free | 10% | commissions.free |
| VIP | 5% | commissions.vip |
| Premium | 3% | commissions.premium |
| Verified | 1% | commissions.verified |

## Security Measures

1. **Payment ownership**: All payment operations verify `buyerId === interaction.user.id`
2. **Duplicate txn prevention**: ProBot transaction IDs checked before status change
3. **Verification attempt cap**: Max 5 attempts per payment
4. **Fraud flagging**: Automatic detection of suspicious patterns
5. **Audit trail**: Every status change, verification attempt, and cancellation logged
6. **Payment expiry**: 30-minute TTL enforced by background cleanup every 60s
7. **MongoDB transactions**: Atomic sessions for all financial operations
8. **Reference codes**: 8-char unique codes prevent replay attacks

## Integration Points

| File | Change Required | Status |
|------|----------------|--------|
| src/commands/product/main.js | Add ProBot payment option (buyer.paymentMethod === 'probot') | 🔜 Planned |
| src/commands/service/main.js | Add ProBot payment option (buyer.paymentMethod === 'probot') | 🔜 Planned |
| src/commands/wallet/main.js | Show platformEarnings in wallet balance | ✅ Done |
| src/commands/dashboard/main.js | Add financial sub-command | ✅ Done |
| src/utils/embeds.js | paymentCard, withdrawalCard, commissionCard | ✅ Done |
| src/config/index.js | payment.probotAccountId, timeoutMinutes, etc. | ✅ Done |
| src/index.js | Register payment/withdraw commands | ✅ Done |

## Background Jobs

- **Payment expiry check**: Runs every 60s, expires payments older than 30min
- **Balance aggregation**: Real-time queries (no scheduled aggregation needed)

## Auto-Confirm System (NEW)

### Components

| Component | File | Purpose |
|-----------|------|---------|
| ProBotApiService | `src/services/ProBotApiService.js` | Optional ProBot REST API wrapper for transaction verification |
| ProBotMonitorService | `src/services/ProBotMonitorService.js` | Background polling + webhook-triggered auto-confirm |
| WebhookServer | `src/webhook/server.js` | Express HTTP server with REST endpoints |

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check (uptime) |
| GET | `/api/metrics` | MonitorService snapshot |
| POST | `/api/webhook/probot` | Full auto-confirm: verify + confirm in one call |
| POST | `/api/webhook/probot/verify` | Verify only: submit transaction ID |
| POST | `/api/webhook/probot/confirm` | Confirm only: complete an awaiting_verification payment |

### Auto-Confirm Modes

1. **Webhook-Triggered** (primary): External service calls `POST /api/webhook/probot` with `{ paymentId, transactionId, secret }`. The server validates the webhook secret, verifies the transaction, and completes the payment automatically.

2. **Polling** (fallback): `ProBotMonitorService._checkPendingPayments()` runs every 30s and auto-confirms any payment in `awaiting_verification` status. Requires `AUTO_CONFIRM_ENABLED=true`.

### Security

- Webhook secret validation via `X-Webhook-Secret` header or `body.secret`
- Payment ownership bypass only for `system`/`webhook` callers
- Fraud detection still applies (duplicate txn, max attempts, expiry)
- Full audit trail: `payment_auto_confirmed` and `payment_webhook_confirmed` actions
- MonitorService tracks `autoConfirmed` metric

### Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `AUTO_CONFIRM_ENABLED` | `false` | Enable background polling auto-confirm |
| `AUTO_CONFIRM_POLL_INTERVAL` | `30000` | Polling interval in ms |
| `AUTO_CONFIRM_MAX_PER_CYCLE` | `10` | Max payments processed per cycle |
| `PROBOT_API_ENABLED` | `false` | Enable ProBot REST API integration |
| `PROBOT_API_KEY` | - | ProBot API key |
| `PROBOT_API_URL` | `https://api.probot.io` | ProBot API base URL |
| `WEBHOOK_PORT` | `0` (disabled) | Port for webhook HTTP server |
| `WEBHOOK_SECRET` | - | Shared secret for webhook auth |

## Testing

To verify the payment system:
1. `/payment status <paymentId>` — view payment
2. `/payment verify <paymentId> <txnId>` — submit transaction ID
3. `/payment confirm <paymentId>` — admin confirms (in dev)
4. `/withdraw request <amount>` — seller requests withdrawal
5. `/withdraw approve <withdrawalId>` — admin approves
6. Verify `platformEarnings` updated on User model
