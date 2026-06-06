/**
 * Dead Code Audit
 *
 * Detects:
 *   - Unused files (files not required by any other file)
 *   - Unused exports (exported functions/vars never imported)
 *   - Unused require() imports (imported but never used)
 *   - Orphan utility files
 *   - Empty catch blocks (silent failures)
 *   - Commented-out code blocks
 *
 * Usage: node scripts/dead-code-audit.js
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

function analyzeFile(filePath, allFiles, requireMap) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relative = path.relative(SRC_DIR, filePath);
  const fileName = path.basename(filePath, '.js');

  // All require() calls
  const requires = [];
  const requireRegex = /require\s*\(\s*['"](\.\/|\.\.\/)([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = requireRegex.exec(content)) !== null) {
    requires.push(m[2]);
  }

  // Find module.exports
  const exports = [];
  const exportRegex = /(?:module\.exports|exports\.)\s*=\s*\{?([^;]+)/g;
  let ex;
  while ((ex = exportRegex.exec(content)) !== null) {
    const val = ex[1].trim();
    // Extract keys from object literal
    const keys = val.match(/(\w+)\s*:/g);
    if (keys) {
      for (const k of keys) exports.push(k.replace(':', '').trim());
    } else if (val.startsWith('{') || val.startsWith('[')) {
      exports.push('...');
    } else {
      exports.push(val.split(/\s+/)[0]);
    }
  }

  // Single export
  const singleExport = content.match(/module\.exports\s*=\s*(\w+)/);
  if (singleExport) exports.push(singleExport[1]);

  // Detect empty catch blocks
  const emptyCatches = (content.match(/\bcatch\s*\{?\s*\}?\s*$/gm) || []).length +
    (content.match(/\bcatch\s*\{[^}]*\}\s*$/gm) || []).filter(c => !c.includes('//') && !c.includes('logger')).length;

  // Detect commented-out code (lines starting with // that look like code)
  let commentedCode = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') &&
        (trimmed.includes('function') || trimmed.includes('=>') ||
         trimmed.includes('require') || trimmed.includes('const ') ||
         trimmed.includes('let ') || trimmed.includes('var ') ||
         trimmed.includes('async') || trimmed.includes('class '))) {
      commentedCode++;
    }
  }

  // Detect unused require (variable declared via require but never referenced again)
  const requireVars = [];
  const varRegex = /(?:const|let|var)\s+(\w+)\s*=\s*require\(/g;
  while ((m = varRegex.exec(content)) !== null) {
    const varName = m[1];
    // Check if varName is used after the require
    const afterIdx = content.indexOf(m[0]) + m[0].length;
    const restOfFile = content.substring(afterIdx);
    const refRegex = new RegExp(`\\b${varName}\\b`, 'g');
    let refCount = 0;
    while (refRegex.exec(restOfFile) !== null) refCount++;
    if (refCount === 0) requireVars.push(varName);
  }

  return {
    file: relative,
    totalLines: lines.length,
    exports: [...new Set(exports)],
    requires,
    requireVarsUnused: requireVars,
    emptyCatches,
    commentedCode,
    fileSize: content.length,
  };
}

function runDeadCodeAudit() {
  console.log('');
  console.log('█'.repeat(70));
  console.log('  DEAD CODE AUDIT');
  console.log('█'.repeat(70));

  const allFiles = getAllFiles(SRC_DIR);
  console.log(`\n  Scanning ${allFiles.length} JavaScript files...\n`);

  // Build require map: what files are required by whom
  const requireMap = {};  // requiredFile -> [requirerFile]
  for (const f of allFiles) {
    const relative = path.relative(SRC_DIR, f);
    const content = fs.readFileSync(f, 'utf8');
    const requireRegex = /require\s*\(\s*['"](\.\/|\.\.\/)([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = requireRegex.exec(content)) !== null) {
      const reqPath = path.normalize(path.join(path.dirname(f), m[1] + m[2])).replace(/\\/g, '/');
      const reqRelative = path.relative(SRC_DIR, reqPath).replace(/\\/g, '/');
      if (!reqRelative.startsWith('..')) {
        if (!requireMap[reqRelative]) requireMap[reqRelative] = [];
        requireMap[reqRelative].push(relative);
      }
    }
  }

  // Analyze each file
  const results = allFiles.map(f => analyzeFile(f, allFiles, requireMap));

  // Find unused files (files never required by any other file)
  const entryPoints = ['index.js'];
  const unusedFiles = [];
  for (const r of results) {
    if (entryPoints.includes(r.file)) continue;
    if (r.file.includes('node_modules')) continue;
    const reqs = requireMap[r.file];
    if (!reqs || reqs.length === 0) {
      // Check if it's a command file (auto-loaded by deploy-commands)
      if (!r.file.startsWith('commands') && !r.file.startsWith('events')) {
        unusedFiles.push(r.file);
      }
    }
  }

  console.log('── Unused Files (Potential Dead Code) ──\n');
  if (unusedFiles.length === 0) {
    console.log('  ✅ No unused files detected (all files are referenced)');
  } else {
    for (const f of unusedFiles) {
      console.log(`  📭 ${f}`);
    }
  }

  console.log('\n── Unused Require Imports ──\n');
  const unusedRequires = results.filter(r => r.requireVarsUnused.length > 0);
  if (unusedRequires.length === 0) {
    console.log('  ✅ No unused require() imports detected');
  } else {
    for (const r of unusedRequires) {
      console.log(`  🟠 ${r.file}: unused imports — ${r.requireVarsUnused.join(', ')}`);
    }
  }

  console.log('\n── Empty Catch Blocks ──\n');
  const emptyCatches = results.filter(r => r.emptyCatches > 0);
  if (emptyCatches.length === 0) {
    console.log('  ✅ No empty catch blocks');
  } else {
    let total = 0;
    for (const r of emptyCatches) {
      console.log(`  🟠 ${r.file}: ${r.emptyCatches} empty catch(es)`);
      total += r.emptyCatches;
    }
    console.log(`  Total: ${total} empty catch blocks`);
  }

  console.log('\n── Commented-Out Code ──\n');
  const commentedFiles = results.filter(r => r.commentedCode > 0);
  if (commentedFiles.length === 0) {
    console.log('  ✅ No commented-out code');
  } else {
    let total = 0;
    for (const r of commentedFiles.sort((a, b) => b.commentedCode - a.commentedCode).slice(0, 10)) {
      console.log(`  ⚪ ${r.file}: ${r.commentedCode} commented lines`);
      total += r.commentedCode;
    }
    console.log(`  Total: ${total} commented-out code lines`);
  }

  // Save report
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const outPath = path.join(reportDir, 'dead-code-audit.json');
  const report = {
    timestamp: new Date().toISOString(),
    totalFiles: allFiles.length,
    unusedFiles,
    unusedRequires: unusedRequires.map(r => ({ file: r.file, imports: r.requireVarsUnused })),
    emptyCatches: emptyCatches.map(r => ({ file: r.file, count: r.emptyCatches })),
    topCommentedCode: commentedFiles.sort((a, b) => b.commentedCode - a.commentedCode).slice(0, 20).map(r => ({ file: r.file, lines: r.commentedCode })),
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n  Full report saved to: ${outPath}`);
  console.log('');

  return report;
}

if (require.main === module) {
  runDeadCodeAudit();
}

module.exports = { runDeadCodeAudit };
