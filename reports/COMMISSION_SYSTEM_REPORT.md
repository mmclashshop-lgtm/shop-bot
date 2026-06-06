# COMMISSION SYSTEM REPORT

## Overview
The CommissionService provides automated commission calculation, recording, and aggregation for all Marketplace transactions. It replaces the inline commission logic that was duplicated across product and service commands.

## Architecture

```
Order/Payment Created
       ↓
CommissionService.calculateAndRecord()
  • Look up rate from config (overridable via MarketplaceSettings)
  • Calculate commission = amount × rate
  • Create Commission document
  • Update store stats (totalRevenue, totalCommission)
  • Update seller stats
  • Record Transaction entry
       ↓
CommissionService.getCommissionSummary()
  • Aggregate by period
  • Return totalCommission, storeCount, commissionCount
```

## Service API

### `CommissionService`

| Method | Parameters | Returns | Description |
|--------|-----------|---------|-------------|
| `getCommissionRate` | store | Number | Rate from config (0-1), checks store type |
| `calculateCommission` | amount, rate | Number | Simple multiplication, 2-decimal rounding |
| `createCommissionRecord` | paymentId, storeId, sellerId, storeType, rate, amount | Commission | Creates Commission document |
| `getCommissionSummary` | startDate | Object | { totalCommission, storeCount, commissionCount } |
| `getUserCommissionSummary` | userId | Object | { totalCommission, count, breakdown by type } |
| `getStoreCommissionSummary` | storeId | Object | { totalCommission, count } |
| `getMonthlyReport` | year, month | Object | { totalCommission, avgCommission, byStoreType } |
| `reverseCommission` | commissionId, reason | Commission | Marks commission as reversed |

### `BalanceService`

| Method | Parameters | Returns | Description |
|--------|-----------|---------|-------------|
| `getSellerBalance` | userId | Number | Current platformEarnings |
| `getPlatformBalance` | - | Number | Sum of all platformEarnings |
| `getTopSellers` | limit | Array | Top sellers by platformEarnings |
| `getTopStores` | limit | Array | Top stores by totalCommission |
| `getMonthlyRevenue` | period | Object | { totalCommission, totalSales, counts } |
| `requestWithdrawal` | userId, amount, options | Withdrawal | Creates pending withdrawal |
| `approveWithdrawal` | withdrawalId, reviewerId | Withdrawal | Atomic session: deduct balance, set approved |
| `rejectWithdrawal` | withdrawalId, reviewerId, reason | Withdrawal | Sets rejected with reason |
| `getUserWithdrawals` | userId | Array | User's withdrawal history |
| `getPendingWithdrawals` | - | Array | All pending withdrawals |

## Commission Rate Sources (priority order)

1. `MarketplaceSettings.commissionRates[storeType]` — if set
2. `config.commissions[storeType]` — default from config
3. `config.commissions.free` — fallback (0.10 = 10%)

## Rate Table

| Store Type | Default Rate | Config Key | MarketplaceSettings Key |
|------------|-------------|-----------|------------------------|
| Free | 10% (0.10) | commissions.free | commissionRates.free |
| VIP | 5% (0.05) | commissions.vip | commissionRates.vip |
| Premium | 3% (0.03) | commissions.premium | commissionRates.premium |
| Verified | 1% (0.01) | commissions.verified | commissionRates.verified |

## Commission Document Structure

```
{
  _id: ObjectId,
  commissionId: "COM-A1B2C3",
  paymentId: "PAY-XYZ789",
  storeId: ObjectId,
  sellerId: "discord_id",
  storeType: "free",
  rate: 0.10,
  amount: 25.00,
  sellerSplit: 225.00,
  platformSplit: 25.00,
  createdAt: Date,
  reversedAt: null
}
```

## Integration Points

All new financial operations route through CommissionService + BalanceService rather than inline MongoDB operations. The existing product buy / service order flows currently use inline commission logic — a future refactor should redirect them through these services for consistency.
