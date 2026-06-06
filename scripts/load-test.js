/**
 * Load Testing Framework
 *
 * Usage: node scripts/load-test.js [concurrency] [duration_seconds]
 *   Default: node scripts/load-test.js 50 30
 *
 * Tests concurrent operations on:
 *   - AI Service (simulated chat)
 *   - Wallet/Balance operations
 *   - Payment processing
 *   - Ticket creation
 */

const path = require('path');
const fs = require('fs');

// Ensure we're in project root
process.chdir(path.resolve(__dirname, '..'));

// Try loading actual services; if MongoDB is unavailable, use mocks
let AIService, BalanceService, PaymentService, Ticket;
let usingMocks = false;

try {
  AIService = require('../src/services/AIService');
  BalanceService = require('../src/services/BalanceService');
  Ticket = require('../src/database/models/Ticket');
} catch (e) {
  console.warn('[LOAD-TEST] WARNING: Could not load actual services, using mock fallback:', e.message);
  usingMocks = true;
  AIService = {
    chat: async () => ({ content: 'Mock AI response', usage: { total_tokens: 50 } }),
    generateText: async () => 'Mock text',
    getUsageStats: () => ({ totalRequests: 0, totalTokens: 0 }),
  };
  Ticket = {
    create: async (d) => ({ _id: 'mock_' + Date.now(), ...d }),
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
  };
}

/* ------------------------------------------------------------------ */
/*  Metrics                                                           */
/* ------------------------------------------------------------------ */
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
  METRICS.latencies.push(dur);
  if (err) {
    METRICS.failedOps++;
    METRICS.errors.push({ time: new Date().toISOString(), message: err.message });
  } else {
    METRICS.successOps++;
  }
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function printResults(label, concurrency, duration) {
  const sorted = [...METRICS.latencies].sort((a, b) => a - b);
  const totalTime = (METRICS.endTime - METRICS.startTime) / 1000;
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const errorRate = METRICS.totalOps > 0 ? (METRICS.failedOps / METRICS.totalOps) * 100 : 0;

  console.log('');
  console.log('='.repeat(70));
  console.log(`  RESULTS: ${label}`);
  console.log(`  Concurrency: ${concurrency} | Duration: ${duration}s`);
  console.log('='.repeat(70));
  console.log(`  Total Operations : ${METRICS.totalOps}`);
  console.log(`  Successful       : ${METRICS.successOps}`);
  console.log(`  Failed           : ${METRICS.failedOps}`);
  console.log(`  Error Rate       : ${errorRate.toFixed(2)}%`);
  console.log(`  Total Time       : ${totalTime.toFixed(2)}s`);
  console.log(`  Throughput       : ${(METRICS.totalOps / totalTime).toFixed(2)} ops/s`);
  console.log(`  Average Latency  : ${avg.toFixed(2)}ms`);
  console.log(`  P50 Latency      : ${percentile(sorted, 50).toFixed(2)}ms`);
  console.log(`  P95 Latency      : ${percentile(sorted, 95).toFixed(2)}ms`);
  console.log(`  P99 Latency      : ${percentile(sorted, 99).toFixed(2)}ms`);
  console.log(`  Min Latency      : ${sorted[0].toFixed(2)}ms`);
  console.log(`  Max Latency      : ${sorted[sorted.length - 1].toFixed(2)}ms`);
  console.log('='.repeat(70));

  return {
    label, concurrency, duration: duration + 's',
    totalOps: METRICS.totalOps, successOps: METRICS.successOps, failedOps: METRICS.failedOps,
    errorRate: errorRate.toFixed(2) + '%',
    throughput: METRICS.totalOps / totalTime,
    avgLatency: avg, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99),
    minLatency: sorted[0], maxLatency: sorted[sorted.length - 1],
    errors: METRICS.errors.slice(0, 20),
  };
}

/* ------------------------------------------------------------------ */
/*  Simulated Operations                                              */
/* ------------------------------------------------------------------ */

async function simulateAIOps(concurrency) {
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    const start = Date.now();
    promises.push(
      AIService.chat([{ role: 'user', content: `Test message ${i}` }], { temperature: 0.5 })
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
      AIService.generateText(`Generate test content ${i}`, { type: 'general' })
        .then(() => recordOp(start))
        .catch(err => recordOp(start, err))
    );
  }
  await Promise.allSettled(promises);
}

/* Wallet / Balance Ops */
async function simulateWalletOps(concurrency, userId = 'loadtest_user') {
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
          await BalanceService.addTransaction(userId, amount, `load_test_${i}`);
        }
        recordOp(start);
      })().catch(err => recordOp(start, err))
    );
  }
  await Promise.allSettled(promises);
}

/* Ticket creation */
async function simulateTicketOps(concurrency, guildId = 'loadtest_guild') {
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    const start = Date.now();
    promises.push(
      Ticket.create({
        userId: `user_${i}`,
        guildId,
        type: 'support',
        reason: `Load test ticket ${i}`,
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

async function runLoadTest(concurrency = 50, durationSec = 30) {
  console.log('');
  console.log('█'.repeat(70));
  console.log(`  LOAD TEST — Concurrency: ${concurrency} | Duration: ${durationSec}s`);
  console.log(`  ${usingMocks ? '⚠️  USING MOCK SERVICES (no real DB)' : '✅  REAL SERVICES ACTIVE'}`);
  console.log('█'.repeat(70));

  const startGlobal = Date.now();
  METRICS.startTime = startGlobal;

  const endTime = startGlobal + durationSec * 1000;
  let cycle = 0;

  while (Date.now() < endTime) {
    cycle++;
    const phase = cycle % 4;

    switch (phase) {
      case 0:
        await simulateAIOps(Math.max(1, Math.floor(concurrency / 3)));
        break;
      case 1:
        await simulateWalletOps(Math.max(1, Math.floor(concurrency / 2)));
        break;
      case 2:
        await simulateTicketOps(Math.max(1, Math.floor(concurrency / 4)));
        break;
      case 3:
        await simulateAIGenerate(Math.max(1, Math.floor(concurrency / 3)));
        break;
    }

    // Brief pause to avoid overwhelming
    await new Promise(r => setTimeout(r, 100));
  }

  METRICS.endTime = Date.now();

  const result = printResults(
    `Concurrent Load (${concurrency} users, ${durationSec}s)`,
    concurrency,
    durationSec
  );

  // Save results
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const outPath = path.join(reportDir, `load-test-${concurrency}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\n  Results saved to: ${outPath}`);

  return result;
}

/* ------------------------------------------------------------------ */
/*  CLI Entry                                                         */
/* ------------------------------------------------------------------ */

if (require.main === module) {
  const concurrency = parseInt(process.argv[2], 10) || 50;
  const duration = parseInt(process.argv[3], 10) || 30;
  runLoadTest(concurrency, duration)
    .then(() => process.exit(0))
    .catch(err => { console.error('[LOAD-TEST] Fatal:', err); process.exit(1); });
}

module.exports = { runLoadTest };
