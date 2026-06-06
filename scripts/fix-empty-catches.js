const fs = require('fs');
const path = require('path');
const SRC = path.resolve(process.cwd(), 'src');
let totalFixed = 0;
const modFiles = [];

function ensureLoggerImport(content, rel) {
  if (/require\([^)]*logger[^)]*\)/.test(content)) return content;
  const depth = rel.split(/[/\\]/).length - 1;
  const prefix = depth > 0 ? '../'.repeat(depth) : './';
  const imp = `const { logger } = require('${prefix}utils/logger');\n`;
  const m = content.match(/^const\s+\w+\s*=\s*require\([^)]+\);/m);
  if (m) return content.replace(m[0], m[0] + '\n' + imp.trim());
  return imp + content;
}

function fixFile(fp) {
  let content = fs.readFileSync(fp, 'utf-8');
  const orig = content;
  const rel = path.relative(SRC, fp).replace(/\\/g, '/');
  let changed = false;

  // catch {}  → catch (err) { logger.error(...) }
  const emptyCatchRE = /catch\s*\{\s*\}/g;
  if (emptyCatchRE.test(content)) {
    content = content.replace(emptyCatchRE, `catch (err) { logger.error('Unhandled error in ${rel}', { error: err?.message }) }`);
    changed = true;
  }

  // catch { /* any comment */ }  → same
  const commentCatchRE = /catch\s*\{\s*\/\*[\s\S]*?\*\/\s*\}/g;
  if (commentCatchRE.test(content)) {
    content = content.replace(commentCatchRE, `catch (err) { logger.error('Unhandled error in ${rel}', { error: err?.message }) }`);
    changed = true;
  }

  if (changed) {
    content = ensureLoggerImport(content, rel);
    fs.writeFileSync(fp, content, 'utf-8');
    const additions = (content.match(/logger\.error\('Unhandled error in/g) || []).length;
    totalFixed += additions;
    modFiles.push({ file: rel, count: additions });
    console.log(`  ${rel}: +${additions}`);
  }
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(p);
    else if (e.isFile() && e.name.endsWith('.js')) fixFile(p);
  }
}

console.log('Fixing empty catch blocks...\n');
walk(SRC);
console.log(`\nTotal: ${totalFixed} empty catches fixed in ${modFiles.length} files`);
fs.writeFileSync(path.join(process.cwd(), 'reports', 'catch-fix-stats.json'), JSON.stringify({ total: totalFixed, files: modFiles }, null, 2));
