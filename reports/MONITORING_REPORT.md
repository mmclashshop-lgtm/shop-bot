# Production Monitoring Report

## Overview
Complete production monitoring system implemented. Collects real-time metrics across 9 dimensions with an admin dashboard command and REST API endpoints.

## 1. Command Usage Statistics

**How it works**: Every command execution is tracked by `MonitorService.trackCommand()` with name, userId, duration, and success/fail status.

**Data collected**:
- Per-command: uses count, error count, average response time, unique users
- Global: total executions, command error rate, top 15 most-used commands

**View**: `/monitor commands` or `/monitor commands command:search`

**Files**: `src/services/MonitorService.js:23-32`, `src/handlers/commandHandler.js:155-158`

---

## 2. Error Tracking

**How it works**: Every error in command/modals/buttons/selects is captured by `MonitorService.trackError()` with context, message, and error name.

**Data collected**:
- Error log with timestamp, context (command name), error message, error type
- Rolling buffer of last 1000 errors, auto-truncating oldest 100
- Separate tracking for command errors vs AI errors vs MongoDB errors

**View**: `/monitor errors` or HTTP `GET /monitor/errors?limit=50`

**Files**: `src/services/MonitorService.js:34-41`, `src/handlers/commandHandler.js:341-342`

---

## 3. Performance Metrics

**How it works**: Response times for all commands are collected in a 10,000-sample rolling buffer. Statistics are computed on demand.

**Data collected**:
- Average, P50 (median), P95, P99, max response times
- Count of samples
- Per-command average response times

**View**: `/monitor performance` or HTTP `GET /monitor/performance`

**Files**: `src/services/MonitorService.js:148-162`

---

## 4. Memory Usage Monitoring

**How it works**: Every 60 seconds, `_sampleMetrics()` captures `process.memoryUsage()` and `os.cpus()` data. Up to 1440 samples stored (24 hours at 1/min).

**Data collected**:
- RSS, heapTotal, heapUsed, external memory
- CPU model, cores, load averages (1m/5m/15m)
- Memory trend analysis (stable/increasing/decreasing)
- Last 5 samples for visual trend

**View**: `/monitor memory` or HTTP `GET /monitor/metrics`

**Files**: `src/services/MonitorService.js:60-71, 165-178`

---

## 5. CPU Monitoring

**How it works**: `os.cpus()` and `os.loadavg()` sampled every 60s alongside memory.

**Data collected**:
- CPU model name, core count
- Load average (1 minute, 5 minutes, 15 minutes)
- Platform, release, hostname

**View**: `/monitor overview` (CPU section) or HTTP `GET /monitor/metrics`

**Files**: `src/services/MonitorService.js:61-69`

---

## 6. MongoDB Monitoring

**How it works**: A mongoose middleware (`setupMongoMonitoring`) wraps all major Model operations (find, findOne, findOneAndUpdate, updateOne, create) to increment an op counter.

**Data collected**:
- Total MongoDB operations executed
- MongoDB connection errors (separate counter + error log)
- Connection state (connected/disconnected/connecting)

**View**: `/monitor overview` or HTTP `GET /monitor/metrics`

**Files**: `src/middleware/mongoMonitor.js`, `src/index.js:173`

---

## 7. AI Usage Tracking

**How it works**: Hooks into `AIService.chat()` success and error paths to report to MonitorService.

**Data collected**:
- Total AI requests
- Total tokens consumed
- AI error count (separate from general errors)
- Average AI response time
- Cache size, rate limiter size, memory user count (from `AIService.getUsageStats()`)

**View**: `/monitor overview` (AI section) or HTTP `GET /monitor/metrics`

**Files**: `src/services/MonitorService.js:43-56`, `src/services/AIService.js:260, 296`

---

## 8. Discord Interaction Tracking

**How it works**: Every interaction type (command, modal, button, select menu, autocomplete) increments a type-specific counter in `MonitorService.trackInteraction()`.

**Data collected**:
- Total interactions
- Breakdown by type: command, modal, button, select, autocomplete

**View**: `/monitor overview` (interactions section) or HTTP `GET /monitor/metrics`

**Files**: `src/services/MonitorService.js:31-33`, `src/handlers/commandHandler.js:157, 253, 290, 327`

---

## 9. Daily Reports

**How it works**: Every hour, `_generateDailyReport()` compiles a summary of all collected metrics. Report is logged and emitted to registered callbacks.

**Data collected** (per report):
- Uptime, command totals + top 10, interaction totals
- AI requests/tokens/errors, MongoDB state/ops
- Memory RSS/Heap, error summary with recent entries
- Per-command breakdown (uses, avg time, unique users)

**View**: `/monitor report` (generates on-demand)

**Files**: `src/services/MonitorService.js:73-121`

---

## 10. Admin Dashboard Command

### `/monitor` Command
Requires **Administrator** permission. 6 subcommands:

| Subcommand | Description |
|---|---|
| `/monitor overview` | Real-time dashboard with 16 metrics |
| `/monitor commands [command]` | All commands or per-command stats |
| `/monitor errors` | Last 25 errors with timestamps |
| `/monitor performance` | P50/P95/P99 latency distribution |
| `/monitor memory` | RAM, heap, CPU, memory trend |
| `/monitor report` | On-demand daily report generation |

Interactive buttons for quick navigation: Refresh, Commands, Memory.

**Files**: `src/commands/monitor/main.js`

---

## REST API Endpoints

All monitoring data is also available via HTTP on the health server port:

| Endpoint | Description |
|---|---|
| `GET /monitor/metrics` | Full snapshot of all metrics |
| `GET /monitor/errors?limit=50` | Recent errors (max 200) |
| `GET /monitor/performance` | Response time percentiles + memory trend |
| `GET /monitor/commands?name=search` | Command stats (all or by name) |

**Files**: `src/services/HealthService.js:55-80`

---

## Architecture Diagram

```
index.js
  ├── MonitorService.start()       (60s sampling + hourly report)
  ├── setupMongoMonitoring()       (wraps Mongoose operations)
  └── commandHandler.js
        ├── trackCommand()         (per-command execution)
        ├── trackInteraction()     (per interaction type)
        ├── trackError()           (per error captured)
        └── AIService.chat()
              ├── trackAIRequest() (per AI success)
              └── trackAIError()   (per AI failure)
```

## Files Created/Modified

| File | Action | Description |
|---|---|---|
| `src/services/MonitorService.js` | **NEW** | Central metrics collector (350 lines) |
| `src/commands/monitor/main.js` | **NEW** | Admin dashboard command (280 lines) |
| `src/middleware/mongoMonitor.js` | **NEW** | MongoDB operation tracker (45 lines) |
| `src/services/HealthService.js` | Modified | Added 4 monitoring HTTP endpoints |
| `src/handlers/commandHandler.js` | Modified | Metrics tracking in all handlers |
| `src/services/AIService.js` | Modified | AI usage reporting to MonitorService |
| `src/index.js` | Modified | MonitorService startup/shutdown |
| `reports/MONITORING_REPORT.md` | **NEW** | This documentation |
