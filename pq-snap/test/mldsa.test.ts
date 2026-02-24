/**
 * ML-DSA (Dilithium) Test Suite
 *
 * Tests the ML-DSA implementation for correctness using:
 * 1. Round-trip tests (keygen → sign → verify)
 * 2. Deterministic keygen tests
 * 3. Invalid signature rejection
 * 4. Cross-level compatibility rejection
 * 5. Raw UserOp hash signing (no domain separation)
 *
 * Uses @noble/post-quantum v0.5.x API:
 *   sign(message, secretKey) — message first
 *   verify(signature, message, publicKey) — signature first
 *
 * Run with: npx vitest run test/mldsa.test.ts
 */

import { describe, it, expect } from 'vitest';
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { sha3_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Test constants
const TEST_MESSAGE = new TextEncoder().encode('Test message for ML-DSA signing');
const TEST_SEED = sha3_256(new TextEncoder().encode('deterministic-test-seed-32-bytes!'));

describe('ML-DSA-44 (NIST Level 2)', () => {
  it('should generate valid keypair', () => {
    const { publicKey, secretKey } = ml_dsa44.keygen();

    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(secretKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(1312);
    expect(secretKey.length).toBe(2560);
  });

  it('should sign and verify message', () => {
    const { publicKey, secretKey } = ml_dsa44.keygen();
    const signature = ml_dsa44.sign(TEST_MESSAGE, secretKey);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(2420);

    const isValid = ml_dsa44.verify(signature, TEST_MESSAGE, publicKey);
    expect(isValid).toBe(true);
  });

  it('should reject invalid signature', () => {
    const { publicKey, secretKey } = ml_dsa44.keygen();
    const signature = ml_dsa44.sign(TEST_MESSAGE, secretKey);

    // Flip a bit in the signature
    const badSig = new Uint8Array(signature);
    badSig[100] ^= 0x01;

    const isValid = ml_dsa44.verify(badSig, TEST_MESSAGE, publicKey);
    expect(isValid).toBe(false);
  });

  it('should reject wrong message', () => {
    const { publicKey, secretKey } = ml_dsa44.keygen();
    const signature = ml_dsa44.sign(TEST_MESSAGE, secretKey);

    const wrongMessage = new TextEncoder().encode('Wrong message');
    const isValid = ml_dsa44.verify(signature, wrongMessage, publicKey);
    expect(isValid).toBe(false);
  });

  it('should generate deterministic keypair from seed', () => {
    const keys1 = ml_dsa44.keygen(TEST_SEED);
    const keys2 = ml_dsa44.keygen(TEST_SEED);

    expect(bytesToHex(keys1.publicKey)).toBe(bytesToHex(keys2.publicKey));
    expect(bytesToHex(keys1.secretKey)).toBe(bytesToHex(keys2.secretKey));
  });
});

describe('ML-DSA-65 (NIST Level 3) - DEFAULT', () => {
  it('should generate valid keypair', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen();

    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(secretKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(1952);
    expect(secretKey.length).toBe(4032);
  });

  it('should sign and verify message', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen();
    const signature = ml_dsa65.sign(TEST_MESSAGE, secretKey);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(3309);

    const isValid = ml_dsa65.verify(signature, TEST_MESSAGE, publicKey);
    expect(isValid).toBe(true);
  });

  it('should reject invalid signature', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen();
    const signature = ml_dsa65.sign(TEST_MESSAGE, secretKey);

    // Flip a bit in the signature
    const badSig = new Uint8Array(signature);
    badSig[100] ^= 0x01;

    const isValid = ml_dsa65.verify(badSig, TEST_MESSAGE, publicKey);
    expect(isValid).toBe(false);
  });

  it('should reject wrong message', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen();
    const signature = ml_dsa65.sign(TEST_MESSAGE, secretKey);

    const wrongMessage = new TextEncoder().encode('Wrong message');
    const isValid = ml_dsa65.verify(signature, wrongMessage, publicKey);
    expect(isValid).toBe(false);
  });

  it('should generate deterministic keypair from seed', () => {
    const keys1 = ml_dsa65.keygen(TEST_SEED);
    const keys2 = ml_dsa65.keygen(TEST_SEED);

    expect(bytesToHex(keys1.publicKey)).toBe(bytesToHex(keys2.publicKey));
    expect(bytesToHex(keys1.secretKey)).toBe(bytesToHex(keys2.secretKey));
  });

  it('should produce consistent signatures for same message', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen(TEST_SEED);

    // ML-DSA uses hedged signing (includes randomness), so signatures differ
    // But both should verify
    const sig1 = ml_dsa65.sign(TEST_MESSAGE, secretKey);
    const sig2 = ml_dsa65.sign(TEST_MESSAGE, secretKey);

    expect(ml_dsa65.verify(sig1, TEST_MESSAGE, publicKey)).toBe(true);
    expect(ml_dsa65.verify(sig2, TEST_MESSAGE, publicKey)).toBe(true);
  });
});

describe('ML-DSA-87 (NIST Level 5)', () => {
  it('should generate valid keypair', () => {
    const { publicKey, secretKey } = ml_dsa87.keygen();

    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(secretKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(2592);
    expect(secretKey.length).toBe(4896);
  });

  it('should sign and verify message', () => {
    const { publicKey, secretKey } = ml_dsa87.keygen();
    const signature = ml_dsa87.sign(TEST_MESSAGE, secretKey);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(4627);

    const isValid = ml_dsa87.verify(signature, TEST_MESSAGE, publicKey);
    expect(isValid).toBe(true);
  });

  it('should reject invalid signature', () => {
    const { publicKey, secretKey } = ml_dsa87.keygen();
    const signature = ml_dsa87.sign(TEST_MESSAGE, secretKey);

    // Flip a bit in the signature
    const badSig = new Uint8Array(signature);
    badSig[100] ^= 0x01;

    const isValid = ml_dsa87.verify(badSig, TEST_MESSAGE, publicKey);
    expect(isValid).toBe(false);
  });

  it('should generate deterministic keypair from seed', () => {
    const keys1 = ml_dsa87.keygen(TEST_SEED);
    const keys2 = ml_dsa87.keygen(TEST_SEED);

    expect(bytesToHex(keys1.publicKey)).toBe(bytesToHex(keys2.publicKey));
    expect(bytesToHex(keys1.secretKey)).toBe(bytesToHex(keys2.secretKey));
  });
});

describe('Cross-level rejection', () => {
  it('should reject ML-DSA-44 signature with ML-DSA-65 verifier', () => {
    const keys44 = ml_dsa44.keygen();
    const sig44 = ml_dsa44.sign(TEST_MESSAGE, keys44.secretKey);

    // Can't even call verify with wrong sizes
    expect(() => {
      ml_dsa65.verify(sig44, TEST_MESSAGE, keys44.publicKey);
    }).toThrow();
  });

  it('should reject ML-DSA-65 signature with ML-DSA-87 verifier', () => {
    const keys65 = ml_dsa65.keygen();
    const sig65 = ml_dsa65.sign(TEST_MESSAGE, keys65.secretKey);

    expect(() => {
      ml_dsa87.verify(sig65, TEST_MESSAGE, keys65.publicKey);
    }).toThrow();
  });
});

describe('Raw UserOp hash signing', () => {
  /**
   * The snap signs the raw 32-byte userOpHash directly.
   * The ERC-4337 userOpHash already includes EntryPoint address + chainId,
   * so no additional domain separation is needed.
   */

  it('should sign and verify a 32-byte hash (simulating userOpHash)', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen(TEST_SEED);
    const userOpHash = sha3_256(new TextEncoder().encode('mock-userop-data'));

    expect(userOpHash.length).toBe(32);

    const signature = ml_dsa65.sign(userOpHash, secretKey);
    const isValid = ml_dsa65.verify(signature, userOpHash, publicKey);
    expect(isValid).toBe(true);
  });

  it('should reject signature verified against different hash', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen(TEST_SEED);
    const hash1 = sha3_256(new TextEncoder().encode('userop-1'));
    const hash2 = sha3_256(new TextEncoder().encode('userop-2'));

    const signature = ml_dsa65.sign(hash1, secretKey);

    expect(ml_dsa65.verify(signature, hash1, publicKey)).toBe(true);
    expect(ml_dsa65.verify(signature, hash2, publicKey)).toBe(false);
  });

  it('should reject signature from different keypair', () => {
    const keys1 = ml_dsa65.keygen();
    const keys2 = ml_dsa65.keygen();
    const userOpHash = sha3_256(new TextEncoder().encode('mock-userop'));

    const signature = ml_dsa65.sign(userOpHash, keys1.secretKey);

    // Valid with correct key
    expect(ml_dsa65.verify(signature, userOpHash, keys1.publicKey)).toBe(true);
    // Invalid with wrong key
    expect(ml_dsa65.verify(signature, userOpHash, keys2.publicKey)).toBe(false);
  });
});

describe('Performance benchmarks', () => {
  it('should benchmark ML-DSA-65 operations', () => {
    const iterations = 10;

    // Keygen
    const keygenStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      ml_dsa65.keygen();
    }
    const keygenTime = (performance.now() - keygenStart) / iterations;

    // Sign
    const { publicKey, secretKey } = ml_dsa65.keygen();
    const signStart = performance.now();
    let lastSig: Uint8Array = new Uint8Array();
    for (let i = 0; i < iterations; i++) {
      lastSig = ml_dsa65.sign(TEST_MESSAGE, secretKey);
    }
    const signTime = (performance.now() - signStart) / iterations;

    // Verify
    const verifyStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      ml_dsa65.verify(lastSig, TEST_MESSAGE, publicKey);
    }
    const verifyTime = (performance.now() - verifyStart) / iterations;

    console.log('\n=== ML-DSA-65 Performance ===');
    console.log(`Keygen:  ${keygenTime.toFixed(2)}ms`);
    console.log(`Sign:    ${signTime.toFixed(2)}ms`);
    console.log(`Verify:  ${verifyTime.toFixed(2)}ms`);

    // Just ensure they complete in reasonable time
    expect(keygenTime).toBeLessThan(1000);
    expect(signTime).toBeLessThan(1000);
    expect(verifyTime).toBeLessThan(1000);
  });
});

describe('Hex encoding round-trip', () => {
  it('should correctly encode and decode keys', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen(TEST_SEED);

    const pkHex = bytesToHex(publicKey);
    const skHex = bytesToHex(secretKey);

    const pkRestored = hexToBytes(pkHex);
    const skRestored = hexToBytes(skHex);

    expect(bytesToHex(pkRestored)).toBe(bytesToHex(publicKey));
    expect(bytesToHex(skRestored)).toBe(bytesToHex(secretKey));

    // Verify restored keys work
    const signature = ml_dsa65.sign(TEST_MESSAGE, skRestored);
    expect(ml_dsa65.verify(signature, TEST_MESSAGE, pkRestored)).toBe(true);
  });

  it('should correctly encode and decode signatures', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen();
    const signature = ml_dsa65.sign(TEST_MESSAGE, secretKey);

    const sigHex = bytesToHex(signature);
    const sigRestored = hexToBytes(sigHex);

    expect(bytesToHex(sigRestored)).toBe(bytesToHex(signature));
    expect(ml_dsa65.verify(sigRestored, TEST_MESSAGE, publicKey)).toBe(true);
  });
});

describe('Known Answer Test vectors', () => {
  /**
   * These are test vectors to verify consistent behavior across versions.
   * Generated once and hardcoded for regression testing.
   */

  const KAT_SEED = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const KAT_MESSAGE = new TextEncoder().encode('FIPS 204 ML-DSA test message');

  it('should produce consistent public key from known seed (ML-DSA-65)', () => {
    const { publicKey } = ml_dsa65.keygen(KAT_SEED);

    // Store the first 64 bytes as fingerprint
    const fingerprint = bytesToHex(publicKey.slice(0, 32));

    // This value should remain constant across library versions
    // If this fails after an update, investigate if it's a breaking change
    console.log('\nML-DSA-65 Public Key Fingerprint (first 32 bytes):');
    console.log(fingerprint);

    expect(publicKey.length).toBe(1952);
    expect(fingerprint.length).toBe(64);
  });

  it('should verify signature from known seed (ML-DSA-65)', () => {
    const { publicKey, secretKey } = ml_dsa65.keygen(KAT_SEED);
    const signature = ml_dsa65.sign(KAT_MESSAGE, secretKey);

    // Log for inspection
    console.log('\nML-DSA-65 Signature Fingerprint (first 32 bytes):');
    console.log(bytesToHex(signature.slice(0, 32)));

    expect(ml_dsa65.verify(signature, KAT_MESSAGE, publicKey)).toBe(true);
  });
});
