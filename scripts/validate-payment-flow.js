/**
 * Payment and Withdrawal Flow Validation Script
 * Run: node scripts/validate-payment-flow.js
 * Requires: MongoDB connection matching .env
 *
 * Validates syntax, command registration, MongoDB collections,
 * model/service integrity, payment/withdrawal logic, audit logging,
 * duplicate protection, MonitorService integration, and dashboard.
 */
require('dotenv').config();
var mongoose = require('mongoose');
var path = require('path');
var fs = require('fs');
var vm = require('vm');

var tests = { passed: 0, failed: 0, skipped: 0, results: [] };

function pass(name, detail) {
  detail = detail || '';
  tests.passed++;
  tests.results.push({ name: name, status: 'PASS', detail: detail });
  console.log('  [PASS] ' + name + (detail ? ' - ' + detail : ''));
}

function fail(name, detail) {
  detail = detail || '';
  tests.failed++;
  tests.results.push({ name: name, status: 'FAIL', detail: detail });
  console.log('  [FAIL] ' + name + (detail ? ' - ' + detail : ''));
}

function skip(name, detail) {
  detail = detail || '';
  tests.skipped++;
  tests.results.push({ name: name, status: 'SKIP', detail: detail });
  console.log('  [SKIP] ' + name + (detail ? ' - ' + detail : ''));
}

function checkSyntax(filePath) {
  var code;
  try {
    code = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  // Strip shebang before parsing
  var sanitized = code.replace(/^#!.*\n/, '');
  try {
    new vm.Script(sanitized);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function run() {
  console.log('===========================================');
  console.log('  Payment and Withdrawal Flow Validation');
  console.log('===========================================\n');

  // Load config inside try-catch so missing .env doesn't crash
  var config;
  try {
    config = require(path.join(__dirname, '..', 'src', 'config'));
  } catch (err) {
    console.log('  [FAIL] Config load - ' + err.message + '\n');
    tests.failed++;
    printSummary();
    process.exit(1);
  }

  // -- 1. Syntax Check --
  console.log('-- [1] Syntax Check --');
  var syntaxErrors = 0;
  var syntaxErrorFiles = [];
  function checkDir(dir) {
    var entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      fail('Syntax check', 'Cannot read directory ' + dir + ': ' + err.message);
      return;
    }
    for (var e = 0; e < entries.length; e++) {
      var entry = entries[e];
      var full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDir(full);
      } else if (entry.name.endsWith('.js')) {
        var result = checkSyntax(full);
        if (!result.ok) {
          syntaxErrors++;
          syntaxErrorFiles.push(full + ': ' + result.error);
          fail('Syntax check', full + ' - ' + result.error);
        }
      }
    }
  }
  checkDir(path.join(__dirname, '..', 'src'));
  if (syntaxErrors === 0) pass('All JS files pass syntax check');

  // -- 2. Command Registration Check --
  console.log('\n-- [2] Command Registration Check --');
  var commandsPath = path.join(__dirname, '..', 'src', 'commands');
  var cmdDirs = [];
  try {
    cmdDirs = fs.readdirSync(commandsPath).filter(function (f) {
      return fs.statSync(path.join(commandsPath, f)).isDirectory();
    });
  } catch (err) {
    fail('Command directory', 'Cannot read ' + commandsPath + ': ' + err.message);
  }
  var requiredCmds = ['payment', 'withdraw', 'product', 'service', 'dashboard'];
  for (var c = 0; c < requiredCmds.length; c++) {
    var cmd = requiredCmds[c];
    if (cmdDirs.indexOf(cmd) !== -1 && fs.existsSync(path.join(commandsPath, cmd, 'main.js'))) {
      var mod;
      try {
        mod = require(path.join(commandsPath, cmd, 'main.js'));
      } catch (err) {
        fail('Command /' + cmd, 'Load error: ' + err.message);
        continue;
      }
      if (mod.data) {
        pass('Command /' + cmd + ' registered', 'Sub-commands: ' + (mod.data.options ? mod.data.options.length : 0));
      } else {
        fail('Command /' + cmd, 'Missing data property');
      }
    } else {
      fail('Command /' + cmd, 'File not found');
    }
  }

  // -- 3. MongoDB Check --
  console.log('\n-- [3] MongoDB Connection Check --');
  var mongoConnected = false;
  try {
    await mongoose.connect(config.mongodb.uri, { serverSelectionTimeoutMS: 5000 });
    mongoConnected = true;
    pass('MongoDB connection', 'Database: ' + mongoose.connection.db.databaseName);

    var collections = await mongoose.connection.db.listCollections().toArray();
    var collectionNames = collections.map(function (col) { return col.name; });
    var requiredCollections = ['payments', 'withdrawals', 'commissions', 'users', 'orders', 'stores', 'products', 'services', 'transactions', 'auditlogs'];
    for (var colIdx = 0; colIdx < requiredCollections.length; colIdx++) {
      var col = requiredCollections[colIdx];
      if (collectionNames.indexOf(col) !== -1) {
        pass('Collection "' + col + '" exists');
      } else if (['payments', 'withdrawals', 'commissions'].indexOf(col) !== -1) {
        skip('Collection "' + col + '"', 'Auto-created on first use');
      } else {
        fail('Collection "' + col + '"', 'Not found');
      }
    }

    // Read-only check: list collections with filter instead of collMod
    var paymentInfo = null;
    try {
      paymentInfo = await mongoose.connection.db.command({
        listCollections: 1,
        filter: { name: 'payments' },
        nameOnly: false,
      });
    } catch (_) { /* collection may not exist */ }
    if (paymentInfo && paymentInfo.cursor && paymentInfo.cursor.firstBatch) {
      pass('Payment collection info', 'Collection exists and is readable');
    } else {
      skip('Payment collection info', 'Collection not yet created');
    }
  } catch (err) {
    fail('MongoDB connection', err.message);
  }

  // -- 4. Model and Service Check --
  console.log('\n-- [4] Model and Service Integrity Check --');
  try {
    var Payment = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Payment'));
    var Withdrawal = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Withdrawal'));
    var Commission = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Commission'));
    var PaymentService = require(path.join(__dirname, '..', 'src', 'services', 'PaymentService'));
    var BalanceService = require(path.join(__dirname, '..', 'src', 'services', 'BalanceService'));
    var CommissionService = require(path.join(__dirname, '..', 'src', 'services', 'CommissionService'));
    pass('All 3 new models load successfully');
    pass('All 3 new services load successfully');

    var pmethods = ['createPayment', 'verifyPayment', 'confirmPayment', 'cancelPayment', 'getPayment', 'getUserPayments', 'getPaymentStats', 'getPendingVerification'];
    for (var pm = 0; pm < pmethods.length; pm++) {
      var mName = pmethods[pm];
      if (typeof PaymentService[mName] === 'function') {
        pass('PaymentService.' + mName + '()');
      } else {
        fail('PaymentService.' + mName + '()', 'Method not found');
      }
    }

    var bmethods = ['requestWithdrawal', 'approveWithdrawal', 'rejectWithdrawal', 'getSellerBalance', 'getTopSellers', 'getWithdrawalStats'];
    for (var bm = 0; bm < bmethods.length; bm++) {
      var bName = bmethods[bm];
      if (typeof BalanceService[bName] === 'function') {
        pass('BalanceService.' + bName + '()');
      } else {
        fail('BalanceService.' + bName + '()', 'Method not found');
      }
    }

    var cmethods = ['getCommissionRate', 'getEffectiveCommissionRate', 'recordCommission', 'getTotalCommissions', 'getCommissionSummary'];
    for (var cm = 0; cm < cmethods.length; cm++) {
      var cName = cmethods[cm];
      if (typeof CommissionService[cName] === 'function') {
        pass('CommissionService.' + cName + '()');
      } else {
        fail('CommissionService.' + cName + '()', 'Method not found');
      }
    }
  } catch (err) {
    fail('Model/Service loading', err.message);
  }

  // -- 5. Payment Flow Validation --
  console.log('\n-- [5] Payment Flow Validation (Logic) --');
  try {
    var PaymentService2 = require(path.join(__dirname, '..', 'src', 'services', 'PaymentService'));
    var CommissionService2 = require(path.join(__dirname, '..', 'src', 'services', 'CommissionService'));

    var display = CommissionService2.getCommissionDisplay(1000, 'free');
    if (display.commission === 100 && display.sellerGets === 900 && display.platformGets === 100) {
      pass('Commission calculation', '10% of 1000 = 100 commission, 900 to seller');
    } else {
      fail('Commission calculation', 'Got ' + JSON.stringify(display));
    }

    var rate = CommissionService2.getCommissionRate('free');
    if (rate >= 0 && rate <= 1) {
      pass('Commission rate lookup', 'Free store rate: ' + (rate * 100).toFixed(0) + '%');
    } else {
      fail('Commission rate lookup', 'Invalid rate: ' + rate);
    }

    if (mongoConnected) {
      var effRate = await CommissionService2.getEffectiveCommissionRate('free');
      if (effRate >= 0 && effRate <= 1) {
        pass('Effective commission rate lookup', 'Rate: ' + (effRate * 100).toFixed(0) + '%');
      } else {
        fail('Effective commission rate lookup', 'Invalid rate: ' + effRate);
      }
    } else {
      skip('Effective commission rate lookup', 'Skipped (no database connection)');
    }

    var Payment2 = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Payment'));
    var Store = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Store'));
    var testStore = null;
    if (mongoConnected) {
      try {
        testStore = await Store.findOne({ isActive: true }).lean();
      } catch (_) { /* ignore */ }
    }
    if (testStore) {
      pass('Payment flow: active store exists', 'Store: ' + testStore.name);
      var testPayment = new Payment2({
        paymentId: 'PAY-TEST-VALIDATION',
        buyerId: 'test_buyer',
        sellerId: testStore.ownerId,
        storeId: testStore._id,
        itemType: 'product',
        itemName: 'Test Product',
        amount: 100,
        commissionRate: 0.10,
        commissionAmount: 10,
        sellerAmount: 90,
        platformAmount: 10,
        referenceCode: 'TESTCODE',
        expiresAt: new Date(Date.now() + 3600000),
      });
      var validationError = testPayment.validateSync();
      if (validationError) {
        fail('Payment schema validation', validationError.message);
      } else {
        pass('Payment schema: all required fields valid');
      }
    } else {
      skip('Payment flow validation', 'No active store found for live test');
    }
  } catch (err) {
    fail('Payment flow logic', err.message);
  }

  // -- 6. Withdrawal Safety Validation --
  console.log('\n-- [6] Withdrawal Safety Validation --');
  try {
    var BalanceService2 = require(path.join(__dirname, '..', 'src', 'services', 'BalanceService'));
    var Withdrawal2 = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Withdrawal'));

    var testWithdrawal = new Withdrawal2({
      withdrawalId: 'WTH-TEST-VALIDATION',
      userId: 'test_user',
      amount: 1000,
      fee: 0,
      netAmount: 1000,
      balanceBefore: 5000,
      balanceAfter: 4000,
      requestedAt: new Date(),
    });
    var wError = testWithdrawal.validateSync();
    if (wError) {
      fail('Withdrawal schema validation', wError.message);
    } else {
      pass('Withdrawal schema: all required fields valid');
    }

    testWithdrawal.status = 'completed';
    var wLifecycleError = testWithdrawal.validateSync();
    if (wLifecycleError) {
      fail('Withdrawal lifecycle', wLifecycleError.message);
    } else {
      pass('Withdrawal lifecycle: status enum valid');
    }

    var bSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'BalanceService.js'), 'utf8');
    if (bSource.indexOf('MAX_WITHDRAWAL_PENDING') !== -1) {
      pass('Withdrawal safety: pending limit check');
    } else {
      fail('Withdrawal safety: pending limit check', 'Missing');
    }
    if (bSource.indexOf('WITHDRAWAL_COOLDOWN_MS') !== -1) {
      pass('Withdrawal safety: cooldown check');
    } else {
      fail('Withdrawal safety: cooldown check', 'Missing');
    }
    if (bSource.indexOf('auditService.log') !== -1) {
      pass('Withdrawal safety: audit logging');
    } else {
      fail('Withdrawal safety: audit logging', 'Missing');
    }
  } catch (err) {
    fail('Withdrawal safety', err.message);
  }

  // -- 7. Audit Logging Validation --
  console.log('\n-- [7] Audit Logging Validation --');
  try {
    var pSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'PaymentService.js'), 'utf8');
    var auditCalls = (pSource.match(/auditService\.log/g) || []).length;
    if (auditCalls >= 5) {
      pass('PaymentService audit calls: ' + auditCalls);
    } else {
      fail('PaymentService audit calls', 'Found ' + auditCalls + ', expected >= 5');
    }

    var bSource2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'BalanceService.js'), 'utf8');
    var bAuditCalls = (bSource2.match(/auditService\.log/g) || []).length;
    if (bAuditCalls >= 3) {
      pass('BalanceService audit calls: ' + bAuditCalls);
    } else {
      fail('BalanceService audit calls', 'Found ' + bAuditCalls + ', expected >= 3');
    }

    var auditLog = require(path.join(__dirname, '..', 'src', 'database', 'models', 'AuditLog'));
    var aTest = new auditLog({
      action: 'payment_created',
      userId: 'test',
      targetId: 'PAY-TEST',
      targetType: 'payment',
      details: {
        paymentId: 'PAY-TEST',
        buyerId: 'buyer',
        sellerId: 'seller',
        amount: 100,
        commission: 10,
        netAmount: 90,
        orderId: 'ORDER-TEST',
        probotTransactionId: 'TXN-TEST',
        timestamp: new Date(),
        status: 'pending',
        paymentMethod: 'probot_credits',
      },
    });
    var aError = aTest.validateSync();
    if (aError) {
      fail('AuditLog financial schema', aError.message);
    } else {
      pass('AuditLog: financial action schema valid');
    }
  } catch (err) {
    fail('Audit logging validation', err.message);
  }

  // -- 8. Duplicate Payment Protection --
  console.log('\n-- [8] Duplicate Payment Protection --');
  try {
    var pSource2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'PaymentService.js'), 'utf8');
    if (pSource2.indexOf("payment.status !== 'pending'") !== -1) {
      pass('Protection: status check');
    } else {
      fail('Protection: status check', 'Missing');
    }
    if (pSource2.indexOf('duplicateCheck') !== -1 || pSource2.indexOf('probotTransactionId') !== -1) {
      pass('Protection: duplicate txn check');
    } else {
      fail('Protection: duplicate txn check', 'Missing');
    }
    if (pSource2.indexOf('order.status') !== -1 && pSource2.indexOf('!==') !== -1) {
      pass('Protection: order pending check');
    } else {
      fail('Protection: order pending check', 'Missing');
    }
    if (pSource2.indexOf('MAX_VERIFICATION_ATTEMPTS') !== -1) {
      pass('Protection: max verification attempts');
    } else {
      fail('Protection: max verification attempts', 'Missing');
    }
    if (pSource2.indexOf('Fraud') !== -1) {
      pass('Protection: fraud flagging');
    } else {
      fail('Protection: fraud flagging', 'Missing');
    }
  } catch (err) {
    fail('Duplicate payment protection', err.message);
  }

  // -- 9. MonitorService Integration --
  console.log('\n-- [9] MonitorService Integration --');
  try {
    var mSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'MonitorService.js'), 'utf8');
    if (mSource.indexOf('trackPayment') !== -1) {
      pass('MonitorService: trackPayment()');
    } else {
      fail('MonitorService: trackPayment()', 'Missing');
    }
    if (mSource.indexOf('trackWithdrawal') !== -1) {
      pass('MonitorService: trackWithdrawal()');
    } else {
      fail('MonitorService: trackWithdrawal()', 'Missing');
    }
    if (mSource.indexOf('trackFraud') !== -1) {
      pass('MonitorService: trackFraud()');
    } else {
      fail('MonitorService: trackFraud()', 'Missing');
    }
    if (mSource.indexOf('payments') !== -1) {
      pass('MonitorService: payments metric');
    } else {
      fail('MonitorService: payments metric', 'Missing');
    }
    if (mSource.indexOf('withdrawals') !== -1) {
      pass('MonitorService: withdrawals metric');
    } else {
      fail('MonitorService: withdrawals metric', 'Missing');
    }
    if (mSource.indexOf('fraud') !== -1) {
      pass('MonitorService: fraud metric');
    } else {
      fail('MonitorService: fraud metric', 'Missing');
    }

    var pSource3 = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'PaymentService.js'), 'utf8');
    var pCalls = (pSource3.match(/MonitorService\.trackPayment/g) || []).length;
    if (pCalls >= 5) {
      pass('PaymentService -> MonitorService calls: ' + pCalls);
    } else {
      fail('PaymentService -> MonitorService', 'Found ' + pCalls + ', expected >= 5');
    }

    var bSource3 = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'BalanceService.js'), 'utf8');
    var bCalls = (bSource3.match(/MonitorService\.trackWithdrawal/g) || []).length;
    if (bCalls >= 3) {
      pass('BalanceService -> MonitorService calls: ' + bCalls);
    } else {
      fail('BalanceService -> MonitorService', 'Found ' + bCalls + ', expected >= 3');
    }
  } catch (err) {
    fail('MonitorService integration', err.message);
  }

  // -- 10. Dashboard Integration --
  console.log('\n-- [10] Dashboard Integration --');
  try {
    var dSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'dashboard', 'main.js'), 'utf8');
    if (dSource.indexOf('handleFinancial') !== -1) {
      pass('Dashboard: /dashboard financial');
    } else {
      fail('Dashboard: /dashboard financial', 'Missing');
    }
    if (dSource.indexOf('platformEarnings') !== -1) {
      pass('Dashboard: platformEarnings in seller stats');
    } else {
      fail('Dashboard: platformEarnings in seller stats', 'Missing');
    }
    if (dSource.indexOf('paymentStats') !== -1 || dSource.indexOf('withdrawalStats') !== -1) {
      pass('Dashboard: payment/withdrawal stats in overview');
    } else {
      fail('Dashboard: payment/withdrawal stats in overview', 'Missing');
    }
  } catch (err) {
    fail('Dashboard integration', err.message);
  }

  printSummary();
}

function printSummary() {
  console.log('\n===========================================');
  console.log('  VALIDATION RESULTS');
  console.log('===========================================');
  console.log('  [PASS] ' + tests.passed);
  console.log('  [FAIL] ' + tests.failed);
  console.log('  [SKIP] ' + tests.skipped);
  console.log('  Total: ' + (tests.passed + tests.failed + tests.skipped));
  console.log('');

  if (tests.failed > 0) {
    console.log('  Failed Tests:');
    for (var r = 0; r < tests.results.length; r++) {
      var result = tests.results[r];
      if (result.status === 'FAIL') {
        console.log('    [FAIL] ' + result.name + (result.detail ? ': ' + result.detail : ''));
      }
    }
    console.log('');
  }

  var attempted = tests.passed + tests.failed;
  var pct = attempted > 0 ? Math.round((tests.passed / attempted) * 100) : 0;
  console.log('  Production Readiness Score: ' + pct + '/100');

  if (tests.failed > 0) {
    console.log('');
    console.log('  Some checks failed. Review the FAIL entries above.');
  }

  if (typeof mongoose.connection !== 'undefined' && mongoose.connection.readyState !== 0) {
    try { mongoose.disconnect(); } catch (_) { /* ignore disconnect errors */ }
  }
  process.exit(tests.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  run().catch(function (err) {
    console.error('Validation script error:', err);
    process.exit(1);
  });
}

module.exports = { run: run, pass: pass, fail: fail, skip: skip, checkSyntax: checkSyntax };
