/**
 * Memory Profiling Script
 *
 * Measures memory usage of all major services over time.
 * Run periodically (1h, 6h, 12h, 24h) and compare snapshots.
 *
 * Usage: node scripts/memory-profile.js [snapshot_label]
 *   Example: node scripts/memory-profile.js "1h"
 *
 * Can also be imported as a module:
 *   const { runProfile, getMemorySnapshot } = require('./scripts/memory-profile');
 *   const result = runProfile('my_label', { silent: true });
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * @returns {object} Current memory and system snapshot
 */
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

/**
 * Analyzes a series of snapshots for memory leak risk.
 *
 * @param {Array} snapshots - Ordered or unordered snapshot objects with `timestamp` string
 * @returns {object} Leak risk assessment
 */
function calculateLeakRisk(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return { risk: 'insufficient_data', details: 'Need at least 2 snapshots', elapsedHours: 0, warnings: [] };
  }

  const sorted = [...snapshots].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const firstTs = new Date(first.timestamp).getTime();
  const lastTs = new Date(last.timestamp).getTime();

  if (!firstTs || !lastTs || isNaN(firstTs) || isNaN(lastTs)) {
    return { risk: 'unknown', details: 'Snapshots contain invalid timestamps', elapsedHours: 0, warnings: [] };
  }

  const elapsed = (lastTs - firstTs) / 1000;

  if (elapsed < 60) {
    return { risk: 'insufficient_time', details: 'Elapsed time too short for leak detection', elapsedHours: 0, warnings: [] };
  }

  const firstHeap = typeof first.heapUsed?.bytes === 'number' ? first.heapUsed.bytes : 0;
  const lastHeap = typeof last.heapUsed?.bytes === 'number' ? last.heapUsed.bytes : 0;
  const firstRss = typeof first.rss?.bytes === 'number' ? first.rss.bytes : 0;
  const lastRss = typeof last.rss?.bytes === 'number' ? last.rss.bytes : 0;

  const heapGrowth = lastHeap - firstHeap;
  const rssGrowth = lastRss - firstRss;

  const hours = elapsed / 3600;
  const growthPerHour = hours > 0 ? heapGrowth / hours : 0;
  const rssPerHour = hours > 0 ? rssGrowth / hours : 0;

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

  const lastTotalMemGb = last.system?.totalMem?.gb;
  if (typeof lastTotalMemGb === 'number' && lastTotalMemGb > 0) {
    const eightyPercentBytes = lastTotalMemGb * 1024 * 1024 * 1024 * 0.8;
    if (lastHeap > eightyPercentBytes) {
      risk = 'high';
      warnings.push(`Heap usage at ${(lastHeap / 1024 / 1024).toFixed(2)}MB exceeds 80% of system memory`);
    }
  }

  return {
    risk,
    elapsedHours: Math.round(hours * 100) / 100,
    heapGrowthBytes: heapGrowth,
    heapGrowthMB: Math.round(heapGrowth / 1024 / 1024 * 100) / 100,
    growthPerHourMB: Math.round(growthPerHour / 1024 / 1024 * 100) / 100,
    rssGrowthMB: Math.round(rssGrowth / 1024 / 1024 * 100) / 100,
    rssPerHourMB: Math.round(rssPerHour / 1024 / 1024 * 100) / 100,
    warnings,
  };
}

/**
 * Attempts to load each major service and read its internal cache/memory statistics.
 *
 * @returns {object} Service memory stats per service name
 */
function analyzeServiceMemory() {
  const results = {};

  const loadService = (name, requirePath, extractStats) => {
    try {
      const mod = require(requirePath);
      const stats = extractStats(mod);
      results[name] = stats;
    } catch (e) {
      results[name] = { error: e.message };
      if (typeof e.stack === 'string') {
        results[name].stack = e.stack.split('\n').slice(0, 3).join(' ').trim();
      }
    }
  };

  loadService('monitorService', '../src/services/MonitorService', (mod) => {
    const snapshot = typeof mod.getSnapshot === 'function' ? mod.getSnapshot() : {};
    return {
      commandCacheSize: snapshot.commands?.total || 0,
      errorSamples: snapshot.errors?.total || 0,
      memorySamples: snapshot.memory?.samples || 0,
      responseTimeSamples: snapshot.responseTimes?.samples || 0,
    };
  });

  loadService('aiService', '../src/services/AIService', (mod) => {
    const stats = typeof mod.getUsageStats === 'function' ? mod.getUsageStats() : {};
    return {
      rateLimiterSize: stats.rateLimiterSize || 0,
      responseCacheSize: stats.responseCacheSize || 0,
      memoryUsers: stats.memory?.userCacheSize || 0,
      memoryServers: stats.memory?.serverCacheSize || 0,
    };
  });

  loadService('memoryService', '../src/services/MemoryService', (mod) => {
    const stats = typeof mod.getCacheStats === 'function' ? mod.getCacheStats() : {};
    return {
      userCacheSize: stats.userCacheSize || 0,
      serverCacheSize: stats.serverCacheSize || 0,
    };
  });

  loadService('redisCache', '../src/cache/CacheService', (mod) => {
    return { connected: typeof mod.isReady === 'function' ? mod.isReady() : false };
  });

  return results;
}

/**
 * @param {string} label - Snapshot label (sanitized automatically)
 * @param {object} [options]
 * @param {boolean} [options.silent=false] - Suppress console output
 * @returns {object} { snapshot, services, leakRisk }
 */
function runProfile(label = 'snapshot', options = {}) {
  const sanitizedLabel = label.replace(/[^\w-]/g, '_').substring(0, 200);
  const snapshot = getMemorySnapshot();
  const services = analyzeServiceMemory();

  const reportDir = path.resolve(__dirname, '..', 'reports', 'memory');
  fs.mkdirSync(reportDir, { recursive: true });

  // Load existing history
  const historyFile = path.join(reportDir, 'history.json');
  let history = [];
  try {
    const raw = fs.readFileSync(historyFile, 'utf8');
    history = JSON.parse(raw);
  } catch (readErr) {
    if (readErr.code !== 'ENOENT') {
      process.stderr.write(`[MEMORY-PROFILE] Warning: Could not read history: ${readErr.message}\n`);
    }
  }

  if (!Array.isArray(history)) {
    process.stderr.write('[MEMORY-PROFILE] Warning: history.json was not an array; resetting.\n');
    history = [];
  }

  const entry = { label: sanitizedLabel, ...snapshot, services };
  history.push(entry);

  // Keep last 100 snapshots; use splice to avoid full array clone
  if (history.length > 100) {
    history.splice(0, history.length - 100);
  }

  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

  // Save individual snapshot with dedup if label already exists
  let outPath = path.join(reportDir, `${sanitizedLabel}.json`);
  let counter = 1;
  while (fs.existsSync(outPath)) {
    outPath = path.join(reportDir, `${sanitizedLabel}_${counter}.json`);
    counter++;
  }
  fs.writeFileSync(outPath, JSON.stringify({ label: sanitizedLabel, ...snapshot, services }, null, 2));

  // Leak analysis uses only the entry count, not the full array, to keep memory minimal
  const leakRisk = calculateLeakRisk(history);

  if (!options.silent) {
    process.stdout.write('\n');
    process.stdout.write('█'.repeat(70) + '\n');
    process.stdout.write(`  MEMORY PROFILE: ${sanitizedLabel}\n`);
    process.stdout.write('█'.repeat(70) + '\n');
    process.stdout.write(`  RSS           : ${snapshot.rss.mb} MB\n`);
    process.stdout.write(`  Heap Used     : ${snapshot.heapUsed.mb} MB\n`);
    process.stdout.write(`  Heap Total    : ${snapshot.heapTotal.mb} MB\n`);
    process.stdout.write(`  External      : ${snapshot.external.mb} MB\n`);
    process.stdout.write(`  Array Buffers : ${snapshot.arrayBuffers.mb} MB\n`);
    process.stdout.write(`  System Memory : ${snapshot.system.freeMem.gb} GB free / ${snapshot.system.totalMem.gb} GB total\n`);
    process.stdout.write(`  CPU Load      : ${snapshot.cpu.loadAvg.map(l => l.toFixed(2)).join(', ')}\n`);

    process.stdout.write('\n── Service Cache Sizes ──\n');
    for (const [svc, data] of Object.entries(services)) {
      if (data.error) {
        process.stdout.write(`  ${svc}: ERROR — ${data.error}\n`);
      } else {
        process.stdout.write(`  ${svc}: ${JSON.stringify(data)}\n`);
      }
    }

    process.stdout.write('\n── Leak Analysis ──\n');
    process.stdout.write(`  Risk Level    : ${leakRisk.risk.toUpperCase()}\n`);
    process.stdout.write(`  Elapsed       : ${leakRisk.elapsedHours}h\n`);
    if (leakRisk.heapGrowthMB) process.stdout.write(`  Heap Growth   : ${leakRisk.heapGrowthMB} MB (${leakRisk.growthPerHourMB} MB/h)\n`);
    if (leakRisk.rssGrowthMB) process.stdout.write(`  RSS Growth    : ${leakRisk.rssGrowthMB} MB (${leakRisk.rssPerHourMB} MB/h)\n`);
    if (leakRisk.warnings.length > 0) {
      process.stdout.write('  Warnings:\n');
      leakRisk.warnings.forEach(w => process.stdout.write(`    ⚠️  ${w}\n`));
    }
    process.stdout.write('\n');
  }

  return { snapshot, services, leakRisk };
}

if (require.main === module) {
  const label = process.argv[2] || 'snapshot_' + new Date().toISOString().replace(/[:.]/g, '-');
  runProfile(label);
  // Force exit — service imports above may hold the event loop open
  process.exit(0);
}

module.exports = { runProfile, getMemorySnapshot, calculateLeakRisk, analyzeServiceMemory };
