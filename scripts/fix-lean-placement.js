/**
 * Fix .lean() that was injected inside query arguments instead of on the query chain.
 * Detects: Model.find({...}.lean()) → Model.find({...}).lean()
 */
const fs = require('fs');
const path = require('path');
const SRC = path.resolve(process.cwd(), 'src');

let fixed = 0;

function fixFile(fp) {
  let content = fs.readFileSync(fp, 'utf-8');
  const orig = content;

  // Pattern: Model.method({...}.lean())  where {...} has balanced braces
  // We need to move .lean() to after the closing ) of the method call
  // Strategy: detect .lean() that appears right after a } that is inside method( )

  // First pass: fix simple patterns where .lean() is on same line inside find/findOne/findById
  content = content.replace(
    /((?:Store|Product|Service|User|Order|Payment|Transaction|Review|Coupon|Ticket|AIChat|Withdrawal|FraudAlert|PendingAction|LoyaltyReward|BackupLog|AlertLog|AuditLog|Commission|MarketplaceSettings|ServerSettings|SettingsHistory|ServerLog)\.\s*(?:find|findOne|findById)\s*\()([^)]*?)\.lean\(\)\s*\)/g,
    (match, prefix, args) => {
      // Count braces to make sure we have the right closing paren
      let depth = 0;
      let splitPos = -1;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '{') depth++;
        else if (args[i] === '}') {
          depth--;
          if (depth === 0) splitPos = i + 1; // after the }
        }
      }
      if (splitPos > 0) {
        const objPart = args.substring(0, splitPos);
        const rest = args.substring(splitPos).replace(/\.lean\(\)/, '');
        fixed++;
        return prefix + objPart + ').lean()' + rest;
      }
      return match;
    }
  );

  if (content !== orig) {
    fs.writeFileSync(fp, content, 'utf-8');
    return true;
  }
  return false;
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(p);
    else if (e.isFile() && e.name.endsWith('.js')) {
      if (fixFile(p)) {
        console.log('  Fixed:', path.relative(SRC, p).replace(/\\/g, '/'));
      }
    }
  }
}

console.log('Moving .lean() from query args to query chain...\n');
walk(SRC);
console.log(`\nFixed ${fixed} misplaced .lean() calls`);
