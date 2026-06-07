/**
 * Fix .lean() that was injected inside query arguments instead of on the query chain.
 * Detects: Model.find({...}.lean()) -> Model.find({...}).lean()
 *
 * Covers all Mongoose models and query methods that support .lean().
 *
 * Usage: node scripts/fix-lean-placement.js
 */
const fs = require('fs');
const path = require('path');

var SRC = path.resolve(__dirname, '..', 'src');

var MODELS = [
  'AIChat', 'AlertLog', 'AuditLog', 'BackupLog', 'Commission', 'Coupon',
  'FraudAlert', 'LoyaltyReward', 'MarketplaceSettings', 'Order', 'Payment',
  'PendingAction', 'Product', 'Review', 'Role', 'ServerSettings', 'Service',
  'SettingsHistory', 'Store', 'Ticket', 'Transaction', 'User', 'Withdrawal',
];

var QUERY_METHODS = [
  'find', 'findOne', 'findById',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'findByIdAndUpdate', 'findByIdAndDelete', 'findByIdAndReplace',
];

function buildPattern() {
  return new RegExp(
    '((?:' + MODELS.join('|') + ')\\.\\s*(?:' + QUERY_METHODS.join('|') + ')\\s*\\()([^)]*?)\\.lean\\(\\)\\s*\\)',
    'g'
  );
}

function fixFile(fp, pattern) {
  var content;
  try {
    content = fs.readFileSync(fp, 'utf-8');
  } catch (err) {
    console.error('  ! Error reading ' + fp + ': ' + err.message);
    return false;
  }
  var orig = content;
  var localFixed = 0;

  content = content.replace(pattern, function (match, prefix, args) {
    var depth = 0;
    var splitPos = -1;
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '{') depth++;
      else if (args[i] === '}') {
        depth--;
        if (depth === 0) splitPos = i + 1;
      }
    }

    localFixed++;
    if (splitPos > 0) {
      var objPart = args.substring(0, splitPos);
      var rest = args.substring(splitPos).replace(/\.lean\(\)/, '');
      return prefix + objPart + ').lean()' + rest;
    }
    return prefix + args + ').lean()';
  });

  if (content !== orig) {
    try {
      fs.writeFileSync(fp, content, 'utf-8');
    } catch (err) {
      console.error('  ! Error writing ' + fp + ': ' + err.message);
      return false;
    }
    console.log('  Fixed: ' + path.relative(SRC, fp).replace(/\\/g, '/'));
    return true;
  }
  return false;
}

function walk(dir, pattern) {
  var totalFixed = 0;
  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error('  ! Error reading directory ' + dir + ': ' + err.message);
    return 0;
  }
  for (var e = 0; e < entries.length; e++) {
    var entry = entries[e];
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    var p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      totalFixed += walk(p, pattern);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      if (fixFile(p, pattern)) {
        totalFixed++;
      }
    }
  }
  return totalFixed;
}

function main() {
  console.log('Moving .lean() from query args to query chain...\n');

  if (!fs.existsSync(SRC)) {
    console.error('  ! Source directory not found: ' + SRC);
    process.exit(1);
  }

  var pattern = buildPattern();
  var fixed = walk(SRC, pattern);
  console.log('\nFixed ' + fixed + ' misplaced .lean() call' + (fixed === 1 ? '' : 's'));
}

if (require.main === module) {
  main();
}

module.exports = { buildPattern: buildPattern, fixFile: fixFile, walk: walk };
