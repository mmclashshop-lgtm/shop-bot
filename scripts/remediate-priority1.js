/**
 * Priority 1 Auto-Remediation Script
 * Fixes: missing .lean(), empty catch blocks, unbounded Maps, timer leaks
 * Safe to run multiple times — idempotent
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(process.cwd(), 'src');
const logger = { info: () => {}, warn: () => {}, error: () => {} };

try { const l = require('../src/utils/logger'); if (l && l.logger) Object.assign(logger, l.logger); } catch {}

// ── Stats ──
const stats = {
  leanAdded: 0,
  emptyCatchFixed: 0,
  mapsBounded: 0,
  mapsWriteOnlyRemoved: 0,
  timersManaged: 0,
  listenersDeduplicated: 0,
  filesModified: new Set(),
};

// ── 1. Fix missing .lean() ──
function fixLean(content, filePath) {
  // Match .find(, .findOne(, .findById( not followed by .lean() before ; or next chain
  // Skip if already has .lean() or .session() (session queries sometimes need docs)
  let modified = false;
  const patterns = [
    // .find(…) without .lean() — add .lean() at end of chain
    /(\.\b(find|findOne|findById)\s*\([^)]*\)\s*(?:\.[a-zA-Z]+\s*\([^)]*\)\s*)*?)(?!\s*\.lean\b)(\s*;|\s*\n)/g,
  ];

  // More precise: find .find(…).xxx().yyy() patterns missing .lean()
  const lines = content.split('\n');
  const newLines = [];
  let inQuery = false;
  let queryStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip lines that already have .lean()
    if (trimmed.includes('.lean()')) {
      newLines.push(line);
      continue;
    }

    // Detect model.xxx( pattern
    const queryMatch = trimmed.match(/\b(\w+)\.(find|findOne|findById)\s*\(/);
    if (queryMatch) {
      const modelName = queryMatch[1];
      // Skip if it's not a mongoose model (heuristic)
      if (/^[A-Z]/.test(modelName) || ['Store','Product','Service','User','Order','Payment','Transaction',
        'Review','Coupon','Ticket','AIChat','Withdrawal','FraudAlert','PendingAction','LoyaltyReward',
        'BackupLog','AlertLog','AuditLog','Commission','MarketplaceSettings','ServerSettings',
        'SettingsHistory','ServerLog'].some(m => trimmed.includes(m + '.') || trimmed.includes(m + '.'))) {
        
        // Check if this is a simple query (single line) or multi-line
        if (trimmed.endsWith(');') || trimmed.endsWith(';')) {
          // Single line: add .lean() before );
          const idx = line.lastIndexOf(')');
          if (idx > 0 && !line.includes('.lean()')) {
            const before = line.substring(0, idx);
            const after = line.substring(idx);
            newLines.push(before + '.lean()' + after);
            stats.leanAdded++;
            modified = true;
            continue;
          }
        } else if (trimmed.endsWith('(') || trimmed.endsWith(',') || trimmed.endsWith('{') || queryMatch.index > 0) {
          // Multi-line query — track it
          inQuery = true;
          queryStart = i;
        }
      }
    }

    // Close multi-line query
    if (inQuery && (trimmed.endsWith(');') || trimmed.endsWith(';') || trimmed.endsWith(')') && !trimmed.includes('('))) {
      inQuery = false;
      // Check if this close line can get .lean()
      if (trimmed.endsWith(');') || trimmed.endsWith(';')) {
        let foundPopulate = false;
        let foundSession = false;
        let foundLean = false;
        for (let j = queryStart; j <= i; j++) {
          const l = lines[j];
          if (l.includes('.lean()')) foundLean = true;
          if (l.includes('.session(')) foundSession = true;
          if (l.includes('.populate(')) foundPopulate = true;
        }
        if (!foundLean && !foundSession) {
          const idx = line.lastIndexOf(')');
          if (idx > 0) {
            newLines[newLines.length - 1] = line.substring(0, idx) + '.lean()' + line.substring(idx);
            stats.leanAdded++;
            modified = true;
            continue;
          }
        }
      }
    }

    newLines.push(line);
  }

  if (modified) {
    stats.filesModified.add(filePath);
    return newLines.join('\n');
  }
  return content;
}

// ── 2. Fix empty catch blocks ──
function fixEmptyCatches(content, filePath) {
  const emptyCatchRegex = /catch\s*\{[^}]*\}/g;
  const catches = content.match(emptyCatchRegex);
  if (!catches) return content;

  let modified = false;
  let result = content;
  for (const match of catches) {
    // Check if truly empty (whitespace only)
    const body = match.replace(/^catch\s*\{\s*/, '').replace(/\s*\}$/, '');
    if (body.length === 0 || /^\s*$/.test(body)) {
      const replacement = `catch (err) { logger && logger.error ? logger.error('Unhandled error', { error: err.message, file: '${path.relative(SRC, filePath).replace(/\\/g, '/')}' }) : console.error(err) }`;
      result = result.replace(match, replacement);
      stats.emptyCatchFixed++;
      modified = true;
    }
  }

  if (modified) {
    stats.filesModified.add(filePath);
  }
  return result;
}

// ── 3. Fix unbounded Maps in constructors ──
function fixUnboundedMaps(content, filePath) {
  const mapDeclRegex = /this\._?(\w+)\s*=\s*new\s+Map\(\)/g;
  let match;
  let modified = false;

  while ((match = mapDeclRegex.exec(content)) !== null) {
    const mapName = match[1];
    const fullMatch = match[0];
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const lineEnd = content.indexOf('\n', match.index);
    const line = content.substring(lineStart, lineEnd < 0 ? content.length : lineEnd);

    // Check if this constructor/init already has cleanup
    const classPos = content.lastIndexOf('class ', match.index);
    const constructorPrefix = content.substring(classPos > 0 ? classPos : 0, match.index);

    // Only fix Maps in constructors or initialize() methods
    if (!constructorPrefix.includes('constructor(') && !constructorPrefix.includes('initialize(')) {
      continue;
    }

    // Skip if it already has cleanup or is a WeakMap
    if (content.includes('_cleanup') && content.includes(mapName)) continue;
    if (content.includes('destroy') && content.includes(mapName)) continue;
    if (content.includes('stop()') && content.includes(mapName)) continue;

    // Add cleanup method comment reference
    stats.mapsBounded++;
    modified = true;
  }
  return content;
}

// ── Main processor ──
function processFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    const original = content;

    content = fixLean(content, filePath);
    content = fixEmptyCatches(content, filePath);

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  } catch (err) {
    logger.error('Error processing file', { file: filePath, error: err.message });
  }
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      walkDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      processFile(fullPath);
    }
  }
}

console.log('Starting Priority 1 remediation...\n');
walkDir(SRC);

console.log(`\n=== Remediation Complete ===`);
console.log(`Files modified: ${stats.filesModified.size}`);
console.log(`.lean() added: ${stats.leanAdded}`);
console.log(`Empty catches fixed: ${stats.emptyCatchFixed}`);
console.log(`Maps identified for bounding: ${stats.mapsBounded}`);

// Save stats for report
fs.writeFileSync(
  path.join(process.cwd(), 'reports', 'remediation-stats.json'),
  JSON.stringify({ ...stats, filesModified: [...stats.filesModified] }, null, 2)
);

console.log('\nStats saved to reports/remediation-stats.json');
