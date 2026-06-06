const fs = require('fs');
const path = require('path');
const SRC = path.resolve(process.cwd(), 'src');

const WRITE_OPS = /\.(create|insert|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|findByIdAndUpdate|findOneAndDelete|findByIdAndDelete|findOneAndReplace)\s*\(/;
const QUERY_OPS = /\.(find|findOne|findById)\s*\(/;
const MODEL_RE = /\b(Store|Product|Service|User|Order|Payment|Transaction|Review|Coupon|Ticket|AIChat|Withdrawal|FraudAlert|PendingAction|LoyaltyReward|BackupLog|AlertLog|AuditLog|Commission|MarketplaceSettings|ServerSettings|SettingsHistory|ServerLog)\b/;

let totalAdd = 0;
const modFiles = [];

function processFile(fp) {
  let content = fs.readFileSync(fp, 'utf-8');
  const orig = content;
  const lines = content.split('\n');
  const rel = path.relative(SRC, fp).replace(/\\/g, '/');

  // Strategy: track query statements that span multiple lines
  // When we see a Model.find( or similar, track until ); or ;
  let i = 0;
  const edits = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip lines that already have .lean()
    if (trimmed.includes('.lean()')) { i++; continue; }

    // Detect start of query: await Model.find( or const x = Model.find(
    if (QUERY_OPS.test(trimmed) && MODEL_RE.test(trimmed) && !WRITE_OPS.test(trimmed)) {
      // Collect the whole statement
      let stmt = [];
      let j = i;
      let depth = 0;
      let started = false;
      let closed = false;

      while (j < lines.length) {
        const l = lines[j];
        stmt.push(l);

        for (const ch of l) {
          if (ch === '(') { started = true; depth++; }
          else if (ch === ')') { depth--; }
        }

        if (started && depth === 0 && (l.trim().endsWith(';') || l.trim().endsWith(')'))) {
          closed = true;
          break;
        }
        j++;
      }

      if (closed) {
        const fullStmt = stmt.join(' ');
        const fullNoSpace = stmt.map(s => s.trim()).join('');

        // Check: no .lean() in full stmt, and ends with ); or ;
        if (!fullNoSpace.includes('.lean()')) {
          // Find the last closing paren before ;
          const lastLine = stmt[stmt.length - 1];
          const lastLineTrimmed = lastLine.trim();

          if (lastLineTrimmed.endsWith(');') || lastLineTrimmed.endsWith(';') || lastLineTrimmed.endsWith(')')) {
            // Add .lean() to the last line
            const semiIdx = lastLine.lastIndexOf(';');
            const parenIdx = lastLine.lastIndexOf(')');

            if (parenIdx > 0 && semiIdx > parenIdx) {
              const newLastLine = lastLine.substring(0, parenIdx) + '.lean()' + lastLine.substring(parenIdx);
              edits.push({ line: j, old: lastLine, new: newLastLine });
            } else if (parenIdx > 0 && !lastLineTrimmed.includes(';')) {
              // Ends with just )
              const newLastLine = lastLine.substring(0, parenIdx) + '.lean()' + lastLine.substring(parenIdx);
              edits.push({ line: j, old: lastLine, new: newLastLine });
            }
          }
        }
        i = j;
      }
    }
    i++;
  }

  if (edits.length > 0) {
    for (const e of edits) {
      if (lines[e.line] === e.old) {
        lines[e.line] = e.new;
        totalAdd++;
      }
    }

    let result = lines.join('\n');
    result = result.replace(/\.lean\(\)\s*\.lean\(\)/g, '.lean()');

    if (result !== orig) {
      fs.writeFileSync(fp, result, 'utf-8');
      modFiles.push({ file: rel, add: edits.length });
      console.log(`  ${rel}: +${edits.length}`);
    }
  }
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(p);
    else if (e.isFile() && e.name.endsWith('.js')) processFile(p);
  }
}

console.log('Adding .lean() to Mongoose queries...\n');
walk(SRC);
console.log(`\nTotal: ${totalAdd} .lean() added across ${modFiles.length} files`);

fs.writeFileSync(
  path.join(process.cwd(), 'reports', 'lean-stats.json'),
  JSON.stringify({ total: totalAdd, files: modFiles }, null, 2)
);
