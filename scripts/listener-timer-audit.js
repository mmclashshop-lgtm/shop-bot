/**
 * Event Listener & Timer Audit
 *
 * Audits all source files for:
 *   - setInterval / setTimeout usage
 *   - process.on('event') listeners
 *   - client.on('event') listeners
 *   - Proper cleanup in destroy()/stop()/shutdown() methods
 *   - Duplicate listener registrations
 *   - Listener leaks (registered but never removed)
 *
 * Usage: node scripts/listener-timer-audit.js
 */

const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '..'));

const SRC_DIR = path.join(__dirname, '..', 'src');
const EXCLUDED = ['node_modules', '.git', 'coverage', 'reports', 'data'];

function getAllFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (EXCLUDED.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(full));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relative = path.relative(SRC_DIR, filePath);

  // Timers
  const setIntervalCount = (content.match(/setInterval\s*\(/g) || []).length;
  const setTimeoutCount = (content.match(/setTimeout\s*\(/g) || []).length;
  const clearIntervalCount = (content.match(/clearInterval\s*\(/g) || []).length;
  const clearTimeoutCount = (content.match(/clearTimeout\s*\(/g) || []).length;

  // Event listeners
  const processOnCount = (content.match(/process\.on\s*\(/g) || []).length;
  const clientOnCount = (content.match(/client\.on\s*\(/g) || []).length;
  const mongooseOnCount = (content.match(/mongoose\.connection\.on\s*\(/g) || []).length;
  const onceCount = (content.match(/\.once\s*\(/g) || []).length;

  // Cleanup methods
  const hasDestroy = content.includes('destroy()') || content.includes('destroy ()');
  const hasStop = content.includes('stop()') || content.includes('stop ()');
  const hasShutdown = content.includes('shutdown(');
  const hasCleanup = content.includes('cleanup') || content.includes('_cleanup') || content.includes('stopCleanup');

  // Match timers with cleanup
  const timerVars = [];
  const timerRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:setInterval|setTimeout)\s*\(/g;
  let m;
  while ((m = timerRegex.exec(content)) !== null) {
    timerVars.push(m[1]);
  }

  // Check if timer vars are cleared
  let cleanedCount = 0;
  for (const v of timerVars) {
    if (content.includes(`clearInterval(${v})`) || content.includes(`clearTimeout(${v})`)) {
      cleanedCount++;
    }
  }

  const totalTimers = setIntervalCount + setTimeoutCount;
  const totalCleared = clearIntervalCount + clearTimeoutCount;
  const uncleanedTimers = timerVars.length - cleanedCount;

  // Check for duplicate listener patterns
  const listenerPatterns = {};
  const listenerRegex = /\.(?:on|once)\s*\(\s*['"`](\w+)['"`]/g;
  while ((m = listenerRegex.exec(content)) !== null) {
    const event = m[1];
    listenerPatterns[event] = (listenerPatterns[event] || 0) + 1;
  }
  const duplicates = Object.entries(listenerPatterns).filter(([_, count]) => count > 1);

  return {
    file: relative,
    totalLines: lines.length,
    timers: {
      setInterval: setIntervalCount,
      setTimeout: setTimeoutCount,
      clearInterval: clearIntervalCount,
      clearTimeout: clearTimeoutCount,
      total: totalTimers,
      cleared: totalCleared,
      timerVars: timerVars.length,
      cleanedVars: cleanedCount,
      uncleaned: uncleanedTimers,
    },
    listeners: {
      processOn: processOnCount,
      clientOn: clientOnCount,
      mongooseOn: mongooseOnCount,
      once: onceCount,
      total: processOnCount + clientOnCount + mongooseOnCount,
      duplicateEvents: duplicates.length,
    },
    cleanup: {
      hasDestroy, hasStop, hasShutdown, hasCleanup,
    },
    duplicateListeners: duplicates.map(([ev, count]) => `${ev} (${count}x)`),
  };
}

function runAudit() {
  console.log('');
  console.log('█'.repeat(70));
  console.log('  EVENT LISTENER & TIMER AUDIT');
  console.log('█'.repeat(70));

  const allFiles = getAllFiles(SRC_DIR);
  console.log(`\n  Scanning ${allFiles.length} JavaScript files...\n`);

  const results = allFiles.map(analyzeFile);

  // Summary
  let totalSetInterval = 0, totalSetTimeout = 0, totalClearInterval = 0, totalClearTimeout = 0;
  let totalProcessOn = 0, totalClientOn = 0, totalMongooseOn = 0, totalOnce = 0;
  let totalUncleanedVars = 0;
  let totalDuplicateEvents = 0;

  for (const r of results) {
    totalSetInterval += r.timers.setInterval;
    totalSetTimeout += r.timers.setTimeout;
    totalClearInterval += r.timers.clearInterval;
    totalClearTimeout += r.timers.clearTimeout;
    totalProcessOn += r.listeners.processOn;
    totalClientOn += r.listeners.clientOn;
    totalMongooseOn += r.listeners.mongooseOn;
    totalOnce += r.listeners.once;
    totalUncleanedVars += r.timers.uncleaned;
    totalDuplicateEvents += r.listeners.duplicateEvents;
  }

  console.log('── Timer Summary ──\n');
  console.log(`  setInterval        : ${totalSetInterval}`);
  console.log(`  setTimeout         : ${totalSetTimeout}`);
  console.log(`  clearInterval      : ${totalClearInterval}`);
  console.log(`  clearTimeout       : ${totalClearTimeout}`);
  console.log(`  Uncleaned Timers   : ${totalUncleanedVars} ${totalUncleanedVars > 0 ? '🔴' : '✅'}`);

  console.log('\n── Listener Summary ──\n');
  console.log(`  process.on()       : ${totalProcessOn}`);
  console.log(`  client.on()        : ${totalClientOn}`);
  console.log(`  mongoose.on()      : ${totalMongooseOn}`);
  console.log(`  .once()            : ${totalOnce}`);
  console.log(`  Duplicate Events   : ${totalDuplicateEvents} ${totalDuplicateEvents > 0 ? '🟠' : '✅'}`);

  // Uncleaned timers detail
  const uncleanedFiles = results.filter(r => r.timers.uncleaned > 0);
  if (uncleanedFiles.length > 0) {
    console.log('\n── Uncleaned Timers — Potential Leaks ──\n');
    for (const r of uncleanedFiles) {
      console.log(`  🔴 ${r.file}: ${r.timers.uncleaned} timer(s) not cleared`);
      console.log(`     setInterval: ${r.timers.setInterval}, setTimeout: ${r.timers.setTimeout}`);
      console.log(`     clearInterval: ${r.timers.clearInterval}, clearTimeout: ${r.timers.clearTimeout}`);
    }
  }

  // Duplicate listener events
  const dupFiles = results.filter(r => r.duplicateListeners.length > 0);
  if (dupFiles.length > 0) {
    console.log('\n── Duplicate Listener Events ──\n');
    for (const r of dupFiles) {
      console.log(`  🟠 ${r.file}: ${r.duplicateListeners.join(', ')}`);
    }
  }

  // Cleanup method coverage
  const noCleanup = results.filter(r => r.timers.total > 0 && !r.cleanup.hasDestroy && !r.cleanup.hasStop && !r.cleanup.hasShutdown);
  if (noCleanup.length > 0) {
    console.log('\n── Timers Without Cleanup Methods ──\n');
    for (const r of noCleanup) {
      console.log(`  🟠 ${r.file}: ${r.timers.total} timer(s), no destroy/stop/shutdown`);
    }
  }

  // Save report
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const outPath = path.join(reportDir, 'listener-timer-audit.json');
  const report = {
    timestamp: new Date().toISOString(),
    totalFiles: allFiles.length,
    timerSummary: { setInterval: totalSetInterval, setTimeout: totalSetTimeout, clearInterval: totalClearInterval, clearTimeout: totalClearTimeout, uncleaned: totalUncleanedVars },
    listenerSummary: { processOn: totalProcessOn, clientOn: totalClientOn, mongooseOn: totalMongooseOn, once: totalOnce, duplicateEvents: totalDuplicateEvents },
    uncleanedTimers: uncleanedFiles.map(r => ({ file: r.file, uncleaned: r.timers.uncleaned, timers: r.timers })),
    duplicateListeners: dupFiles.map(r => ({ file: r.file, events: r.duplicateListeners })),
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n  Full report saved to: ${outPath}`);
  console.log('');

  return report;
}

if (require.main === module) {
  runAudit();
}

module.exports = { runAudit };
