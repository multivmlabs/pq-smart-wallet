/**
 * Error Path Tests
 *
 * Tests that invalid inputs are properly rejected across
 * crypto operations and encryption utilities.
 */

import { describe, it, expect } from 'vitest';
import {
	generateKeypair,
	sign,
	signUserOp,
	verify,
	hexToBytes,
	bytesToHex,
	KEY_SIZES,
	DEFAULT_LEVEL,
} from '../src/crypto';
import { encrypt, decrypt } from '../src/utils/encryption';

describe('generateKeypair error paths', () => {
	it('should reject seed shorter than 32 bytes', () => {
		expect(() => generateKeypair(new Uint8Array(16))).toThrow(
			'Seed must be 32 bytes, got 16',
		);
	});

	it('should reject seed longer than 32 bytes', () => {
		expect(() => generateKeypair(new Uint8Array(64))).toThrow(
			'Seed must be 32 bytes, got 64',
		);
	});

	it('should reject empty seed', () => {
		expect(() => generateKeypair(new Uint8Array(0))).toThrow(
			'Seed must be 32 bytes, got 0',
		);
	});

	it('should throw when no seed provided', () => {
		expect(() => generateKeypair()).toThrow(
			'Seed required - use generateKeypairWithEntropy',
		);
	});
});

describe('sign error paths', () => {
	it('should reject wrong secret key size for ml_dsa65', () => {
		const badKey = new Uint8Array(100);
		const message = new Uint8Array(32);

		expect(() => sign(badKey, message, 'ml_dsa65')).toThrow(
			'Invalid secret key size: 100, expected 4032',
		);
	});

	it('should reject wrong secret key size for ml_dsa44', () => {
		const badKey = new Uint8Array(100);
		const message = new Uint8Array(32);

		expect(() => sign(badKey, message, 'ml_dsa44')).toThrow(
			'Invalid secret key size: 100, expected 2560',
		);
	});

	it('should reject wrong secret key size for ml_dsa87', () => {
		const badKey = new Uint8Array(100);
		const message = new Uint8Array(32);

		expect(() => sign(badKey, message, 'ml_dsa87')).toThrow(
			'Invalid secret key size: 100, expected 4896',
		);
	});
});

describe('signUserOp error paths', () => {
	it('should reject userOpHash not 32 bytes', () => {
		const secretKey = new Uint8Array(KEY_SIZES.ml_dsa65.secretKey);
		const shortHash = new Uint8Array(16);

		expect(() => signUserOp(secretKey, shortHash)).toThrow(
			'UserOp hash must be 32 bytes, got 16',
		);
	});

	it('should reject empty userOpHash', () => {
		const secretKey = new Uint8Array(KEY_SIZES.ml_dsa65.secretKey);

		expect(() => signUserOp(secretKey, new Uint8Array(0))).toThrow(
			'UserOp hash must be 32 bytes, got 0',
		);
	});

	it('should reject oversized userOpHash', () => {
		const secretKey = new Uint8Array(KEY_SIZES.ml_dsa65.secretKey);

		expect(() => signUserOp(secretKey, new Uint8Array(64))).toThrow(
			'UserOp hash must be 32 bytes, got 64',
		);
	});
});

describe('verify error paths', () => {
	it('should reject wrong public key size', () => {
		const badPk = new Uint8Array(100);
		const message = new Uint8Array(32);
		const signature = new Uint8Array(KEY_SIZES.ml_dsa65.signature);

		expect(() => verify(badPk, message, signature, 'ml_dsa65')).toThrow(
			'Invalid public key size: 100, expected 1952',
		);
	});

	it('should reject wrong signature size', () => {
		const publicKey = new Uint8Array(KEY_SIZES.ml_dsa65.publicKey);
		const message = new Uint8Array(32);
		const badSig = new Uint8Array(100);

		expect(() => verify(publicKey, message, badSig, 'ml_dsa65')).toThrow(
			'Invalid signature size: 100, expected 3293',
		);
	});
});

describe('hexToBytes error paths', () => {
	it('should reject odd-length hex string', () => {
		expect(() => hexToBytes('0x123')).toThrow('Invalid hex string length');
	});

	it('should reject odd-length hex without prefix', () => {
		expect(() => hexToBytes('abc')).toThrow('Invalid hex string length');
	});

	it('should handle empty hex with prefix', () => {
		const result = hexToBytes('0x');
		expect(result.length).toBe(0);
	});

	it('should handle empty hex without prefix', () => {
		const result = hexToBytes('');
		expect(result.length).toBe(0);
	});
});

describe('encrypt/decrypt error paths', () => {
	it('should decrypt what was encrypted', async () => {
		const plaintext = 'test data for encryption roundtrip';
		const password = 'testpassword123';

		const encrypted = await encrypt(plaintext, password);
		const decrypted = await decrypt(encrypted, password);

		expect(decrypted).toBe(plaintext);
	});

	it('should reject decryption with wrong password', async () => {
		const encrypted = await encrypt('secret data', 'correctpassword');

		await expect(decrypt(encrypted, 'wrongpassword')).rejects.toThrow();
	});

	it('should reject decryption of too-short data', async () => {
		// salt (16) + iv (12) + tag (16) = 44 minimum
		const tooShort = bytesToHex(new Uint8Array(20));

		await expect(decrypt(tooShort, 'password')).rejects.toThrow(
			'Invalid encrypted data',
		);
	});

	it('should reject decryption of corrupted data', async () => {
		const encrypted = await encrypt('test data', 'password123');
		const bytes = hexToBytes(encrypted);

		// Corrupt the ciphertext portion (after salt + iv)
		bytes[30] ^= 0xff;
		const corrupted = bytesToHex(bytes);

		await expect(decrypt(corrupted, 'password123')).rejects.toThrow();
	});
});
