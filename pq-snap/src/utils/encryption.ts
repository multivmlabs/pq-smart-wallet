/**
 * Encryption Utilities
 *
 * Simple password-based encryption for key backup/restore.
 * Uses PBKDF2 + AES-GCM.
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '../crypto';

// Constants
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

/**
 * Encrypt data with a password
 *
 * @param plaintext - Data to encrypt
 * @param password - Encryption password
 * @returns Hex-encoded encrypted data (salt + iv + ciphertext + tag)
 */
export async function encrypt(plaintext: string, password: string): Promise<string> {
	// Generate random salt and IV
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

	// Derive key from password
	const key = pbkdf2(sha256, password, salt, {
		c: PBKDF2_ITERATIONS,
		dkLen: KEY_LENGTH,
	});

	// Import key for WebCrypto
	const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [
		'encrypt',
	]);

	// Encrypt
	const encoder = new TextEncoder();
	const plaintextBytes = encoder.encode(plaintext);

	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		cryptoKey,
		plaintextBytes
	);

	// Combine: salt (16) + iv (12) + ciphertext (includes 16-byte tag)
	const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
	result.set(salt, 0);
	result.set(iv, SALT_LENGTH);
	result.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);

	return bytesToHex(result);
}

/**
 * Decrypt data with a password
 *
 * @param encrypted - Hex-encoded encrypted data
 * @param password - Decryption password
 * @returns Decrypted plaintext
 */
export async function decrypt(encrypted: string, password: string): Promise<string> {
	const data = hexToBytes(encrypted);

	if (data.length < SALT_LENGTH + IV_LENGTH + 16) {
		throw new Error('Invalid encrypted data');
	}

	// Extract components
	const salt = data.slice(0, SALT_LENGTH);
	const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
	const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);

	// Derive key from password
	const key = pbkdf2(sha256, password, salt, {
		c: PBKDF2_ITERATIONS,
		dkLen: KEY_LENGTH,
	});

	// Import key for WebCrypto
	const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [
		'decrypt',
	]);

	// Decrypt
	const plaintextBytes = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv },
		cryptoKey,
		ciphertext
	);

	const decoder = new TextDecoder();
	return decoder.decode(plaintextBytes);
}
