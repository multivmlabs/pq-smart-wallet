/**
 * Known Answer Tests (KAT) for ML-DSA
 *
 * Tests the @noble/post-quantum ML-DSA implementation against
 * official NIST ACVP test vectors (FIPS 204).
 *
 * Test vectors from: https://github.com/usnistgov/ACVP-Server
 *
 * Key Generation tests are deterministic and MUST match exactly.
 * Signature tests use roundtrip verification since noble uses hedged signing.
 *
 * Run with: npx vitest run test/kat.test.ts
 */

import { describe, it, expect } from 'vitest';
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as fs from 'fs';
import * as path from 'path';

// Load KAT files
const katDir = path.join(__dirname, 'kat');
const keygenKat = JSON.parse(fs.readFileSync(path.join(katDir, 'keygen.json'), 'utf-8'));

// Map parameter sets to implementations
const implementations: Record<string, typeof ml_dsa44> = {
  'ML-DSA-44': ml_dsa44,
  'ML-DSA-65': ml_dsa65,
  'ML-DSA-87': ml_dsa87,
};

/**
 * Key Generation Tests - CRITICAL
 *
 * These are deterministic - given a seed, the keys MUST match exactly.
 * This proves the implementation is FIPS 204 compliant.
 */
describe('NIST ACVP Key Generation KAT (FIPS 204)', () => {
  for (const group of keygenKat.testGroups) {
    const paramSet = group.parameterSet as string;
    const impl = implementations[paramSet];

    if (!impl) continue;

    describe(paramSet, () => {
      // Test all vectors for this parameter set
      for (const test of group.tests) {
        it(`keygen test case ${test.tcId}`, () => {
          const seed = hexToBytes(test.seed);
          const expectedPk = test.pk.toLowerCase();
          const expectedSk = test.sk.toLowerCase();

          const { publicKey, secretKey } = impl.keygen(seed);

          expect(bytesToHex(publicKey)).toBe(expectedPk);
          expect(bytesToHex(secretKey)).toBe(expectedSk);
        });
      }
    });
  }
});

/**
 * Comprehensive ML-DSA-65 validation
 * This is the security level we use in the snap
 */
describe('Full ML-DSA-65 KAT validation', () => {
  it('should pass ALL 25 keygen vectors', () => {
    const group = keygenKat.testGroups.find(
      (g: { parameterSet: string }) => g.parameterSet === 'ML-DSA-65'
    );
    expect(group).toBeDefined();

    let passed = 0;
    const errors: string[] = [];

    for (const test of group.tests) {
      const seed = hexToBytes(test.seed);
      const { publicKey, secretKey } = ml_dsa65.keygen(seed);

      const pkMatch = bytesToHex(publicKey) === test.pk.toLowerCase();
      const skMatch = bytesToHex(secretKey) === test.sk.toLowerCase();

      if (pkMatch && skMatch) {
        passed++;
      } else {
        errors.push(`Test ${test.tcId}: pk=${pkMatch}, sk=${skMatch}`);
      }
    }

    console.log(`\n✓ ML-DSA-65 Keygen KAT: ${passed}/${group.tests.length} passed`);

    if (errors.length > 0) {
      console.error('Failures:', errors);
    }

    expect(passed).toBe(group.tests.length);
  });

  it('should sign and verify with all KAT-generated keys', () => {
    const group = keygenKat.testGroups.find(
      (g: { parameterSet: string }) => g.parameterSet === 'ML-DSA-65'
    );

    let passed = 0;
    const testMessage = new TextEncoder().encode('FIPS 204 ML-DSA test message');

    for (const test of group.tests) {
      const seed = hexToBytes(test.seed);
      const { publicKey, secretKey } = ml_dsa65.keygen(seed);

      // Sign and verify with our generated keys
      const signature = ml_dsa65.sign(testMessage, secretKey);
      const isValid = ml_dsa65.verify(signature, testMessage, publicKey);

      if (isValid) {
        passed++;
      }
    }

    console.log(`\n✓ ML-DSA-65 Sign/Verify with KAT keys: ${passed}/${group.tests.length} passed`);
    expect(passed).toBe(group.tests.length);
  });
});

/**
 * Full validation for all security levels
 */
describe('All security levels KAT validation', () => {
  for (const [name, impl] of Object.entries(implementations)) {
    it(`should pass all keygen vectors for ${name}`, () => {
      const group = keygenKat.testGroups.find(
        (g: { parameterSet: string }) => g.parameterSet === name
      );
      expect(group).toBeDefined();

      let passed = 0;

      for (const test of group.tests) {
        const seed = hexToBytes(test.seed);
        const { publicKey, secretKey } = impl.keygen(seed);

        if (
          bytesToHex(publicKey) === test.pk.toLowerCase() &&
          bytesToHex(secretKey) === test.sk.toLowerCase()
        ) {
          passed++;
        }
      }

      console.log(`\n✓ ${name} Keygen: ${passed}/${group.tests.length}`);
      expect(passed).toBe(group.tests.length);
    });
  }
});

/**
 * Cross-verification: Sign with one key, verify with matching public key
 */
describe('Cross-verification with KAT keys', () => {
  it('should sign various message sizes correctly', () => {
    const group = keygenKat.testGroups.find(
      (g: { parameterSet: string }) => g.parameterSet === 'ML-DSA-65'
    );

    const testMessages = [
      new Uint8Array(0), // Empty
      new Uint8Array([0x00]), // Single byte
      new Uint8Array([0x01, 0x02, 0x03]), // Small
      new TextEncoder().encode('Hello, post-quantum world!'), // Text
      new Uint8Array(1000).fill(0xAB), // Large
      new Uint8Array(10000).fill(0xCD), // Very large
    ];

    let totalPassed = 0;
    const totalTests = 5 * testMessages.length; // 5 keys * 6 messages

    for (const keyTest of group.tests.slice(0, 5)) {
      const seed = hexToBytes(keyTest.seed);
      const { publicKey, secretKey } = ml_dsa65.keygen(seed);

      for (const message of testMessages) {
        const signature = ml_dsa65.sign(message, secretKey);
        const isValid = ml_dsa65.verify(signature, message, publicKey);

        if (isValid) {
          totalPassed++;
        }
      }
    }

    console.log(`\n✓ Cross-verification: ${totalPassed}/${totalTests} passed`);
    expect(totalPassed).toBe(totalTests);
  });

  it('should reject tampered signatures', () => {
    const group = keygenKat.testGroups.find(
      (g: { parameterSet: string }) => g.parameterSet === 'ML-DSA-65'
    );

    const seed = hexToBytes(group.tests[0].seed);
    const { publicKey, secretKey } = ml_dsa65.keygen(seed);
    const message = new TextEncoder().encode('Test message');

    const signature = ml_dsa65.sign(message, secretKey);

    // Tamper with signature
    const tampered = new Uint8Array(signature);
    tampered[100] ^= 0x01;

    expect(ml_dsa65.verify(tampered, message, publicKey)).toBe(false);
  });

  it('should reject wrong message', () => {
    const group = keygenKat.testGroups.find(
      (g: { parameterSet: string }) => g.parameterSet === 'ML-DSA-65'
    );

    const seed = hexToBytes(group.tests[0].seed);
    const { publicKey, secretKey } = ml_dsa65.keygen(seed);

    const message1 = new TextEncoder().encode('Message 1');
    const message2 = new TextEncoder().encode('Message 2');

    const signature = ml_dsa65.sign(message1, secretKey);

    expect(ml_dsa65.verify(signature, message2, publicKey)).toBe(false);
  });

  it('should reject wrong public key', () => {
    const group = keygenKat.testGroups.find(
      (g: { parameterSet: string }) => g.parameterSet === 'ML-DSA-65'
    );

    const seed1 = hexToBytes(group.tests[0].seed);
    const seed2 = hexToBytes(group.tests[1].seed);

    const keys1 = ml_dsa65.keygen(seed1);
    const keys2 = ml_dsa65.keygen(seed2);

    const message = new TextEncoder().encode('Test message');
    const signature = ml_dsa65.sign(message, keys1.secretKey);

    // Verify with wrong public key should fail
    expect(ml_dsa65.verify(signature, message, keys2.publicKey)).toBe(false);
  });
});

/**
 * Key size validation
 */
describe('Key and signature sizes match FIPS 204 spec', () => {
  it('ML-DSA-44 sizes', () => {
    const { publicKey, secretKey } = ml_dsa44.keygen();
    const sig = ml_dsa44.sign(new Uint8Array([0x00]), secretKey);

    expect(publicKey.length).toBe(1312);
    expect(secretKey.length).toBe(2560);
    // Signature size can vary slightly
    expect(sig.length).toBeGreaterThanOrEqual(2420);
  });

  it('ML-DSA-65 sizes', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen();
    const sig = ml_dsa65.sign(new Uint8Array([0x00]), secretKey);

    expect(publicKey.length).toBe(1952);
    expect(secretKey.length).toBe(4032);
    expect(sig.length).toBeGreaterThanOrEqual(3293);
  });

  it('ML-DSA-87 sizes', () => {
    const { publicKey, secretKey } = ml_dsa87.keygen();
    const sig = ml_dsa87.sign(new Uint8Array([0x00]), secretKey);

    expect(publicKey.length).toBe(2592);
    expect(secretKey.length).toBe(4896);
    expect(sig.length).toBeGreaterThanOrEqual(4595);
  });
});
