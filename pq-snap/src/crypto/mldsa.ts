/**
 * ML-DSA (Dilithium) Cryptographic Operations
 *
 * Provides key generation, signing, and verification using
 * the noble-post-quantum library (FIPS 204 compliant).
 *
 * Default: ML-DSA-65 (NIST Level 3, ~192-bit security)
 */

import { sha3_256 } from '@noble/hashes/sha3';
// @ts-ignore — noble v0.5.x exports require .js extension; bundler resolves it
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import type { SecurityLevel } from '../types';

/**
 * ML-DSA algorithm instances by security level
 */
const ALGORITHMS = {
	ml_dsa44: ml_dsa44,
	ml_dsa65: ml_dsa65,
	ml_dsa87: ml_dsa87,
} as const;

/**
 * Key sizes by security level (bytes)
 */
export const KEY_SIZES = {
	ml_dsa44: { publicKey: 1312, secretKey: 2560, signature: 2420 },
	ml_dsa65: { publicKey: 1952, secretKey: 4032, signature: 3309 },
	ml_dsa87: { publicKey: 2592, secretKey: 4896, signature: 4627 },
} as const;

/**
 * Default security level
 */
export const DEFAULT_LEVEL: SecurityLevel = 'ml_dsa65';

/**
 * Generate a new ML-DSA keypair
 *
 * @param seed - Optional 32-byte seed for deterministic generation
 * @param level - Security level (default: ml_dsa65)
 * @returns Keypair with public and secret keys
 */
export function generateKeypair(
	seed?: Uint8Array,
	level: SecurityLevel = DEFAULT_LEVEL
): { publicKey: Uint8Array; secretKey: Uint8Array } {
	const algo = ALGORITHMS[level];

	if (seed) {
		if (seed.length !== 32) {
			throw new Error(`Seed must be 32 bytes, got ${seed.length}`);
		}
		return algo.keygen(seed);
	}

	// Generate random seed using snap entropy
	// This will be called after getting entropy from snap_getEntropy
	throw new Error('Seed required - use generateKeypairWithEntropy');
}

/**
 * Generate keypair using snap entropy
 *
 * @param level - Security level
 * @returns Keypair
 */
export async function generateKeypairWithEntropy(
	level: SecurityLevel = DEFAULT_LEVEL
): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
	// Get entropy from MetaMask
	const entropy = await snap.request({
		method: 'snap_getEntropy',
		params: {
			version: 1,
			salt: 'pq-wallet-keygen',
		},
	});

	// Hash the entropy to get a 32-byte seed
	const seed = sha3_256(hexToBytes(entropy));

	return generateKeypair(seed, level);
}

/**
 * Sign a message using ML-DSA
 *
 * @param secretKey - The ML-DSA secret key
 * @param message - The message to sign
 * @param level - Security level
 * @returns Signature bytes
 */
export function sign(
	secretKey: Uint8Array,
	message: Uint8Array,
	level: SecurityLevel = DEFAULT_LEVEL
): Uint8Array {
	const algo = ALGORITHMS[level];

	// Validate secret key size
	const expectedSize = KEY_SIZES[level].secretKey;
	if (secretKey.length !== expectedSize) {
		throw new Error(`Invalid secret key size: ${secretKey.length}, expected ${expectedSize}`);
	}

	return algo.sign(message, secretKey);
}

/**
 * Sign an ERC-4337 UserOperation hash with ML-DSA
 *
 * Signs the raw 32-byte userOpHash directly. The hash already includes
 * EntryPoint address + chainId (per ERC-4337 spec), so no additional
 * domain separation is needed.
 *
 * @param secretKey - The ML-DSA secret key
 * @param userOpHash - The 32-byte UserOperation hash
 * @param level - Security level
 * @returns Signature bytes
 */
export function signUserOp(
	secretKey: Uint8Array,
	userOpHash: Uint8Array,
	level: SecurityLevel = DEFAULT_LEVEL
): Uint8Array {
	if (userOpHash.length !== 32) {
		throw new Error(`UserOp hash must be 32 bytes, got ${userOpHash.length}`);
	}

	return sign(secretKey, userOpHash, level);
}

/**
 * Verify an ML-DSA signature
 *
 * @param publicKey - The ML-DSA public key
 * @param message - The original message
 * @param signature - The signature to verify
 * @param level - Security level
 * @returns True if valid
 */
export function verify(
	publicKey: Uint8Array,
	message: Uint8Array,
	signature: Uint8Array,
	level: SecurityLevel = DEFAULT_LEVEL
): boolean {
	const algo = ALGORITHMS[level];

	// Validate sizes
	const sizes = KEY_SIZES[level];
	if (publicKey.length !== sizes.publicKey) {
		throw new Error(`Invalid public key size: ${publicKey.length}, expected ${sizes.publicKey}`);
	}
	if (signature.length !== sizes.signature) {
		throw new Error(`Invalid signature size: ${signature.length}, expected ${sizes.signature}`);
	}

	try {
		return algo.verify(signature, message, publicKey);
	} catch {
		return false;
	}
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
	return `0x${Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')}`;
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
	const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (cleanHex.length % 2 !== 0) {
		throw new Error('Invalid hex string length');
	}
	const bytes = new Uint8Array(cleanHex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

