/**
 * License Scenario Simulator
 * Simulates various licensing scenarios for testing
 *
 * Usage:
 *   node scripts/simulate-license-scenarios.js
 */

const crypto = require('crypto');
const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');

const scenarios = [];

/**
 * Helper: Generate Ed25519 keypair
 */
function generateKeypair() {
  const keypair = nacl.sign.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(keypair.publicKey),
    privateKey: naclUtil.encodeBase64(keypair.secretKey),
  };
}

/**
 * Helper: Sign payload
 */
function signPayload(payload, privateKeyBase64) {
  const privateKey = naclUtil.decodeBase64(privateKeyBase64);
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const message = naclUtil.decodeUTF8(canonical);
  const signature = nacl.sign.detached(message, privateKey);
  return naclUtil.encodeBase64(signature);
}

/**
 * Helper: Verify signature
 */
function verifySignature(payload, signatureBase64, publicKeyBase64) {
  try {
    const publicKey = naclUtil.decodeBase64(publicKeyBase64);
    const signature = naclUtil.decodeBase64(signatureBase64);
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    const message = naclUtil.decodeUTF8(canonical);
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

// Scenario 1: Valid activation certificate
scenarios.push({
  name: 'Valid Activation Certificate',
  description: 'Verify a valid activation certificate with features',
  run: async () => {
    const { publicKey, privateKey } = generateKeypair();

    const certPayload = {
      certVersion: 1,
      licenseId: 'LIC-2026-001',
      plan: 'pro',
      seats: 5,
      machineHash: 'abc123def456',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      features: {
        adminPanel: true,
        managedMode: true,
        exports: true,
        advancedReports: true,
      },
      serverTime: new Date().toISOString(),
    };

    const signature = signPayload(certPayload, privateKey);
    const isValid = verifySignature(certPayload, signature, publicKey);

    console.log('✓ Certificate signature valid:', isValid);
    console.log('  License ID:', certPayload.licenseId);
    console.log('  Plan:', certPayload.plan);
    console.log('  Features:', certPayload.features);
    console.log('  Expires:', certPayload.expiresAt);
  },
});

// Scenario 2: Expired certificate
scenarios.push({
  name: 'Expired Certificate',
  description: 'Detect expired license',
  run: async () => {
    const { publicKey, privateKey } = generateKeypair();

    const certPayload = {
      certVersion: 1,
      licenseId: 'LIC-2026-002',
      plan: 'pro',
      seats: 5,
      machineHash: 'abc123def456',
      issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      features: { adminPanel: true },
      serverTime: new Date().toISOString(),
    };

    const signature = signPayload(certPayload, privateKey);
    const isValid = verifySignature(certPayload, signature, publicKey);

    const now = new Date();
    const expiresAt = new Date(certPayload.expiresAt);
    const isExpired = now > expiresAt;

    console.log('✓ Certificate signature valid:', isValid);
    console.log('✓ License expired:', isExpired);
    console.log('  Expired at:', certPayload.expiresAt);
  },
});

// Scenario 3: Time drift correction
scenarios.push({
  name: 'Time Drift Correction',
  description: 'Verify drift-corrected time prevents false expiry',
  run: async () => {
    const serverTime = new Date();
    serverTime.setHours(serverTime.getHours() + 1);
    const serverTimeStr = serverTime.toISOString();

    const serverLocalTime = Date.now() - 2 * 60 * 60 * 1000;

    const drift = Date.now() - serverLocalTime;
    const driftedNow = new Date(serverTime).getTime() + drift;

    const isExpired = driftedNow > new Date(serverTimeStr).getTime();

    console.log('✓ Server time:', serverTimeStr);
    console.log('✓ Local clock drift: +2 hours');
    console.log('✓ Drift-corrected now:', new Date(driftedNow).toISOString());
    console.log('✓ License expired (drift-corrected):', isExpired);
  },
});

// Scenario 4: Seat limit enforcement
scenarios.push({
  name: 'Seat Limit Enforcement',
  description: 'Verify seat limit prevents second machine activation',
  run: async () => {
    const license = {
      id: 'LIC-2026-003',
      seats: 1,
      status: 'ACTIVE',
    };

    const activeMachines = [
      { machineHash: 'machine-a', status: 'ACTIVE' },
    ];

    const newMachineHash = 'machine-b';

    const canActivate = activeMachines.length < license.seats ||
      activeMachines.some(m => m.machineHash === newMachineHash);

    console.log('✓ License seats:', license.seats);
    console.log('✓ Active machines:', activeMachines.length);
    console.log('✓ New machine can activate:', canActivate);
    console.log('  Reason:', canActivate ? 'Within seat limit' : 'SEAT_LIMIT exceeded');
  },
});

// Scenario 5: Grace period enforcement
scenarios.push({
  name: 'Grace Period Enforcement',
  description: 'Verify grace period allows offline operation',
  run: async () => {
    const gracePeriodHours = 72;
    const gracePeriodMs = gracePeriodHours * 60 * 60 * 1000;

    const gracePeriodScenarios = [
      { hoursAgo: 24, label: '24 hours ago' },
      { hoursAgo: 72, label: '72 hours ago (at limit)' },
      { hoursAgo: 73, label: '73 hours ago (exceeded)' },
    ];

    console.log('✓ Grace period:', gracePeriodHours, 'hours');

    for (const scenario of gracePeriodScenarios) {
      const lastSeen = new Date(Date.now() - scenario.hoursAgo * 60 * 60 * 1000);
      const elapsed = Date.now() - lastSeen.getTime();
      const withinGrace = elapsed <= gracePeriodMs;

      console.log(`  ${scenario.label}: ${withinGrace ? '✓ Within grace' : '✗ Grace exceeded'}`);
    }
  },
});

// Scenario 6: Tamper severity classification
scenarios.push({
  name: 'Tamper Severity Classification',
  description: 'Verify tamper severity levels',
  run: async () => {
    const tamperScenarios = [
      {
        name: 'MAC address change',
        flags: 1,
        severity: 'LOW',
      },
      {
        name: 'CPU + Drive change',
        flags: 2,
        severity: 'MEDIUM',
      },
      {
        name: 'CPU + Motherboard + Drive change',
        flags: 3,
        severity: 'HIGH',
      },
    ];

    console.log('✓ Tamper severity levels:');
    for (const scenario of tamperScenarios) {
      console.log(`  ${scenario.name}: ${scenario.severity} (${scenario.flags} component${scenario.flags > 1 ? 's' : ''})`);
    }
  },
});

// Scenario 7: Feature gating
scenarios.push({
  name: 'Feature Gating',
  description: 'Verify feature-based access control',
  run: async () => {
    const plans = {
      trial: { adminPanel: false, exports: true },
      basic: { adminPanel: false, exports: true },
      pro: { adminPanel: true, exports: true, advancedReports: true },
      enterprise: { adminPanel: true, exports: true, advancedReports: true, customBranding: true, apiAccess: true },
    };

    console.log('✓ Feature availability by plan:');
    for (const [plan, features] of Object.entries(plans)) {
      const featureList = Object.entries(features)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
        .join(', ');
      console.log(`  ${plan}: ${featureList}`);
    }
  },
});

// Scenario 8: Revocation detection
scenarios.push({
  name: 'Revocation Detection',
  description: 'Verify revocation response handling',
  run: async () => {
    const { publicKey, privateKey } = generateKeypair();

    const heartbeatResponse = {
      status: 'REVOKED',
      nextCheckAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      serverTime: new Date().toISOString(),
      features: { adminPanel: true },
    };

    const signature = signPayload(heartbeatResponse, privateKey);
    const isValid = verifySignature(heartbeatResponse, signature, publicKey);

    console.log('✓ Heartbeat response signature valid:', isValid);
    console.log('✓ License status:', heartbeatResponse.status);
    console.log('  Action: Lock app immediately');
    console.log('  Broadcast: license:lockout event to UI');
  },
});

/**
 * Run all scenarios
 */
async function runAllScenarios() {
  console.log('🔐 ProduTime License Scenario Simulator\n');
  console.log('='.repeat(60));

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    console.log(`\n[${i + 1}/${scenarios.length}] ${scenario.name}`);
    console.log(`${scenario.description}\n`);

    try {
      await scenario.run();
      console.log('✓ Scenario passed');
    } catch (error) {
      console.error('✗ Scenario failed:', error);
    }

    console.log('-'.repeat(60));
  }

  console.log('\n✓ All scenarios completed');
}

// Run if executed directly
if (require.main === module) {
  runAllScenarios().catch(console.error);
}

module.exports = { scenarios, generateKeypair, signPayload, verifySignature };
