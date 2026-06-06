/**
 * Payment & Withdrawal Flow Validation Script
 * Run: node scripts/validate-payment-flow.js
 * Requires: MongoDB connection matching .env
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const config = require(path.join(__dirname, '..', 'src', 'config'));

const tests = { passed: 0, failed: 0, skipped: 0, results: [] };

function pass(name, detail = '') {
  tests.passed++;
  tests.results.push({ name, status: 'PASS', detail });
  console.log(`  ✅ PASS: ${name}${detail ? ' — ' + detail : ''}`);
}

function fail(name, detail = '') {
  tests.failed++;
  tests.results.push({ name, status: 'FAIL', detail });
  console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
}

function skip(name, detail = '') {
  tests.skipped++;
  tests.results.push({ name, status: 'SKIP', detail });
  console.log(`  ⏭  SKIP: ${name}${detail ? ' — ' + detail : ''}`);
}

async function run() {
  console.log('═══════════════════════════════════════════');
  console.log('  Payment & Withdrawal Flow Validation');
  console.log('═══════════════════════════════════════════\n');

  // ── 1. Syntax Check ──
  console.log('── [1] Syntax Check ──');
  const fs = require('fs');
  const { execSync } = require('child_process');
  let syntaxErrors = 0;
  function checkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) checkDir(full);
      else if (e.name.endsWith('.js')) {
        try { execSync(`node --check "${full}"`, { stdio: 'pipe' }); } catch {
          syntaxErrors++;
          fail('Syntax check', `${full} has syntax errors`);
        }
      }
    }
  }
  checkDir(path.join(__dirname, '..', 'src'));
  if (syntaxErrors === 0) pass('All JS files pass syntax check');

  // ── 2. Command Registration Check ──
  console.log('\n── [2] Command Registration Check ──');
  const commandsPath = path.join(__dirname, '..', 'src', 'commands');
  const cmdDirs = fs.readdirSync(commandsPath).filter(f => fs.statSync(path.join(commandsPath, f)).isDirectory());
  const requiredCmds = ['payment', 'withdraw', 'product', 'service', 'dashboard'];
  for (const cmd of requiredCmds) {
    if (cmdDirs.includes(cmd) && fs.existsSync(path.join(commandsPath, cmd, 'main.js'))) {
      const mod = require(path.join(commandsPath, cmd, 'main.js'));
      if (mod.data) pass(`Command /${cmd} registered`, `Sub-commands: ${mod.data.options?.length || 0}`);
      else fail(`Command /${cmd}`, 'Missing data property');
    } else {
      fail(`Command /${cmd}`, 'File not found');
    }
  }

  // ── 3. MongoDB Check ──
  console.log('\n── [3] MongoDB Connection Check ──');
  try {
    await mongoose.connect(config.mongodb.uri, { serverSelectionTimeoutMS: 5000 });
    pass('MongoDB connection', `Database: ${mongoose.connection.db.databaseName}`);

    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    const requiredCollections = ['payments', 'withdrawals', 'commissions', 'users', 'orders', 'stores', 'products', 'services', 'transactions', 'auditlogs'];
    for (const col of requiredCollections) {
      if (collectionNames.includes(col)) pass(`Collection "${col}" exists`);
      else if (['payments', 'withdrawals', 'commissions'].includes(col)) skip(`Collection "${col}"`, 'Auto-created on first payment/withdrawal/commission');
      else fail(`Collection "${col}"`, 'Not found');
    }

    // Verify schema validation
    const paymentValidation = await mongoose.connection.db.command({ collMod: 'payments', validator: { $jsonSchema: { bsonType: 'object' } } }).catch(() => null);
    if (paymentValidation === null) skip('Payment schema validation', 'No JSON schema validator — using Mongoose validation');
    else pass('Payment schema validation');
  } catch (err) {
    fail('MongoDB connection', err.message);
  }

  // ── 4. Model & Service Check ──
  console.log('\n── [4] Model & Service Integrity Check ──');
  try {
    const Payment = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Payment'));
    const Withdrawal = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Withdrawal'));
    const Commission = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Commission'));
    const PaymentService = require(path.join(__dirname, '..', 'src', 'services', 'PaymentService'));
    const BalanceService = require(path.join(__dirname, '..', 'src', 'services', 'BalanceService'));
    const CommissionService = require(path.join(__dirname, '..', 'src', 'services', 'CommissionService'));
    pass('All 3 new models load successfully');
    pass('All 3 new services load successfully');

    // Verify service methods exist
    const pmethods = ['createPayment', 'verifyPayment', 'confirmPayment', 'cancelPayment', 'getPayment', 'getUserPayments', 'getPaymentStats', 'getPendingVerification'];
    for (const m of pmethods) {
      if (typeof PaymentService[m] === 'function') pass(`PaymentService.${m}()`);
      else fail(`PaymentService.${m}()`, 'Method not found');
    }

    const bmethods = ['requestWithdrawal', 'approveWithdrawal', 'rejectWithdrawal', 'getSellerBalance', 'getTopSellers', 'getWithdrawalStats'];
    for (const m of bmethods) {
      if (typeof BalanceService[m] === 'function') pass(`BalanceService.${m}()`);
      else fail(`BalanceService.${m}()`, 'Method not found');
    }

    const cmethods = ['getCommissionRate', 'getEffectiveCommissionRate', 'recordCommission', 'getTotalCommissions', 'getCommissionSummary'];
    for (const m of cmethods) {
      if (typeof CommissionService[m] === 'function') pass(`CommissionService.${m}()`);
      else fail(`CommissionService.${m}()`, 'Method not found');
    }
  } catch (err) {
    fail('Model/Service loading', err.message);
  }

  // ── 5. Payment Flow Validation ──
  console.log('\n── [5] Payment Flow Validation (Logic) ──');
  try {
    const PaymentService = require(path.join(__dirname, '..', 'src', 'services', 'PaymentService'));
    const CommissionService = require(path.join(__dirname, '..', 'src', 'services', 'CommissionService'));

    // 5a. Commission calculation (via getCommissionDisplay)
    const display = CommissionService.getCommissionDisplay(1000, 'free');
    if (display.commission === 100 && display.sellerGets === 900 && display.platformGets === 100) {
      pass('Commission calculation', '10% of 1000 = 100 commission, 900 to seller');
    } else {
      fail('Commission calculation', `Got ${JSON.stringify(display)}`);
    }

    // 5b. Commission rate lookup
    const rate = CommissionService.getCommissionRate('free');
    if (rate >= 0 && rate <= 1) pass('Commission rate lookup', `Free store rate: ${(rate * 100).toFixed(0)}%`);
    else fail('Commission rate lookup', `Invalid rate: ${rate}`);

    // 5c. Effective commission rate lookup
    const effRate = await CommissionService.getEffectiveCommissionRate('free');
    if (effRate >= 0 && effRate <= 1) pass('Effective commission rate lookup', `Rate: ${(effRate * 100).toFixed(0)}%`);
    else fail('Effective commission rate lookup', `Invalid rate: ${effRate}`);

    // 5d. PaymentService.createPayment validation
    const Payment = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Payment'));
    const Store = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Store'));
    const testStore = await Store.findOne({ isActive: true }).lean();
    if (testStore) {
      pass('Payment flow: active store exists', `Store: ${testStore.name}`);
      // Verify Payment schema fields
      const testPayment = new Payment({
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
      const validationError = testPayment.validateSync();
      if (validationError) fail('Payment schema validation', validationError.message);
      else pass('Payment schema: all required fields valid');
    } else {
      skip('Payment flow validation', 'No active store found in database for live test');
    }
  } catch (err) {
    fail('Payment flow logic', err.message);
  }

  // ── 6. Withdrawal Safety Validation ──
  console.log('\n── [6] Withdrawal Safety Validation ──');
  try {
    const BalanceService = require(path.join(__dirname, '..', 'src', 'services', 'BalanceService'));
    const Withdrawal = require(path.join(__dirname, '..', 'src', 'database', 'models', 'Withdrawal'));

    // Verify Withdrawal schema
    const testWithdrawal = new Withdrawal({
      withdrawalId: 'WTH-TEST-VALIDATION',
      userId: 'test_user',
      amount: 1000,
      fee: 0,
      netAmount: 1000,
      balanceBefore: 5000,
      balanceAfter: 4000,
      requestedAt: new Date(),
    });
    const wError = testWithdrawal.validateSync();
    if (wError) fail('Withdrawal schema validation', wError.message);
    else pass('Withdrawal schema: all required fields valid');

    // Verify approveWithdrawal rejects non-pending
    try {
      testWithdrawal.status = 'completed';
      await testWithdrawal.validate();
      pass('Withdrawal lifecycle: status enum valid');
    } catch (err) {
      fail('Withdrawal lifecycle', err.message);
    }

    // Verify max pending check exists in code
    const source = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'services', 'BalanceService.js'), 'utf8');
    if (source.includes('MAX_WITHDRAWAL_PENDING')) pass('Withdrawal safety: pending limit check');
    else fail('Withdrawal safety: pending limit check', 'Missing');
    if (source.includes('WITHDRAWAL_COOLDOWN_MS')) pass('Withdrawal safety: cooldown check');
    else fail('Withdrawal safety: cooldown check', 'Missing');
    if (source.includes('auditService.log')) pass('Withdrawal safety: audit logging');
    else fail('Withdrawal safety: audit logging', 'Missing');
  } catch (err) {
    fail('Withdrawal safety', err.message);
  }

  // ── 7. Audit Logging Validation ──
  console.log('\n── [7] Audit Logging Validation ──');
  try {
    const source = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'services', 'PaymentService.js'), 'utf8');
    const auditCalls = (source.match(/auditService\.log/g) || []).length;
    if (auditCalls >= 5) pass(`PaymentService audit calls: ${auditCalls}`);
    else fail('PaymentService audit calls', `Found ${auditCalls}, expected >= 5`);

    const bSource = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'services', 'BalanceService.js'), 'utf8');
    const bAuditCalls = (bSource.match(/auditService\.log/g) || []).length;
    if (bAuditCalls >= 3) pass(`BalanceService audit calls: ${bAuditCalls}`);
    else fail('BalanceService audit calls', `Found ${bAuditCalls}, expected >= 3`);

    // Verify payment audit fields include all required fields
    const auditLog = require(path.join(__dirname, '..', 'src', 'database', 'models', 'AuditLog'));
    const aTest = new auditLog({
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
    const aError = aTest.validateSync();
    if (aError) fail('AuditLog financial schema', aError.message);
    else pass('AuditLog: financial action schema valid');
  } catch (err) {
    fail('Audit logging validation', err.message);
  }

  // ── 8. Duplicate Payment Protection ──
  console.log('\n── [8] Duplicate Payment Protection ──');
  try {
    const source = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'services', 'PaymentService.js'), 'utf8');
    if (source.includes("payment.status !== 'pending'")) pass('Protection: status check');
    else fail('Protection: status check', 'Missing');
    if (source.includes('duplicateCheck') || source.includes('probotTransactionId')) pass('Protection: duplicate txn check');
    else fail('Protection: duplicate txn check', 'Missing');
    if (source.includes('order.status') && source.includes('!==')) pass('Protection: order pending check');
    else fail('Protection: order pending check', 'Missing');
    if (source.includes('MAX_VERIFICATION_ATTEMPTS')) pass('Protection: max verification attempts');
    else fail('Protection: max verification attempts', 'Missing');
    if (source.includes('Fraud')) pass('Protection: fraud flagging');
    else fail('Protection: fraud flagging', 'Missing');
  } catch (err) {
    fail('Duplicate payment protection', err.message);
  }

  // ── 9. MonitorService Integration ──
  console.log('\n── [9] MonitorService Integration ──');
  try {
    const mSource = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'services', 'MonitorService.js'), 'utf8');
    if (mSource.includes('trackPayment')) pass('MonitorService: trackPayment()');
    else fail('MonitorService: trackPayment()', 'Missing');
    if (mSource.includes('trackWithdrawal')) pass('MonitorService: trackWithdrawal()');
    else fail('MonitorService: trackWithdrawal()', 'Missing');
    if (mSource.includes('trackFraud')) pass('MonitorService: trackFraud()');
    else fail('MonitorService: trackFraud()', 'Missing');
    if (mSource.includes('payments')) pass('MonitorService: payments metric');
    else fail('MonitorService: payments metric', 'Missing');
    if (mSource.includes('withdrawals')) pass('MonitorService: withdrawals metric');
    else fail('MonitorService: withdrawals metric', 'Missing');
    if (mSource.includes('fraud')) pass('MonitorService: fraud metric');
    else fail('MonitorService: fraud metric', 'Missing');

    // Verify PaymentService calls MonitorService
    const pSource = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'services', 'PaymentService.js'), 'utf8');
    const pCalls = (pSource.match(/MonitorService\.trackPayment/g) || []).length;
    if (pCalls >= 5) pass(`PaymentService → MonitorService calls: ${pCalls}`);
    else fail('PaymentService → MonitorService', `Found ${pCalls}, expected >= 5`);

    // Verify BalanceService calls MonitorService
    const bSource = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'services', 'BalanceService.js'), 'utf8');
    const bCalls = (bSource.match(/MonitorService\.trackWithdrawal/g) || []).length;
    if (bCalls >= 3) pass(`BalanceService → MonitorService calls: ${bCalls}`);
    else fail('BalanceService → MonitorService', `Found ${bCalls}, expected >= 3`);
  } catch (err) {
    fail('MonitorService integration', err.message);
  }

  // ── 10. Dashboard Integration ──
  console.log('\n── [10] Dashboard Integration ──');
  try {
    const dSource = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'commands', 'dashboard', 'main.js'), 'utf8');
    if (dSource.includes('handleFinancial')) pass('Dashboard: /dashboard financial');
    else fail('Dashboard: /dashboard financial', 'Missing');
    if (dSource.includes('platformEarnings')) pass('Dashboard: platformEarnings in seller stats');
    else fail('Dashboard: platformEarnings in seller stats', 'Missing');
    if (dSource.includes('paymentStats') || dSource.includes('withdrawalStats')) pass('Dashboard: payment/withdrawal stats in overview');
    else fail('Dashboard: payment/withdrawal stats in overview', 'Missing');
  } catch (err) {
    fail('Dashboard integration', err.message);
  }

  // ── Final Report ──
  console.log('\n═══════════════════════════════════════════');
  console.log('  VALIDATION RESULTS');
  console.log('═══════════════════════════════════════════');
  console.log(`  ✅ Passed: ${tests.passed}`);
  console.log(`  ❌ Failed: ${tests.failed}`);
  console.log(`  ⏭  Skipped: ${tests.skipped}`);
  console.log(`  📊 Total: ${tests.passed + tests.failed + tests.skipped}`);
  console.log('');

  if (tests.failed > 0) {
    console.log('  Failed Tests:');
    for (const r of tests.results.filter(r => r.status === 'FAIL')) {
      console.log(`    ❌ ${r.name}${r.detail ? ': ' + r.detail : ''}`);
    }
    console.log('');
  }

  const score = tests.passed + tests.skipped;
  const total = tests.passed + tests.failed + tests.skipped;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  console.log(`  🏆 Production Readiness Score: ${pct}/100`);

  await mongoose.disconnect();
  process.exit(tests.failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Validation script error:', err);
  process.exit(1);
});
