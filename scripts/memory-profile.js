/**
 * Memory Profiling Script
 *
 * Measures memory usage of all major services over time.
 * Run periodically (1h, 6h, 12h, 24h) and compare snapshots.
 *
 * Usage: node scripts/memory-profile.js [snapshot_label]
 *   Example: node scripts/memory-profile.js "1h"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

process.chdir(path.resolve(__dirname, '..'));

function getMemorySnapshot() {
  const mem = process.memoryUsage();
  return {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    rss: { bytes: mem.rss, mb: Math.round(mem.rss / 1024 / 1024 * 100) / 100 },
    heapTotal: { bytes: mem.heapTotal, mb: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100 },
    heapUsed: { bytes: mem.heapUsed, mb: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100 },
    external: { bytes: mem.external || 0, mb: Math.round((mem.external || 0) / 1024 / 1024 * 100) / 100 },
    arrayBuffers: { bytes: mem.arrayBuffers || 0, mb: Math.round((mem.arrayBuffers || 0) / 1024 / 1024 * 100) / 100 },
    system: {
      totalMem: { bytes: os.totalmem(), gb: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 100) / 100 },
      freeMem: { bytes: os.freemem(), gb: Math.round(os.freemem() / 1024 / 1024 / 1024 * 100) / 100 },
      usedPercent: Math.round((1 - os.freemem() / os.totalmem()) * 10000) / 100,
    },
    cpu: {
      loadAvg: os.loadavg ? os.loadavg() : [0, 0, 0],
      cpus: os.cpus().length,
    },
  };
}

function calculateLeakRisk(snapshots) {
  if (snapshots.length < 2) return { risk: 'insufficient_data', details: 'Need at least 2 snapshots' };

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const elapsed = (new Date(last.timestamp) - new Date(first.timestamp)) / 1000; // seconds

  if (elapsed < 60) return { risk: 'insufficient_time', details: 'Elapsed time too short for leak detection' };

  const heapGrowth = last.heapUsed.bytes - first.heapUsed.bytes;
  const rssGrowth = last.rss.bytes - first.rss.bytes;
  const growthPerHour = heapGrowth / (elapsed / 3600);
  const rssPerHour = rssGrowth / (elapsed / 3600);

  let risk = 'low';
  const warnings = [];

  if (growthPerHour > 50 * 1024 * 1024) {
    risk = 'high';
    warnings.push(`Heap growing at ${(growthPerHour / 1024 / 1024).toFixed(2)} MB/hour — possible leak`);
  } else if (growthPerHour > 10 * 1024 * 1024) {
    risk = 'medium';
    warnings.push(`Heap growing at ${(growthPerHour / 1024 / 1024).toFixed(2)} MB/hour — monitor closely`);
  }

  if (rssPerHour > 100 * 1024 * 1024) {
    risk = 'high';
    warnings.push(`RSS growing at ${(rssPerHour / 1024 / 1024).toFixed(2)} MB/hour — possible native leak`);
  }

  if (last.heapUsed.mb > last.system.totalMem.gb * 1024 * 0.8) {
    risk = 'high';
    warnings.push(`Heap usage at ${last.heapUsed.mb}MB exceeds 80% of system memory`);
  }

  return {
    risk,
    elapsed_hours: Math.round(elapsed / 3600 * 100) / 100,
    heapGrowthBytes: heapGrowth,
    heapGrowthMB: Math.round(heapGrowth / 1024 / 1024 * 100) / 100,
    growthPerHourMB: Math.round(growthPerHour / 1024 / 1024 * 100) / 100,
    rssGrowthMB: Math.round(rssGrowth / 1024 / 1024 * 100) / 100,
    rssPerHourMB: Math.round(rssPerHour / 1024 / 1024 * 100) / 100,
    warnings,
  };
}

function analyzeServiceMemory() {
  // Try to load services and check their internal caches/maps
  const results = {};
  try {
    const MonitorService = require('../src/services/MonitorService');
    const snapshot = MonitorService.getSnapshot ? MonitorService.getSnapshot() : {};
    results.monitorService = {
      commandCacheSize: snapshot.commands?.total || 0,
      errorSamples: snapshot.errors?.total || 0,
      memorySamples: snapshot.memory?.samples || 0,
      responseTimes: snapshot.memory?.samples || 0,
    };
  } catch (e) { results.monitorService = { error: e.message }; }

  try {
    const AIService = require('../src/services/AIService');
    const stats = AIService.getUsageStats ? AIService.getUsageStats() : {};
    results.aiService = {
      rateLimiterSize: stats.rateLimiterSize || 0,
      responseCacheSize: stats.responseCacheSize || 0,
      memoryUsers: stats.memory?.userCacheSize || 0,
      memoryServers: stats.memory?.serverCacheSize || 0,
    };
  } catch (e) { results.aiService = { error: e.message }; }

  try {
    const MemoryService = require('../src/services/MemoryService');
    const stats = MemoryService.getCacheStats ? MemoryService.getCacheStats() : {};
    results.memoryService = {
      userCacheSize: stats.userCacheSize || 0,
      serverCacheSize: stats.serverCacheSize || 0,
    };
  } catch (e) { results.memoryService = { error: e.message }; }

  try {
    const cache = require('../src/cache/CacheService');
    results.redisCache = { connected: cache.isReady ? cache.isReady() : false };
  } catch (e) { results.redisCache = { error: e.message }; }

  return results;
}

function runProfile(label = 'snapshot') {
  const snapshot = getMemorySnapshot();
  const services = analyzeServiceMemory();

  const reportDir = path.join(__dirname, '..', 'reports', 'memory');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  // Load existing history
  const historyFile = path.join(reportDir, 'history.json');
  let history = [];
  if (fs.existsSync(historyFile)) {
    try { history = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch {}
  }

  history.push({ label, ...snapshot, services });

  // Keep last 100 snapshots
  if (history.length > 100) history = history.slice(-100);
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

  // Save individual snapshot
  const outPath = path.join(reportDir, `${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ label, ...snapshot, services }, null, 2));

  // Leak analysis
  const leakRisk = calculateLeakRisk(history);

  console.log('');
  console.log('█'.repeat(70));
  console.log(`  MEMORY PROFILE: ${label}`);
  console.log('█'.repeat(70));
  console.log(`  RSS           : ${snapshot.rss.mb} MB`);
  console.log(`  Heap Used     : ${snapshot.heapUsed.mb} MB`);
  console.log(`  Heap Total    : ${snapshot.heapTotal.mb} MB`);
  console.log(`  External      : ${snapshot.external.mb} MB`);
  console.log(`  Array Buffers : ${snapshot.arrayBuffers.mb} MB`);
  console.log(`  System Memory : ${snapshot.system.freeMem.gb} GB free / ${snapshot.system.totalMem.gb} GB total`);
  console.log(`  CPU Load      : ${snapshot.cpu.loadAvg.map(l => l.toFixed(2)).join(', ')}`);

  console.log('\n── Service Cache Sizes ──');
  for (const [svc, data] of Object.entries(services)) {
    if (data.error) {
      console.log(`  ${svc}: ERROR — ${data.error}`);
    } else {
      console.log(`  ${svc}: ${JSON.stringify(data)}`);
    }
  }

  console.log('\n── Leak Analysis ──');
  console.log(`  Risk Level    : ${leakRisk.risk.toUpperCase()}`);
  console.log(`  Elapsed       : ${leakRisk.elapsed_hours}h`);
  if (leakRisk.heapGrowthMB) console.log(`  Heap Growth   : ${leakRisk.heapGrowthMB} MB (${leakRisk.growthPerHourMB} MB/h)`);
  if (leakRisk.rssGrowthMB) console.log(`  RSS Growth    : ${leakRisk.rssGrowthMB} MB (${leakRisk.rssPerHourMB} MB/h)`);
  if (leakRisk.warnings.length > 0) {
    console.log('  Warnings:');
    leakRisk.warnings.forEach(w => console.log(`    ⚠️  ${w}`));
  }
  console.log('');

  return { snapshot, services, leakRisk };
}

if (require.main === module) {
  const label = process.argv[2] || 'snapshot_' + Date.now();
  runProfile(label);
}

module.exports = { runProfile, getMemorySnapshot, calculateLeakRisk, analyzeServiceMemory };
