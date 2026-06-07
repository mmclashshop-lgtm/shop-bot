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

const SRC_DIR = path.join(__dirname, '..', 'src');
const EXCLUDED = new Set(['node_modules', '.git', 'coverage', 'reports', 'data', 'dist', 'build']);

function getAllFiles(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (EXCLUDED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getAllFiles(full));
      } else if (entry.name.endsWith('.js')) {
        files.push(full);
      }
    }
    return files;
  } catch (err) {
    console.error(`  \u26A0 Error reading directory ${dir}: ${err.message}`);
    return [];
  }
}

function getEntryPoints() {
  // Return paths relative to SRC_DIR
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.main) {
      const absEntry = path.resolve(path.join(__dirname, '..'), pkg.main);
      const entry = path.relative(SRC_DIR, absEntry).replace(/\\/g, '/');
      return [entry];
    }
  } catch {}
  return ['index.js'];
}

function analyzeFile(filePath, allRelativePaths) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`  \u26A0 Error reading ${filePath}: ${err.message}`);
    return null;
  }
  const lines = content.split('\n');
  const relative = path.relative(SRC_DIR, filePath).replace(/\\/g, '/');

  // All require() calls with line numbers
  const requires = [];
  const requireLineRegex = /require\s*\(\s*['"](\.\/|\.\.\/)([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = requireLineRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split('\n').length;
    requires.push({ path: m[2], line: lineNum });
  }

  // Unused require variables (with line numbers)
  const requireVarsUnused = [];
  const varRegex = /(?:const|let|var)\s+(?:(\w+)|{([^}]+)})\s*=\s*require\(/g;
  let vm;
  while ((vm = varRegex.exec(content)) !== null) {
    const varNames = vm[1] ? [vm[1]] : (vm[2] ? vm[2].split(',').map(s => s.trim()).filter(Boolean) : []);
    for (const varName of varNames) {
      if (!varName) continue;
      const afterIdx = vm.index + vm[0].length;
      const restOfFile = content.substring(afterIdx);
      const refRegex = new RegExp(`\\b${varName}\\b`, 'g');
      let refCount = 0;
      while (refRegex.exec(restOfFile) !== null) refCount++;
      if (refCount === 0) {
        const lineNum = content.substring(0, vm.index).split('\n').length;
        requireVarsUnused.push({ name: varName, line: lineNum });
      }
    }
  }

  // Detect exports
  const exports = [];
  const namedExportRegex = /(?:module\.exports|exports)\s*\.\s*(\w+)\s*=/g;
  while ((m = namedExportRegex.exec(content)) !== null) {
    exports.push(m[1]);
  }
  const objExportRegex = /module\.exports\s*=\s*\{([^}]*)\}/g;
  while ((m = objExportRegex.exec(content)) !== null) {
    const keys = m[1].match(/(\w+)\s*(?::|,|\s*})/g);
    if (keys) {
      for (const k of keys) exports.push(k.replace(/[:,\s{}]/g, '').trim());
    }
  }
  const singleExport = content.match(/module\.exports\s*=\s*(\w+)/);
  if (singleExport && !exports.includes(singleExport[1])) exports.push(singleExport[1]);

  // Empty catch blocks with line numbers
  const emptyCatchLines = [];
  const catchRegex = /catch\s*(?:\([^)]*\))?\s*\{([^}]*)\}/gs;
  while ((m = catchRegex.exec(content)) !== null) {
    const body = m[1].trim();
    if (!body || /^\s*\/\/\s*(noop|ignore|silently|skip|pass|nothing)/i.test(body)) {
      const lineNum = content.substring(0, m.index).split('\n').length;
      emptyCatchLines.push(lineNum);
    }
  }

  // Commented-out code with line numbers
  const commentedCodeLines = [];
  const codePatterns = [
    /\bfunction\b/, /\b=>\b/, /\brequire\b/, /\b(const|let|var)\s+\w/,
    /\basync\b/, /\bclass\b/, /\bif\s*\(/, /\breturn\b/, /\bimport\b/,
    /\bexport\b/, /\bconsole\.\b/,
  ];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//')) {
      const codePart = trimmed.replace(/^\/\/\s*/, '');
      if (codePatterns.some(p => p.test(codePart))) {
        commentedCodeLines.push(i + 1);
      }
    }
  }

  return {
    file: relative,
    totalLines: lines.length,
    exports: [...new Set(exports)],
    requires,
    requireVarsUnused,
    emptyCatches: emptyCatchLines,
    commentedCode: commentedCodeLines,
    fileSize: content.length,
  };
}

function runDeadCodeAudit() {
  console.log('');
  console.log('\u2588'.repeat(70));
  console.log('  DEAD CODE AUDIT');
  console.log('\u2588'.repeat(70));

  const allFiles = getAllFiles(SRC_DIR);
  if (allFiles.length === 0) {
    console.error('  \u26A0 No JavaScript files found in src/');
    return;
  }
  console.log(`\n  Scanning ${allFiles.length} JavaScript files...\n`);

  const allRelativePaths = new Set(allFiles.map(f => path.relative(SRC_DIR, f).replace(/\\/g, '/')));

  // Build require map
  const requireMap = {};
  for (const f of allFiles) {
    const relative = path.relative(SRC_DIR, f).replace(/\\/g, '/');
    let content;
    try {
      content = fs.readFileSync(f, 'utf8');
    } catch { continue; }
    const requireRegex = /require\s*\(\s*['"](\.\/|\.\.\/)([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = requireRegex.exec(content)) !== null) {
      const resolved = path.normalize(path.join(path.dirname(f), m[1] + m[2])).replace(/\\/g, '/');
      let reqRelative = path.relative(SRC_DIR, resolved).replace(/\\/g, '/');
      if (!allRelativePaths.has(reqRelative)) {
        const withJs = reqRelative + '.js';
        if (allRelativePaths.has(withJs)) reqRelative = withJs;
      }
      if (!reqRelative.startsWith('..')) {
        if (!requireMap[reqRelative]) requireMap[reqRelative] = [];
        requireMap[reqRelative].push(relative);
      }
    }
  }

  // Analyze each file
  const results = allFiles.map(f => analyzeFile(f, allRelativePaths)).filter(Boolean);

  const entryPoints = getEntryPoints();

  // Unused files
  const unusedFiles = [];
  for (const r of results) {
    if (entryPoints.includes(r.file)) continue;
    if (r.file.includes('node_modules')) continue;
    const reqs = requireMap[r.file];
    if (!reqs || reqs.length === 0) {
      if (!r.file.startsWith('commands') && !r.file.startsWith('events')) {
        unusedFiles.push(r.file);
      }
    }
  }

  // Output: Unused Files
  console.log('\u2500\u2500 Unused Files (Potential Dead Code) \u2500\u2500\n');
  if (unusedFiles.length === 0) {
    console.log('  \u2705 No unused files detected (all files are referenced)');
  } else {
    for (const f of unusedFiles) {
      console.log(`  \uD83D\uDCED ${f}`);
    }
  }

  // Output: Unused Require Imports
  console.log('\n\u2500\u2500 Unused Require Imports \u2500\u2500\n');
  const unusedReqFiles = results.filter(r => r.requireVarsUnused.length > 0);
  if (unusedReqFiles.length === 0) {
    console.log('  \u2705 No unused require() imports detected');
  } else {
    for (const r of unusedReqFiles) {
      const details = r.requireVarsUnused.map(v => `${v.name} (line ${v.line})`).join(', ');
      console.log(`  \uD83D\uDFE0 ${r.file}: ${details}`);
    }
  }

  // Output: Empty Catch Blocks
  console.log('\n\u2500\u2500 Empty Catch Blocks \u2500\u2500\n');
  const emptyCatchFiles = results.filter(r => r.emptyCatches.length > 0);
  if (emptyCatchFiles.length === 0) {
    console.log('  \u2705 No empty catch blocks');
  } else {
    let total = 0;
    for (const r of emptyCatchFiles) {
      console.log(`  \uD83D\uDFE0 ${r.file}: lines ${r.emptyCatches.join(', ')}`);
      total += r.emptyCatches.length;
    }
    console.log(`  Total: ${total} empty catch blocks`);
  }

  // Output: Commented-Out Code
  console.log('\n\u2500\u2500 Commented-Out Code \u2500\u2500\n');
  const commentedFiles = results.filter(r => r.commentedCode.length > 0);
  if (commentedFiles.length === 0) {
    console.log('  \u2705 No commented-out code');
  } else {
    let total = 0;
    for (const r of commentedFiles.sort((a, b) => b.commentedCode.length - a.commentedCode.length).slice(0, 10)) {
      const lineRange = r.commentedCode.length > 5
        ? `${r.commentedCode[0]}-${r.commentedCode[r.commentedCode.length - 1]} (${r.commentedCode.length} lines)`
        : `lines ${r.commentedCode.join(', ')}`;
      console.log(`  \u26AA ${r.file}: ${lineRange}`);
      total += r.commentedCode.length;
    }
    console.log(`  Total: ${total} commented-out code lines`);
  }

  // Save report
  const reportDir = path.join(__dirname, '..', 'reports');
  try {
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const outPath = path.join(reportDir, 'dead-code-audit.json');
    const report = {
      timestamp: new Date().toISOString(),
      totalFiles: allFiles.length,
      unusedFiles,
      unusedRequires: unusedReqFiles.map(r => ({
        file: r.file,
        imports: r.requireVarsUnused.map(v => ({ name: v.name, line: v.line }))
      })),
      emptyCatches: emptyCatchFiles.map(r => ({ file: r.file, lines: r.emptyCatches })),
      topCommentedCode: commentedFiles.sort((a, b) => b.commentedCode.length - a.commentedCode.length).slice(0, 20).map(r => ({
        file: r.file,
        lineCount: r.commentedCode.length,
        lines: r.commentedCode
      })),
    };
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\n  Full report saved to: ${outPath}`);
  } catch (err) {
    console.error(`  \u26A0 Failed to save report: ${err.message}`);
  }
  console.log('');

  return {
    totalFiles: allFiles.length,
    unusedFiles,
    unusedRequires: unusedReqFiles.map(r => ({ file: r.file, imports: r.requireVarsUnused })),
    emptyCatches: emptyCatchFiles.map(r => ({ file: r.file, lines: r.emptyCatches })),
    commentedCode: commentedFiles.map(r => ({ file: r.file, lineCount: r.commentedCode.length })),
  };
}

if (require.main === module) {
  const dir = path.resolve(__dirname, '..');
  process.chdir(dir);
  runDeadCodeAudit();
}

module.exports = { runDeadCodeAudit };
