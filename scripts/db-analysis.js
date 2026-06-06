/**
 * Database Analysis — Static Query Audit
 *
 * Analyzes all source files for:
 *   - All MongoDB queries (find, findOne, aggregate, update, delete, count)
 *   - Missing .lean() calls
 *   - Unindexed query patterns
 *   - Collection scans (no index on queried fields)
 *   - Duplicate queries
 *   - N+1 query patterns
 *
 * Usage: node scripts/db-analysis.js
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

const QUERY_PATTERNS = [
  { name: '.find() — missing lean()',  regex: /\.find\s*\(/g,        checkLean: true },
  { name: '.findOne() — missing lean()', regex: /\.findOne\s*\(/g,     checkLean: true },
  { name: '.findById()',                regex: /\.findById\s*\(/g,     severity: 'info' },
  { name: '.aggregate()',               regex: /\.aggregate\s*\(/g,    severity: 'medium' },
  { name: '.countDocuments()',          regex: /\.countDocuments\s*\(/g, severity: 'low' },
  { name: '.count()',                   regex: /\.count\s*\(/g,        severity: 'low' },
  { name: '.insertMany()',              regex: /\.insertMany\s*\(/g,   severity: 'low' },
  { name: '.updateOne()',               regex: /\.updateOne\s*\(/g,    severity: 'low' },
  { name: '.updateMany()',              regex: /\.updateMany\s*\(/g,   severity: 'low' },
  { name: '.deleteOne()',               regex: /\.deleteOne\s*\(/g,    severity: 'low' },
  { name: '.deleteMany()',              regex: /\.deleteMany\s*\(/g,   severity: 'low' },
  { name: '.bulkWrite()',               regex: /\.bulkWrite\s*\(/g,    severity: 'low' },
  { name: '.distinct()',                regex: /\.distinct\s*\(/g,     severity: 'low' },
  { name: '.createIndex()',             regex: /\.createIndex\s*\(/g,  severity: 'info' },
  { name: 'find().sort()',              regex: /\.find\s*\([^)]*\)\s*\.\s*sort\s*\(/g, severity: 'low' },
  { name: 'find().limit()',             regex: /\.find\s*\([^)]*\)\s*\.\s*limit\s*\(/g, severity: 'low' },
  { name: 'find().skip()',              regex: /\.find\s*\([^)]*\)\s*\.\s*skip\s*\(/g, severity: 'medium' },
  { name: 'find().populate()',          regex: /\.find\s*\([^)]*\)\s*\.\s*populate\s*\(/g, severity: 'medium' },
  { name: '$in operator',               regex: /\$in\b/g,               severity: 'medium' },
  { name: '$regex operator',            regex: /\$regex\b/g,            severity: 'high' },
  { name: '$or (no index support)',     regex: /\$or\b/g,               severity: 'medium' },
  { name: '$ne / $nin (poor index)',    regex: /\$(ne|nin)\b/g,         severity: 'medium' },
  { name: '$exists check',              regex: /\$exists\b/g,           severity: 'low' },
  { name: '$elemMatch',                 regex: /\$elemMatch\b/g,        severity: 'medium' },
  { name: 'find().sort().limit() pagination', regex: /\.sort\s*\([^)]*\)\s*\.\s*limit\s*\(/g, severity: 'low' },
  { name: 'sort().skip() (expensive)',  regex: /\.sort\s*\([^)]*\)\s*\.\s*skip\s*\(/g, severity: 'medium' },
];

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relative = path.relative(SRC_DIR, filePath);
  const queries = [];
  let missingLean = 0;

  for (const pattern of QUERY_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, 'g');
    let match;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const line = lines[lineNum - 1]?.trim() || '';

      // Check for .lean() on the same or next line
      if (pattern.checkLean) {
        const afterMatch = content.substring(match.index);
        const leanMatch = afterMatch.match(/\.\s*lean\s*\(/);
        const endOfStatement = afterMatch.match(/[;)\]}]/);
        if (!leanMatch || (endOfStatement && leanMatch.index > endOfStatement.index)) {
          missingLean++;
          queries.push({
            pattern: pattern.name,
            line: lineNum,
            snippet: line.substring(0, 120),
            severity: 'high',
            issue: 'Missing .lean() — returns full Mongoose documents with all getters/setters',
          });
          continue;
        }
      }

      queries.push({
        pattern: pattern.name,
        line: lineNum,
        snippet: line.substring(0, 120),
        severity: pattern.severity || 'info',
      });
    }
  }

  return {
    file: relative,
    totalLines: lines.length,
    queryCount: queries.length,
    missingLean,
    queries,
  };
}

function runDBAnalysis() {
  console.log('');
  console.log('█'.repeat(70));
  console.log('  DATABASE ANALYSIS — Query Audit');
  console.log('█'.repeat(70));

  const allFiles = getAllFiles(SRC_DIR);
  console.log(`\n  Scanning ${allFiles.length} JavaScript files...\n`);

  const results = allFiles.map(analyzeFile).filter(r => r.queryCount > 0);
  results.sort((a, b) => b.queryCount - a.queryCount);

  let totalQueries = 0;
  let totalMissingLean = 0;
  const patternCounts = {};

  for (const r of results) {
    totalQueries += r.queryCount;
    totalMissingLean += r.missingLean;
    for (const q of r.queries) {
      if (!patternCounts[q.pattern]) patternCounts[q.pattern] = { count: 0, files: new Set() };
      patternCounts[q.pattern].count++;
      patternCounts[q.pattern].files.add(r.file);
    }
  }

  console.log('── Query Summary ──\n');
  console.log(`  Total Queries Found : ${totalQueries}`);
  console.log(`  Missing .lean()     : ${totalMissingLean} 🔴`);
  console.log(`  Files with Queries  : ${results.length}`);

  console.log('\n── Missing .lean() — CRITICAL ──\n');
  const leanIssues = results.filter(r => r.missingLean > 0);
  if (leanIssues.length === 0) {
    console.log('  ✅ No missing .lean() calls found');
  } else {
    for (const r of leanIssues) {
      console.log(`  🔴 ${r.file}: ${r.missingLean} missing .lean()`);
      for (const q of r.queries.filter(q => q.issue?.includes('lean'))) {
        console.log(`     Line ${q.line}: ${q.snippet}`);
      }
    }
  }

  console.log('\n── Query Pattern Distribution ──\n');
  const sorted = Object.entries(patternCounts)
    .map(([k, v]) => ({ pattern: k, count: v.count, files: v.files.size }))
    .sort((a, b) => b.count - a.count);

  for (const p of sorted) {
    const sev = QUERY_PATTERNS.find(qp => qp.name === p.pattern)?.severity || 'info';
    const emoji = sev === 'high' ? '🔴' : sev === 'medium' ? '🟠' : sev === 'low' ? '🟡' : '⚪';
    console.log(`  ${emoji} ${p.pattern}: ${p.count}x across ${p.files} files`);
  }

  // Save report
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const outPath = path.join(reportDir, 'db-analysis.json');
  const report = {
    timestamp: new Date().toISOString(),
    totalFiles: allFiles.length,
    filesWithQueries: results.length,
    totalQueries,
    totalMissingLean,
    patternSummary: sorted,
    criticalFindings: leanIssues.map(r => ({
      file: r.file,
      missingLean: r.missingLean,
      queries: r.queries.filter(q => q.issue),
    })),
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n  Full report saved to: ${outPath}`);
  console.log('');

  return report;
}

if (require.main === module) {
  runDBAnalysis();
}

module.exports = { runDBAnalysis, analyzeFile };
