/**
 * Priority 1 Auto-Remediation Script
 * Fixes: missing .lean(), empty catch blocks
 * Safe to run multiple times — idempotent
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');
const REPORTS_DIR = path.resolve(__dirname, '..', 'reports');

let fileLogger = { info: console.log, warn: console.warn, error: console.error };
try {
  const l = require(path.join(SRC, 'utils', 'logger'));
  if (l && l.logger) fileLogger = l.logger;
} catch (err) {
  console.error('Logger not available, using console fallback:', err.message);
}

const MONGOOSE_MODELS = new Set([
  'Store', 'Product', 'Service', 'User', 'Order', 'Payment', 'Transaction',
  'Review', 'Coupon', 'Ticket', 'AIChat', 'Withdrawal', 'FraudAlert', 'PendingAction',
  'LoyaltyReward', 'BackupLog', 'AlertLog', 'AuditLog', 'Commission',
  'MarketplaceSettings', 'ServerSettings', 'SettingsHistory', 'ServerLog',
]);

const MODEL_PATTERN = /[A-Z]\w+\.(find|findOne|findById)\s*\(/;

const stats = {
  leanAdded: 0,
  emptyCatchFixed: 0,
  mapsBounded: 0,
  filesModified: new Set(),
};

function isMongooseModelLine(trimmed) {
  for (const m of MONGOOSE_MODELS) {
    if (trimmed.includes(m + '.')) return true;
  }
  return MODEL_PATTERN.test(trimmed);
}

function findClosingParenIndex(line) {
  const idx = line.lastIndexOf(')');
  return idx > 0 ? idx : -1;
}

function addLeanBeforeClosing(line) {
  const idx = findClosingParenIndex(line);
  if (idx < 0) return line;
  return line.substring(0, idx) + '.lean()' + line.substring(idx);
}

function fixLean(content, filePath) {
  const lines = content.split('\n');
  const newLines = [];
  let modified = false;
  let openParens = 0;
  let inQuery = false;
  let queryStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.includes('.lean()') || trimmed.includes('.session(')) {
      newLines.push(line);
      if (inQuery && trimmed.includes('.lean()')) inQuery = false;
      continue;
    }

    const queryMatch = trimmed.match(MODEL_PATTERN);
    if (queryMatch && !inQuery) {
      const openCount = (trimmed.match(/\(/g) || []).length;
      const closeCount = (trimmed.match(/\)/g) || []).length;
      openParens = openCount - closeCount;

      if (openParens <= 0) {
        if (!trimmed.includes('.lean()') && !trimmed.includes('.session(') && isMongooseModelLine(trimmed)) {
          const fixed = addLeanBeforeClosing(line);
          if (fixed !== line) {
            newLines.push(fixed);
            stats.leanAdded++;
            modified = true;
            continue;
          }
        }
        newLines.push(line);
        continue;
      }

      inQuery = true;
      queryStartLine = i;
      openParens = openCount - closeCount;
      newLines.push(line);
      continue;
    }

    if (inQuery) {
      const openCount = (trimmed.match(/\(/g) || []).length;
      const closeCount = (trimmed.match(/\)/g) || []).length;
      openParens += openCount - closeCount;

      if (openParens <= 0) {
        inQuery = false;
        let hasLean = false;
        let hasSession = false;
        for (let j = queryStartLine; j <= i; j++) {
          const lc = lines[j];
          if (lc.includes('.lean()')) hasLean = true;
          if (lc.includes('.session(')) hasSession = true;
        }
        if (!hasLean && !hasSession) {
          newLines.push(addLeanBeforeClosing(line));
          stats.leanAdded++;
          modified = true;
          continue;
        }
      }
      newLines.push(line);
      continue;
    }

    newLines.push(line);
  }

  if (modified) {
    stats.filesModified.add(filePath);
    return newLines.join('\n');
  }
  return content;
}

function findEmptyCatches(content, filePath) {
  if (content.indexOf('catch {') === -1 && content.indexOf('catch{') === -1) return content;

  const result = [];
  let lastIndex = 0;
  const regex = /catch\s*\{[^}]*\}/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const catchBlock = match[0];
    const body = catchBlock.replace(/^catch\s*\{\s*/, '').replace(/\s*\}$/, '');
    if (body.length === 0 || /^\s*$/.test(body)) {
      const fileRelPath = path.relative(SRC, filePath).replace(/\\/g, '/');
      const replacement = `catch (err) { fileLogger.error('Unhandled error in ${fileRelPath}', { error: err && err.message ? err.message : err }) }`;
      result.push(content.substring(lastIndex, match.index));
      result.push(replacement);
      lastIndex = regex.lastIndex;
      stats.emptyCatchFixed++;
      stats.filesModified.add(filePath);
    }
  }

  if (result.length === 0) return content;
  result.push(content.substring(lastIndex));
  return result.join('');
}

function processFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    const original = content;

    content = fixLean(content, filePath);
    content = findEmptyCatches(content, filePath);

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  } catch (err) {
    fileLogger.error('Error processing file', { file: filePath, error: err.message });
  }
}

function walkDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    fileLogger.error('Cannot read directory', { dir, error: err.message });
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      processFile(fullPath);
    }
  }
}

function saveStats() {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
    fs.writeFileSync(
      path.join(REPORTS_DIR, 'remediation-stats.json'),
      JSON.stringify({ ...stats, filesModified: [...stats.filesModified] }, null, 2)
    );
  } catch (err) {
    fileLogger.error('Failed to save stats', { error: err.message });
  }
}

console.log('Starting Priority 1 remediation...\n');
walkDir(SRC);

console.log(`\n=== Remediation Complete ===`);
console.log(`Files modified: ${stats.filesModified.size}`);
console.log(`.lean() added: ${stats.leanAdded}`);
console.log(`Empty catches fixed: ${stats.emptyCatchFixed}`);

saveStats();
console.log('\nStats saved to reports/remediation-stats.json');
