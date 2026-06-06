/**
 * CPU Profiling — Static Hotspot Analysis
 *
 * Analyzes all source files to identify CPU-intensive patterns:
 *   - Large loops / list iterations
 *   - Heavy string operations
 *   - JSON parse/stringify in hot paths
 *   - Deep nested callbacks
 *   - Synchronous file/network operations
 *
 * Usage: node scripts/cpu-profile.js
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

const HOT_PATTERNS = [
  { name: 'Array.map in hot path',           regex: /\.map\(/g,           severity: 'medium', weight: 1 },
  { name: 'Array.filter in hot path',        regex: /\.filter\(/g,        severity: 'medium', weight: 1 },
  { name: 'Array.reduce in hot path',        regex: /\.reduce\(/g,        severity: 'medium', weight: 1 },
  { name: 'Array.forEach in hot path',       regex: /\.forEach\(/g,       severity: 'medium', weight: 1 },
  { name: 'Deep loop (for/while)',           regex: /\b(for|while)\s*\(/g,severity: 'medium', weight: 1 },
  { name: 'JSON.parse in hot path',          regex: /JSON\.parse/g,       severity: 'low',    weight: 2 },
  { name: 'JSON.stringify in hot path',      regex: /JSON\.stringify/g,    severity: 'low',    weight: 2 },
  { name: 'Heavy regex (global)',            regex: /\/[gmiysu]{1,5}$/gm, severity: 'medium', weight: 2 },
  { name: 'Spread operator in loop',         regex: /\.\.\.\w+/g,         severity: 'low',    weight: 1 },
  { name: 'Object.assign in hot path',       regex: /Object\.assign/g,    severity: 'low',    weight: 2 },
  { name: 'Array.slice in loop',             regex: /\.slice\(/g,         severity: 'low',    weight: 1 },
  { name: 'Synchronous fs operation',        regex: /fs\.(readFileSync|writeFileSync|existsSync|statSync|mkdirSync|unlinkSync|readdirSync)/g, severity: 'high', weight: 5 },
  { name: 'execFileSync / execSync',         regex: /exec(File)?Sync/g,   severity: 'high', weight: 5 },
  { name: 'Nested promise (anti-pattern)',   regex: /new\s+Promise\(/g,   severity: 'low',    weight: 1 },
  { name: 'console.log (blocking)',          regex: /console\.(log|error|warn)/g, severity: 'low', weight: 1 },
  { name: 'Deep object traversal',           regex: /\w+\.\w+\.\w+\.\w+\.\w+/g, severity: 'low', weight: 1 },
  { name: 'Aggregation pipeline (MongoDB)',  regex: /\.aggregate\(/g,     severity: 'medium', weight: 3 },
];

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const findings = [];
  let totalScore = 0;

  const relative = path.relative(SRC_DIR, filePath);

  for (const pattern of HOT_PATTERNS) {
    const matches = content.match(pattern.regex);
    if (matches) {
      const count = matches.length;
      const score = count * pattern.weight;
      totalScore += score;
      findings.push({
        pattern: pattern.name,
        count,
        severity: pattern.severity,
        weight: pattern.weight,
        score,
      });
    }
  }

  return {
    file: relative,
    totalLines: lines.length,
    totalScore,
    findings: findings.sort((a, b) => b.score - a.score),
  };
}

function runCPUProfile() {
  console.log('');
  console.log('█'.repeat(70));
  console.log('  CPU PROFILING — Hotspot Analysis');
  console.log('█'.repeat(70));

  const allFiles = getAllFiles(SRC_DIR);
  console.log(`\n  Scanning ${allFiles.length} JavaScript files...\n`);

  const results = allFiles.map(analyzeFile).filter(r => r.totalScore > 0);
  results.sort((a, b) => b.totalScore - a.totalScore);

  const TOP_N = 20;

  console.log(`── Top ${TOP_N} CPU Hotspots ──\n`);
  for (let i = 0; i < Math.min(TOP_N, results.length); i++) {
    const r = results[i];
    const severityEmoji = r.findings.some(f => f.severity === 'high') ? '🔴' :
                          r.findings.some(f => f.severity === 'medium') ? '🟠' : '🟡';
    console.log(`${severityEmoji}  #${i + 1}: ${r.file}`);
    console.log(`     Score: ${r.totalScore} | Lines: ${r.totalLines} | Hotspots: ${r.findings.length}`);
    for (const f of r.findings.slice(0, 5)) {
      console.log(`     ${f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟠' : '🟡'} ${f.pattern}: ${f.count}x (score: ${f.score})`);
    }
    console.log('');
  }

  // Service-level breakdown
  const serviceResults = {};
  for (const r of results) {
    const parts = r.file.split(path.sep);
    const service = parts[0] === 'services' ? parts[1].replace('.js', '') : parts[0];
    if (!serviceResults[service]) serviceResults[service] = { files: 0, totalScore: 0, findings: [] };
    serviceResults[service].files++;
    serviceResults[service].totalScore += r.totalScore;
    serviceResults[service].findings.push(...r.findings);
  }

  console.log('── Service-Level Hotspot Summary ──\n');
  const sortedSvcs = Object.entries(serviceResults).sort((a, b) => b[1].totalScore - a[1].totalScore);
  for (const [svc, data] of sortedSvcs) {
    const severity = data.totalScore > 50 ? '🔴' : data.totalScore > 20 ? '🟠' : '🟡';
    console.log(`  ${severity} ${svc}: Score=${data.totalScore}, Files=${data.files}`);
  }

  // Save report
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const outPath = path.join(reportDir, 'cpu-profile.json');
  const report = {
    timestamp: new Date().toISOString(),
    totalFiles: allFiles.length,
    filesWithIssues: results.length,
    topHotspots: results.slice(0, 50),
    serviceSummary: sortedSvcs.map(([k, v]) => ({ service: k, ...v })),
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n  Full report saved to: ${outPath}`);
  console.log('');

  return report;
}

if (require.main === module) {
  runCPUProfile();
}

module.exports = { runCPUProfile, analyzeFile };
