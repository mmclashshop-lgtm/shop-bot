/**
 * Load Testing Framework
 *
 * Usage: node scripts/load-test.js [concurrency] [duration_seconds]
 *   Default: node scripts/load-test.js 50 30
 *
 * Tests concurrent operations on:
 *   - AI Service (simulated chat)
 *   - Wallet/Balance operations
 *   - Ticket creation
 */

const path = require('path');
const fs = require('fs');

// Track which services loaded vs mocked
const serviceStatus = {};

function tryLoad(modulePath) {
  try {
    const mod = require(modulePath);
    serviceStatus[modulePath] = 'real';
    return mod;
  } catch (e) {
    serviceStatus[modulePath] = 'mock';
    console.warn('[LOAD-TEST] Could not load %s: %s', modulePath, e.message);
    return null;
  }
}

// Try loading actual services; individual modules fall back to mocks if needed
const AIService = tryLoad('../src/services/AIService') || {
  chat: async () => ({ content: 'Mock AI response', usage: { total_tokens: 50 } }),
  generateText: async () => 'Mock text',
  getUsageStats: () => ({ totalRequests: 0, totalTokens: 0 }),
};

const BalanceService = tryLoad('../src/services/BalanceService');

const Ticket = tryLoad('../src/database/models/Ticket') || {
  create: async (d) => ({ _id: 'mock_' + Date.now(), ...d }),
  find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
};

/* ------------------------------------------------------------------ */
/*  Metrics                                                           */
/* ------------------------------------------------------------------ */

const MAX_LATENCIES = 1000000;
const MAX_ERRORS = 10000;

const METRICS = {
  totalOps: 0,
  successOps: 0,
  failedOps: 0,
  latencies: [],
  errors: [],
  startTime: 0,
  endTime: 0,
};

function recordOp(start, err) {
  const dur = Date.now() - start;
  METRICS.totalOps++;
  if (METRICS.latencies.length < MAX_LATENCIES) {
    METRICS.latencies.push(dur);
  }
  if (err) {
    METRICS.failedOps++;
    if (METRICS.errors.length < MAX_ERRORS) {
      METRICS.errors.push({ time: new Date().toISOString(), message: err instanceof Error ? err.message : String(err) });
    }
  } else {
    METRICS.successOps++;
  }
}

function percentile(sorted, p) {
  if (!sorted || sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function printResults(label, concurrency, durationSec) {
  const sorted = [...METRICS.latencies].sort((a, b) => a - b);
  const totalTime = Math.max((METRICS.endTime - METRICS.startTime) / 1000, 0.001);
  const len = sorted.length;

  const avg = len > 0 ? sorted.reduce((s, v) => s + v, 0) / len : 0;
  const errorRate = METRICS.totalOps > 0 ? (METRICS.failedOps / METRICS.totalOps) * 100 : 0;
  const throughput = METRICS.totalOps / totalTime;
  const minLatency = len > 0 ? sorted[0] : 0;
  const maxLatency = len > 0 ? sorted[len - 1] : 0;
  const p50 = len > 0 ? percentile(sorted, 50) : 0;
  const p95 = len > 0 ? percentile(sorted, 95) : 0;
  const p99 = len > 0 ? percentile(sorted, 99) : 0;

  console.log('');
  console.log('='.repeat(70));
  console.log('  RESULTS: %s', label);
  console.log('  Concurrency: %d | Duration: %ds', concurrency, durationSec);
  console.log('='.repeat(70));
  console.log('  Total Operations : %d', METRICS.totalOps);
  console.log('  Successful       : %d', METRICS.successOps);
  console.log('  Failed           : %d', METRICS.failedOps);
  console.log('  Error Rate       : %s%%', errorRate.toFixed(2));
  console.log('  Total Time       : %ss', totalTime.toFixed(2));
  console.log('  Throughput       : %s ops/s', throughput.toFixed(2));
  console.log('  Average Latency  : %sms', avg.toFixed(2));
  console.log('  P50 Latency      : %sms', p50.toFixed(2));
  console.log('  P95 Latency      : %sms', p95.toFixed(2));
  console.log('  P99 Latency      : %sms', p99.toFixed(2));
  console.log('  Min Latency      : %sms', minLatency.toFixed(2));
  console.log('  Max Latency      : %sms', maxLatency.toFixed(2));
  console.log('='.repeat(70));

  return {
    label, concurrency, duration: durationSec + 's',
    totalOps: METRICS.totalOps, successOps: METRICS.successOps, failedOps: METRICS.failedOps,
    errorRate: errorRate.toFixed(2) + '%',
    throughput,
    avgLatency: avg, p50, p95, p99,
    minLatency, maxLatency,
    errors: METRICS.errors.slice(0, 20),
  };
}

/* ------------------------------------------------------------------ */
/*  Progress                                                          */
/* ------------------------------------------------------------------ */

let _progressInterval = null;

function startProgress(totalMs) {
  const start = Date.now();
  let lastPct = 0;
  _progressInterval = setInterval(() => {
    const elapsed = Date.now() - start;
    const pct = Math.min(100, Math.round((elapsed / totalMs) * 100));
    if (pct >= lastPct + 5) {
      lastPct = pct;
      process.stderr.write('\r[LOAD-TEST] Progress: ' + pct + '% (' + METRICS.totalOps + ' ops, ' + METRICS.failedOps + ' errs)   ');
    }
  }, 1000);
}

function stopProgress() {
  if (_progressInterval) {
    clearInterval(_progressInterval);
    _progressInterval = null;
    process.stderr.write('\r' + ' '.repeat(70) + '\r');
  }
}

/* ------------------------------------------------------------------ */
/*  Simulated Operations                                              */
/* ------------------------------------------------------------------ */

async function simulateAIOps(concurrency) {
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    const start = Date.now();
    promises.push(
      AIService.chat([{ role: 'user', content: 'Test message ' + i }], { temperature: 0.5 })
        .then(() => recordOp(start))
        .catch(err => recordOp(start, err))
    );
  }
  await Promise.allSettled(promises);
}

async function simulateAIGenerate(concurrency) {
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    const start = Date.now();
    promises.push(
      AIService.generateText('Generate test content ' + i, { type: 'general' })
        .then(() => recordOp(start))
        .catch(err => recordOp(start, err))
    );
  }
  await Promise.allSettled(promises);
}

/* Wallet / Balance Ops */
async function simulateWalletOps(concurrency, userId) {
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    const start = Date.now();
    const amount = Math.floor(Math.random() * 10000) + 100;
    promises.push(
      (async () => {
        if (BalanceService && BalanceService.getBalance) {
          await BalanceService.getBalance(userId);
        }
        if (BalanceService && BalanceService.addTransaction) {
          await BalanceService.addTransaction(userId, amount, 'load_test_' + i);
        }
        recordOp(start);
      })().catch(err => recordOp(start, err))
    );
  }
  await Promise.allSettled(promises);
}

/* Ticket creation */
async function simulateTicketOps(concurrency, guildId) {
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    const start = Date.now();
    promises.push(
      Ticket.create({
        userId: 'user_' + i,
        guildId,
        type: 'support',
        reason: 'Load test ticket ' + i,
        status: 'open',
      })
        .then(() => recordOp(start))
        .catch(err => recordOp(start, err))
    );
  }
  await Promise.allSettled(promises);
}

/* ------------------------------------------------------------------ */
/*  Main Runner                                                       */
/* ------------------------------------------------------------------ */

let aborted = false;

async function runLoadTest(concurrency, durationSec) {
  console.log('');
  console.log('█'.repeat(70));
  console.log('  LOAD TEST — Concurrency: %d | Duration: %ds', concurrency, durationSec);
  const mockServices = Object.entries(serviceStatus).filter(([, s]) => s === 'mock').map(([k]) => k);
  if (mockServices.length > 0) {
    console.log('  Service status:');
    console.log('    AI Service  : %s', serviceStatus['../src/services/AIService'] || 'not loaded');
    console.log('    Balance     : %s', serviceStatus['../src/services/BalanceService'] || 'not loaded');
    console.log('    Ticket      : %s', serviceStatus['../src/database/models/Ticket'] || 'not loaded');
  } else {
    console.log('  REAL SERVICES ACTIVE');
  }
  console.log('█'.repeat(70));

  const startGlobal = Date.now();
  const totalMs = durationSec * 1000;
  METRICS.startTime = startGlobal;

  const endTime = startGlobal + totalMs;

  // Register signal handlers for graceful shutdown
  function onAbort() {
    if (!aborted) {
      aborted = true;
      console.log('\n[LOAD-TEST] Abort requested, finishing current operations...');
    }
  }
  process.on('SIGINT', onAbort);
  process.on('SIGTERM', onAbort);

  startProgress(totalMs);

  let cycle = 0;

  while (!aborted && Date.now() < endTime) {
    const remaining = endTime - Date.now();
    if (remaining <= 0) break;

    cycle++;
    const phase = cycle % 4;

    try {
      switch (phase) {
        case 0:
          await simulateAIOps(Math.max(1, Math.floor(concurrency / 3)));
          break;
        case 1:
          await simulateWalletOps(Math.max(1, Math.floor(concurrency / 2)), 'loadtest_user');
          break;
        case 2:
          await simulateTicketOps(Math.max(1, Math.floor(concurrency / 4)), 'loadtest_guild');
          break;
        case 3:
          await simulateAIGenerate(Math.max(1, Math.floor(concurrency / 3)));
          break;
      }
    } catch (phaseErr) {
      console.warn('[LOAD-TEST] Phase error (cycle %d, phase %d): %s', cycle, phase, phaseErr instanceof Error ? phaseErr.message : String(phaseErr));
    }

    if (!aborted && Date.now() < endTime) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  stopProgress();

  METRICS.endTime = Date.now();
  process.removeListener('SIGINT', onAbort);
  process.removeListener('SIGTERM', onAbort);

  const result = printResults(
    'Concurrent Load (' + concurrency + ' users, ' + durationSec + 's)',
    concurrency,
    durationSec
  );

  // Save results
  const reportDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(reportDir, 'load-test-' + concurrency + '-' + timestamp + '.json');
  await fs.promises.writeFile(outPath, JSON.stringify(result, null, 2));
  console.log('\n  Results saved to: %s', outPath);

  return result;
}

/* ------------------------------------------------------------------ */
/*  CLI Entry                                                         */
/* ------------------------------------------------------------------ */

if (require.main === module) {
  let concurrency = parseInt(process.argv[2], 10);
  if (isNaN(concurrency) || concurrency < 1) concurrency = 50;

  let duration = parseInt(process.argv[3], 10);
  if (isNaN(duration) || duration < 1) duration = 30;

  runLoadTest(concurrency, duration)
    .then(() => process.exit(0))
    .catch(err => { console.error('[LOAD-TEST] Fatal:', err); process.exit(1); });
}

module.exports = { runLoadTest };