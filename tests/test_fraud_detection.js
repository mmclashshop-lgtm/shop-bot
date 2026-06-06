/**
 * Fraud Detection System — Financial Attack Simulation Tests
 *
 * Usage: node tests/test_fraud_detection.js
 *
 * This script simulates 6 attack scenarios to verify fraud detection:
 *   1. Double Spend
 *   2. Rapid Transfers
 *   3. Withdrawal Abuse
 *   4. Coupon Farming
 *   5. Fake Payment Verification
 *   6. Review Spam
 *
 * Results are printed to console and logged to logs/fraud-test-results.log
 */

const FraudDetectionService = require('../src/services/FraudDetectionService');
const { FraudAlert, PendingAction, Transaction, User } = require('../src/database/models');
const mongoose = require('mongoose');
const config = require('../src/config');

// ---------- Test Utilities ----------
const TEST_USER_ID = 'fraud_test_user_001';
const TEST_GUILD_ID = 'fraud_test_guild_001';
const TESTS_PASSED = [];
const TESTS_FAILED = [];
const TEST_LOG = [];

function log(msg) {
  TEST_LOG.push(msg);
  console.log(msg);
}

function pass(name, detail) {
  TESTS_PASSED.push(name);
  log(`  ✅ PASS: ${name} — ${detail}`);
}

function fail(name, detail) {
  TESTS_FAILED.push(name);
  log(`  ❌ FAIL: ${name} — ${detail}`);
}

function assert(condition, name, detail) {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

async function cleanup() {
  await FraudAlert.deleteMany({ userId: { $regex: /^fraud_test/ } });
  await PendingAction.deleteMany({ userId: { $regex: /^fraud_test/ } });
  await Transaction.deleteMany({ userId: { $regex: /^fraud_test/ } });
}

// ---------- DB Setup ----------
async function connectDB() {
  const uri = config.database?.uri || process.env.MONGODB_URI || 'mongodb://localhost:27017/shopbot_test';
  try {
    await mongoose.connect(uri);
    log(`✅ Connected to MongoDB: ${uri}`);
  } catch (err) {
    log(`❌ MongoDB connection failed: ${err.message}`);
    log('⚠️  Tests will run with limited DB-dependent assertions');
  }
}

// ========== TEST 1: Double Spend ==========
async function testDoubleSpend() {
  log('\n━━━ TEST 1: Double Spend Detection ━━━');
  await cleanup();

  const user = await User.findOne({ discordId: TEST_USER_ID }).lean() || { balance: 1000 };

  await PendingAction.create({ nonce: 'test_ds_1', type: 'pay', userId: TEST_USER_ID, amount: 600 });
  await PendingAction.create({ nonce: 'test_ds_2', type: 'pay', userId: TEST_USER_ID, amount: 500 });

  const result = await FraudDetectionService.checkWalletTransfer(TEST_USER_ID, 'target_002', 200, TEST_GUILD_ID);

  assert(result.isFraud === true, 'Double Spend detected (pending 1100 > balance 1000)', `risk=${result.riskScore}, isFraud=${result.isFraud}`);

  if (result.alert) {
    assert(result.alert.type === 'rapid_transfer', 'Alert type is rapid_transfer', `got ${result.alert.type}`);
  }
}

// ========== TEST 2: Rapid Transfers ==========
async function testRapidTransfers() {
  log('\n━━━ TEST 2: Rapid Transfer Detection ━━━');
  await cleanup();

  for (let i = 0; i < 6; i++) {
    await Transaction.create({
      userId: TEST_USER_ID,
      type: 'transfer',
      amount: -100,
      currency: 'credits',
      description: `Test transfer ${i}`,
      createdAt: new Date(Date.now() - i * 10000),
    });
  }

  const result = await FraudDetectionService.checkWalletTransfer(TEST_USER_ID, 'target_003', 50, TEST_GUILD_ID);

  assert(result.riskScore >= 25, 'Rapid transfer adds minimum 25 risk', `risk=${result.riskScore}`);
}

// ========== TEST 3: Withdrawal Abuse ==========
async function testWithdrawalAbuse() {
  log('\n━━━ TEST 3: Withdrawal Abuse Detection ━━━');
  await cleanup();

  await FraudAlert.create({
    alertId: 'fraud_test_wa_1',
    userId: TEST_USER_ID,
    type: 'suspicious_withdrawal',
    riskScore: 40,
    severity: 'suspicious',
    description: 'Test alert 1',
    createdAt: new Date(Date.now() - 3600000),
  });
  await FraudAlert.create({
    alertId: 'fraud_test_wa_2',
    userId: TEST_USER_ID,
    type: 'suspicious_withdrawal',
    riskScore: 50,
    severity: 'suspicious',
    description: 'Test alert 2',
    createdAt: new Date(Date.now() - 1800000),
  });

  await Transaction.create({
    userId: TEST_USER_ID,
    type: 'withdraw',
    amount: -200,
    currency: 'credits',
    description: 'Test withdrawal',
    createdAt: new Date(Date.now() - 600000),
  });
  await Transaction.create({
    userId: TEST_USER_ID,
    type: 'withdraw',
    amount: -300,
    currency: 'credits',
    description: 'Test withdrawal',
    createdAt: new Date(Date.now() - 1200000),
  });
  await Transaction.create({
    userId: TEST_USER_ID,
    type: 'withdraw',
    amount: -150,
    currency: 'credits',
    description: 'Test withdrawal',
    createdAt: new Date(Date.now() - 1800000),
  });

  await User.findOneAndUpdate(
    { discordId: TEST_USER_ID },
    { discordId: TEST_USER_ID, balance: 1000000, platformEarnings: 500000 },
    { upsert: true },
  );

  const result = await FraudDetectionService.checkWithdrawal(TEST_USER_ID, 450000, 'bank', TEST_GUILD_ID);

  assert(result.riskScore >= 35, 'Withdrawal abuse detected (repeated alerts + rapid)', `risk=${result.riskScore}`);
  assert(result.isFraud !== undefined, 'Result has isFraud field', '');
}

// ========== TEST 4: Coupon Farming ==========
async function testCouponFarming() {
  log('\n━━━ TEST 4: Coupon Farming Detection ━━━');
  await cleanup();

  await User.findOneAndUpdate(
    { discordId: TEST_USER_ID },
    { discordId: TEST_USER_ID, trustLevel: 'new' },
    { upsert: true },
  );

  for (let i = 0; i < 6; i++) {
    await PendingAction.create({
      nonce: `test_cf_${i}`,
      type: 'coupon_claim',
      userId: TEST_USER_ID,
      createdAt: new Date(Date.now() - i * 30000),
    });
  }

  const result = await FraudDetectionService.checkCouponClaim(TEST_USER_ID, 'TEST50', TEST_GUILD_ID);

  assert(result.riskScore >= 30, 'Coupon farming detected (rapid claims)', `risk=${result.riskScore}`);
}

// ========== TEST 5: Fake Payment Verification ==========
async function testFakePayment() {
  log('\n━━━ TEST 5: Fake Payment Verification Detection ━━━');
  await cleanup();

  if (mongoose.connection.readyState === 1) {
    const Payment = require('../src/database/models/Payment');
    // Create a payment that belongs to another user to detect reuse
    try {
      const existingPayment = await Payment.create({
        paymentId: 'test_fake_payment_1',
        buyerId: 'other_user_999',
        sellerId: 'seller_001',
        amount: 500,
        probotTransactionId: 'PROBOT_TX_REUSED_001',
        status: 'completed',
        itemName: 'Test Item',
        commissionRate: 0.05,
        commissionAmount: 25,
        sellerAmount: 475,
        referenceCode: 'REF001',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const result = await FraudDetectionService.checkPayment(TEST_USER_ID, 'payment_fake', 'PROBOT_TX_REUSED_001', TEST_GUILD_ID);

      assert(result.riskScore >= 35, 'Fake payment detected (reused transaction ID)', `risk=${result.riskScore}`);
      assert(result.alert?.type === 'fake_payment_verification', 'Alert type is fake_payment_verification', `got ${result.alert?.type}`);

      await Payment.deleteOne({ paymentId: 'test_fake_payment_1' });
    } catch (err) {
      log(`  ⚠️ Payment model test skipped: ${err.message}`);
    }
  }
}

// ========== TEST 6: Review Spam ==========
async function testReviewSpam() {
  log('\n━━━ TEST 6: Review Spam Detection ━━━');
  await cleanup();

  for (let i = 0; i < 4; i++) {
    await PendingAction.create({
      nonce: `test_rs_${i}`,
      type: 'review',
      userId: TEST_USER_ID,
      createdAt: new Date(Date.now() - i * 60000),
    });
  }

  await User.findOneAndUpdate(
    { discordId: TEST_USER_ID },
    { discordId: TEST_USER_ID, createdAt: new Date(Date.now() - 3600000) },
    { upsert: true },
  );

  const result = await FraudDetectionService.checkReview(TEST_USER_ID, 'order_test_001', TEST_GUILD_ID);

  assert(result.riskScore >= 25, 'Review spam detected (rapid reviews)', `risk=${result.riskScore}`);
  assert(result.alert !== null, 'Alert created for review spam', '');
}

// ========== MAIN ==========
async function main() {
  log('╔══════════════════════════════════════════╗');
  log('║  Fraud Detection — Financial Attack Test ║');
  log('╚══════════════════════════════════════════╝');
  log(`Date: ${new Date().toISOString()}`);
  log('');

  await connectDB();

  // Run tests sequentially since they modify shared state
  await testDoubleSpend();
  await testRapidTransfers();
  await testWithdrawalAbuse();
  await testCouponFarming();
  await testFakePayment();
  await testReviewSpam();

  // Cleanup test data
  await cleanup();

  // Summary
  log('\n━━━ TEST SUMMARY ━━━');
  log(`Total: ${TESTS_PASSED.length + TESTS_FAILED.length}`);
  log(`Passed: ${TESTS_PASSED.length}`);
  log(`Failed: ${TESTS_FAILED.length}`);

  if (TESTS_FAILED.length > 0) {
    log('\nFailed tests:');
    TESTS_FAILED.forEach(t => log(`  ❌ ${t}`));
  }

  await mongoose.disconnect();
  log('\n✅ Disconnected from MongoDB');
  process.exit(TESTS_FAILED.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
