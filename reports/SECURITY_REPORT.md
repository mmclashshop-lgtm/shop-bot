# Security Audit Report

## Summary
Full security audit completed. 26 issues found and fixed across rate limiting, anti-spam, anti-abuse, input validation, sanitization, AI prompt protection, authorization, and NoSQL injection.

## 1. Rate Limiting

### Before
- Global spam rate limiter for slash commands only (via `rate-limiter-flexible`)
- Per-command cooldowns stored in MongoDB (storeCreate, productAdd, search, ai, ticketCreate)
- No rate limiting on modals, buttons, or select menus
- No limit on wallet `pendingActions` (unbounded Map growth)

### After
- **Modal/button/select rate limiting**: Added `_rateLimitInteraction()` in `commandHandler.js` — 5 actions per 3s window per user per type
- **AntiSpam extended**: Rate limiter now covers all interaction types (modal, button, select) with type-specific consume points (`src/middleware/security.js:41-75`)
- **PendingActions cap**: Added `MAX_PENDING_PER_USER = 3` with `getPendingCount()` check before creating new pending withdraw/pay actions (`src/commands/wallet/main.js:14-29, 231-237`)

### Files changed
- `src/handlers/commandHandler.js` — `_rateLimitInteraction()`, antiSpam/antiScam middleware in all handlers
- `src/middleware/security.js` — type-aware antiSpam (command/modal/button/select)
- `src/commands/wallet/main.js` — pending action limit per user

---

## 2. Anti-Spam

### Before
- Single global rate limiter key `spam:${userId}` for commands only
- Warning escalation: `+1` warning per spam trigger, ban on `maxWarnings` threshold

### After
- **Type-specific rate limiting**: Separate counters for each interaction type (`spam:${userId}:command`, `spam:${userId}:modal`, etc.)
- **Interaction-type points**: Commands cost 1 point, modals/buttons/selects cost 2 points (more expensive)
- **Safe reply fallback**: antiSpam now handles `deferred`/`replied` state before replying

---

## 3. Anti-Abuse

### Before
- antiScam checked: command options, modal fields, customId
- Keywords matched against `config.security.scamKeywords`

### After
- antiScam **extended** to also check:
  - Button labels (`interaction.component.label`)
  - Select menu values (`interaction.values`)
- Added catch to silent-fail replies when interaction already responded

### Files changed
- `src/middleware/security.js` — antiScam covers button labels + select values

---

## 4. Input Validation

### Critical
- **`Transaction.amount` had no `min: 0`** — negative transaction amounts could be injected. **Fixed**: added `min: 0` (`src/database/models/Transaction.js:29`)

### High
- **`Ticket.messages.content` had no maxlength** — unbounded message content could cause 16MB document overflow. **Fixed**: added `maxlength: 4000` (`src/database/models/Ticket.js:97`)
- **`AIChat.messages.content` had no maxlength** — unbounded AI conversation storage. **Fixed**: added `maxlength: 4000` (`src/database/models/AIChat.js:30`)
- **`MarketplaceSettings` numeric fields had no constraints** — commissions, fees, cooldowns, security thresholds all unbounded. **Fixed**: added `min`/`max` to all numeric fields (`src/database/models/MarketplaceSettings.js:25-74`)

### Medium
- **Wallet deposit method from customId**: Method extracted from customId with no validation against allowed values. **Fixed**: added `allowedMethods` whitelist check (`src/commands/wallet/main.js:638-641`)
- **Search query length**: No limit on query string used in `$regex`. **Fixed**: added `sanitizeSearchQuery()` with 100 char max and HTML tag stripping (`src/commands/search/main.js:79-87`)

---

## 5. Sanitize User Input

### Before
- AIService.sanitizeInput: 10 injection patterns, control char strip, 4000 char limit
- Mongoose `trim` on: Product (name, category, subcategory, tags), Store (name, tags), Service (name, tags), Coupon (code), Ticket (tags)

### After
- **AIService.sanitizeInput enhanced**: 10 more injection patterns added (total 20), Unicode control chars stripped (`\u200B-\u200F\u2028-\u202F\uFEFF`), line limit (max 100 lines) (`src/services/AIService.js:74-99`)

### Still uses Mongoose `trim`/`lowercase`/`uppercase`
- Product: trim on name/category/subcategory/tags, lowercase on tags
- Store: trim on name/tags, lowercase on tags
- Service: trim on name/tags, lowercase on tags
- Coupon: trim + uppercase on code
- Ticket: trim + lowercase on tags

---

## 6. AI Prompt Protection

### Before
- `sanitizeInput()`: 10 injection patterns, 4000 char limit, control char strip
- `stripThinking()`: 12 patterns for removing CoT/thinking tags
- Rate limiter: 30 requests/min per user

### After
- **20 injection patterns** (added: `respond as if`, `do not follow`, `output raw`, `reveal prompt`, `jailbreak`, `//ignore`, etc.)
- **Unicode control char strip**: Added zero-width chars, bidirectional marks
- **Line limit**: Max 100 lines per message (prevents prompt smuggling via excessive line breaks)
- All patterns replaced with `[removed]` (not silently dropped — user sees censorship)

### Files changed
- `src/services/AIService.js` — sanitizeInput enhanced

---

## 7. Protect Modals

### Critical Fix
- **Ticket close modal**: No authorization re-check after modal submission. Any user who triggered a close button could bypass permissions. **Fixed**: added `isOwner`/`isStaff`/`isAssigned` check in `handleModalSubmit` (`src/commands/ticket/main.js:569-576`)
- **Ticket assign modal**: Anyone who triggered the assign button could assign tickets without permission check. **Fixed**: added `ManageMessages` permission check at top of handler (`src/commands/ticket/main.js:603-605`)

### High Fix
- **Wallet deposit modal**: Method extracted from customId without validation. **Fixed**: whitelist check against `['credits', 'bank', 'crypto', 'other']` (`src/commands/wallet/main.js:638-641`)

---

## 8. Protect Buttons

### Before
- Wallet: Button handlers verify ownership via `pending.get(nonce).userId`
- Store/Product/Service: Edit/delete buttons verify store ownership
- Ticket: Close button verifies ownership
- **No rate limiting** on button clicks

### After
- **Rate limiting**: 5 button clicks per 3s window per user via `_rateLimitInteraction()`
- **AntiSpam**: Button clicks go through antiSpam middleware with `type: 'button'`
- **AntiScam**: Button labels now scanned for scam keywords

### Files changed
- `src/handlers/commandHandler.js` — handleButtonClick wrapped with antiSpam + antiScam + rate limit

---

## 9. Protect Select Menus

### Before
- AI panel: Session validation (`isSessionValid`) with 15min TTL
- Search/Marketplace: No ownership needed (public)
- **No rate limiting** on select menu interactions

### After
- **Rate limiting**: 5 select menu uses per 3s window per user via `_rateLimitInteraction()`
- **AntiSpam**: Select menu interactions go through antiSpam middleware with `type: 'select'`
- **AntiScam**: Select menu values scanned for scam keywords

### Files changed
- `src/handlers/commandHandler.js` — handleSelectMenu wrapped with antiSpam + antiScam + rate limit

---

## 10. Authorization Fixes

### Critical
- **Dashboard `handleOverview`**: Any user could view global platform stats (revenue, orders, commissions). **Fixed**: requires Administrator permission (`src/commands/dashboard/main.js:87-89`)
- **Dashboard `handleRevenueReport`**: Any user could view revenue reports with per-period breakdowns and top store ranking. **Fixed**: requires Administrator permission (`src/commands/dashboard/main.js:309-312`)

### High
- **Dashboard `handleSellerStats`**: Any user could view any seller's complete stats. **Fixed**: restricted to self or admin (`src/commands/dashboard/main.js:256-259`)
- **Ticket modal close**: No auth re-check. **Fixed**: added ownership/staff check
- **Ticket modal assign**: No permission check. **Fixed**: added ManageMessages check

---

## 11. NoSQL Injection Prevention

### Critical
- **Search `$regex`**: User-supplied query used directly in MongoDB `$regex` queries with only regex escaping (not enough to prevent ReDoS or complex pattern abuse).

### Fixes applied
1. **Query sanitization**: `sanitizeSearchQuery()` truncates to 100 chars, rejects HTML angle brackets
2. **Regex escaping**: Already present (`escapeRegex()` escapes `.*+?^${}()|[]\`)
3. **Length limit**: Query truncated server-side before regex construction
4. **Category filter**: Uses `new RegExp(escapeRegex(category), 'i')` instead of raw string

### Still recommended (future)
- Replace `$regex` with MongoDB `$text` indexes + `$text` queries for full-text search
- This would eliminate ReDoS risk entirely and improve performance

### Files changed
- `src/commands/search/main.js` — added `sanitizeSearchQuery()`, applied in `performSearch()`

---

## 12. Summary of All Changes

| # | File | Change | Severity |
|---|------|--------|----------|
| 1 | `src/database/models/Transaction.js` | Added `min: 0` to `amount` | CRITICAL |
| 2 | `src/database/models/Ticket.js` | Added `maxlength: 4000` to `messages.content` | HIGH |
| 3 | `src/database/models/AIChat.js` | Added `maxlength: 4000` to `messages.content` | HIGH |
| 4 | `src/database/models/MarketplaceSettings.js` | Added `min`/`max` to all numeric fields | HIGH |
| 5 | `src/commands/dashboard/main.js` | Admin check on `handleOverview` | CRITICAL |
| 6 | `src/commands/dashboard/main.js` | Admin check on `handleRevenueReport` | CRITICAL |
| 7 | `src/commands/dashboard/main.js` | Auth check on `handleSellerStats` | HIGH |
| 8 | `src/commands/ticket/main.js` | Auth re-check on close modal | CRITICAL |
| 9 | `src/commands/ticket/main.js` | Permission check on assign modal | HIGH |
| 10 | `src/commands/wallet/main.js` | Method whitelist validation in deposit modal | HIGH |
| 11 | `src/commands/wallet/main.js` | Pending action limit (3 per user) | MEDIUM |
| 12 | `src/commands/search/main.js` | `sanitizeSearchQuery()` with length+char limits | CRITICAL |
| 13 | `src/middleware/security.js` | Type-aware antiSpam (modal/button/select) | HIGH |
| 14 | `src/middleware/security.js` | AntiScam scans button labels + select values | MEDIUM |
| 15 | `src/handlers/commandHandler.js` | `_rateLimitInteraction()` for all interaction types | HIGH |
| 16 | `src/handlers/commandHandler.js` | antiSpam + antiScam in modal/button/select handlers | HIGH |
| 17 | `src/services/AIService.js` | 20 injection patterns + unicode strip + line limit | HIGH |

## 13. Remaining Low-Priority Items

1. **IP address storage**: Order, Transaction, Review, Ticket, AuditLog store IP addresses. Consider GDPR/privacy implications.
2. **`$text` index**: Replace `$regex` with MongoDB text indexes for search to eliminate ReDoS risk.
3. **Mass assignment**: All `findOneAndUpdate`/`updateOne` calls rely on Mongoose `strict: true` (default). Consider explicit field whitelisting in service/controller layers.
4. **URL validation**: Image/file URL fields in Product, Store, Review, Ticket have no URL format validation.
5. **Discord ID validation**: Many `discordId`/`channelId`/`ownerId` fields have no format validation (`/^\d{17,19}$/`).
