/**
 * Cache Efficiency Analysis
 *
 * Analyzes all cache usage patterns across the codebase:
 *   - Cache get/set operations (hit potential)
 *   - TTL values
 *   - Cache key patterns
 *   - Cache invalidation
 *   - Unused caches (Map/WeakMap that are written but never read)
 *
 * Usage: node scripts/cache-analysis.js
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

function analyzeCacheUsage(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relative = path.relative(SRC_DIR, filePath);

  const cacheOps = {
    get: (content.match(/\.\s*get\s*\(/g) || []).length,
    set: (content.match(/\.\s*set\s*\(/g) || []).length,
    delete: (content.match(/\.\s*delete\s*\(/g) || []).length,
    clear: (content.match(/\.\s*clear\s*\(/g) || []).length,
    has: (content.match(/\.\s*has\s*\(/g) || []).length,
    invalidate: (content.match(/invalidate/i) || []).length,
  };

  const mapDeclarations = (content.match(/new\s+Map\s*\(/g) || []).length;
  const weakMapDeclarations = (content.match(/new\s+WeakMap\s*\(/g) || []).length;
  const cacheKeywords = (content.match(/\bcache\b/gi) || []).length;

  // Detect write-only Maps (Map.set but no Map.get)
  const setCount = (content.match(/\.\s*set\s*\(/g) || []).length;
  const getCount = (content.match(/\.\s*get\s*\(/g) || []).length;
  const writeOnly = setCount > 0 && getCount === 0;

  // Detect clear() without size limit (potential leak)
  const hasClear = content.includes('.clear()');
  const hasSizeLimit = content.includes('.size >') || content.includes('size >');

  return {
    file: relative,
    totalLines: lines.length,
    cacheOps,
    mapDeclarations,
    weakMapDeclarations,
    cacheKeywords,
    writeOnly,
    leakRisk: !hasClear && !hasSizeLimit && setCount > 0,
  };
}

function runCacheAnalysis() {
  console.log('');
  console.log('█'.repeat(70));
  console.log('  CACHE EFFICIENCY ANALYSIS');
  console.log('█'.repeat(70));

  const allFiles = getAllFiles(SRC_DIR);
  console.log(`\n  Scanning ${allFiles.length} JavaScript files...\n`);

  const results = allFiles.map(analyzeCacheUsage).filter(r =>
    r.cacheOps.get > 0 || r.cacheOps.set > 0 || r.mapDeclarations > 0 || r.cacheKeywords > 0
  );

  let totalGet = 0, totalSet = 0, totalDelete = 0, totalClear = 0, totalInvalidate = 0;
  let writeOnlyCount = 0, leakRiskCount = 0;

  for (const r of results) {
    totalGet += r.cacheOps.get;
    totalSet += r.cacheOps.set;
    totalDelete += r.cacheOps.delete;
    totalClear += r.cacheOps.clear;
    totalInvalidate += r.cacheOps.invalidate;
    if (r.writeOnly) writeOnlyCount++;
    if (r.leakRisk) leakRiskCount++;
  }

  const hitRate = totalGet + totalSet > 0 ? (totalGet / (totalGet + totalSet)) * 100 : 0;
  const missRate = totalGet + totalSet > 0 ? (totalSet / (totalGet + totalSet)) * 100 : 0;

  console.log('── Cache Operation Summary ──\n');
  console.log(`  GET operations      : ${totalGet}`);
  console.log(`  SET operations      : ${totalSet}`);
  console.log(`  DELETE operations   : ${totalDelete}`);
  console.log(`  CLEAR operations    : ${totalClear}`);
  console.log(`  INVALIDATE ops      : ${totalInvalidate}`);
  console.log(`  Estimated Hit Rate  : ${hitRate.toFixed(1)}%`);
  console.log(`  Estimated Miss Rate : ${missRate.toFixed(1)}%`);

  console.log('\n── Map/WeakMap Declarations ──\n');
  const totalMaps = results.reduce((s, r) => s + r.mapDeclarations, 0);
  const totalWeakMaps = results.reduce((s, r) => s + r.weakMapDeclarations, 0);
  console.log(`  Map instances     : ${totalMaps}`);
  console.log(`  WeakMap instances : ${totalWeakMaps}`);

  console.log('\n── Potential Issues ──\n');

  if (writeOnlyCount > 0) {
    console.log(`  🔴 Write-Only Maps (set without get): ${writeOnlyCount} files`);
    for (const r of results.filter(r => r.writeOnly)) {
      console.log(`     ${r.file}: ${r.cacheOps.set} set, 0 get`);
    }
  } else {
    console.log('  ✅ No write-only Maps detected');
  }

  if (leakRiskCount > 0) {
    console.log(`\n  🟠 Potential Memory Leaks (Map without clear/cleanup): ${leakRiskCount} files`);
    for (const r of results.filter(r => r.leakRisk)) {
      console.log(`     ${r.file}: ${r.cacheOps.set} set operations, no size limit, no clear()`);
    }
  } else {
    console.log('  ✅ All Maps have clear() or size limits');
  }

  // Unused cache analysis
  console.log('\n── Cache Service Usage ──\n');
  const cacheServiceFiles = results.filter(r => r.cacheKeywords > 0 && r.file.includes('cache'));
  if (cacheServiceFiles.length > 0) {
    for (const r of cacheServiceFiles) {
      console.log(`  📦 ${r.file}: ${r.cacheOps.get} gets, ${r.cacheOps.set} sets, ${r.cacheOps.delete} deletes`);
    }
  }

  // Save report
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const outPath = path.join(reportDir, 'cache-analysis.json');
  const report = {
    timestamp: new Date().toISOString(),
    totalGet, totalSet, totalDelete, totalClear, totalInvalidate,
    estimatedHitRate: hitRate.toFixed(1) + '%',
    estimatedMissRate: missRate.toFixed(1) + '%',
    totalMaps, totalWeakMaps,
    writeOnlyFiles: results.filter(r => r.writeOnly).map(r => r.file),
    leakRiskFiles: results.filter(r => r.leakRisk).map(r => ({ file: r.file, sets: r.cacheOps.set })),
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n  Full report saved to: ${outPath}`);
  console.log('');

  return report;
}

if (require.main === module) {
  runCacheAnalysis();
}

module.exports = { runCacheAnalysis };
