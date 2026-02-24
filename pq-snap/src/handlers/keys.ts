/**
 * Key Management Handlers
 *
 * Handles keypair generation, retrieval, export, and import.
 */

import { copyable, heading, panel, text } from '@metamask/snaps-sdk';
import {
	DEFAULT_LEVEL,
	KEY_SIZES,
	bytesToHex,
	generateKeypairWithEntropy,
	hexToBytes,
} from '../crypto';
import { deleteKeypair, getKeypair, saveKeypair } from '../state';
import type {
	ExportKeyParams,
	ExportResponse,
	GetPublicKeyParams,
	ImportKeyParams,
	PublicKeyResponse,
	SecurityLevel,
} from '../types';
import { decrypt, encrypt } from '../utils/encryption';

/**
 * Get public key, optionally creating a new keypair
 */
export async function handleGetPublicKey(params?: GetPublicKeyParams): Promise<PublicKeyResponse> {
	const create = params?.create !== false; // Default to true

	// Check for existing keypair
	const existing = await getKeypair();

	if (existing) {
		return {
			publicKey: existing.publicKey,
			level: existing.level,
			created: false,
		};
	}

	// No keypair exists
	if (!create) {
		throw new Error('No keypair exists. Set create=true to generate one.');
	}

	// Confirm key generation with user
	const confirmed = await snap.request({
		method: 'snap_dialog',
		params: {
			type: 'confirmation',
			content: panel([
				heading('Generate Post-Quantum Keypair'),
				text('This will create a new ML-DSA (Dilithium) keypair for signing transactions.'),
				text('**Security Level:** ML-DSA-65 (NIST Level 3)'),
				text('**Public Key Size:** 1,952 bytes'),
				text('**Signature Size:** 3,293 bytes'),
				text('Your private key will be stored securely in MetaMask.'),
			]),
		},
	});

	if (!confirmed) {
		throw new Error('User rejected keypair generation');
	}

	// Generate new keypair
	const { publicKey, secretKey } = await generateKeypairWithEntropy(DEFAULT_LEVEL);

	// Store keypair
	await saveKeypair(bytesToHex(publicKey), bytesToHex(secretKey), DEFAULT_LEVEL);

	return {
		publicKey: bytesToHex(publicKey),
		level: DEFAULT_LEVEL,
		created: true,
	};
}

/**
 * Export keypair as encrypted backup
 */
export async function handleExportKey(params: ExportKeyParams): Promise<ExportResponse> {
	if (!params.password || params.password.length < 8) {
		throw new Error('Password must be at least 8 characters');
	}

	const keypair = await getKeypair();
	if (!keypair) {
		throw new Error('No keypair to export');
	}

	// Confirm export with user
	const confirmed = await snap.request({
		method: 'snap_dialog',
		params: {
			type: 'confirmation',
			content: panel([
				heading('Export Private Key'),
				text('**WARNING:** Your private key will be exported.'),
				text('Anyone with this backup can control your account.'),
				text('Make sure you trust the application requesting this export.'),
			]),
		},
	});

	if (!confirmed) {
		throw new Error('User rejected key export');
	}

	// Create backup object
	const backupData = JSON.stringify({
		version: 1,
		level: keypair.level,
		publicKey: keypair.publicKey,
		secretKey: keypair.secretKey,
		createdAt: keypair.createdAt,
	});

	// Encrypt with password
	const encrypted = await encrypt(backupData, params.password);

	return { backup: encrypted };
}

/**
 * Import keypair from encrypted backup
 */
export async function handleImportKey(params: ImportKeyParams): Promise<PublicKeyResponse> {
	if (!params.backup) {
		throw new Error('Backup data required');
	}
	if (!params.password) {
		throw new Error('Password required');
	}

	// Check if keypair already exists
	const existing = await getKeypair();
	if (existing) {
		// Confirm overwrite
		const confirmed = await snap.request({
			method: 'snap_dialog',
			params: {
				type: 'confirmation',
				content: panel([
					heading('Replace Existing Keypair'),
					text('**WARNING:** You already have a keypair stored.'),
					text('Importing will **permanently replace** your current keys.'),
					text('Make sure you have a backup of your current keys!'),
				]),
			},
		});

		if (!confirmed) {
			throw new Error('User cancelled import');
		}
	}

	// Decrypt backup
	let backupData: string;
	try {
		backupData = await decrypt(params.backup, params.password);
	} catch {
		throw new Error('Failed to decrypt backup. Wrong password?');
	}

	// Parse backup
	let backup: {
		version: number;
		level: SecurityLevel;
		publicKey: string;
		secretKey: string;
		createdAt: number;
	};

	try {
		backup = JSON.parse(backupData);
	} catch {
		throw new Error('Invalid backup format');
	}

	// Validate backup
	if (backup.version !== 1) {
		throw new Error(`Unsupported backup version: ${backup.version}`);
	}

	const level = backup.level as SecurityLevel;
	if (!KEY_SIZES[level]) {
		throw new Error(`Invalid security level: ${level}`);
	}

	// Validate key sizes
	const secretKeyBytes = hexToBytes(backup.secretKey);
	const publicKeyBytes = hexToBytes(backup.publicKey);

	if (secretKeyBytes.length !== KEY_SIZES[level].secretKey) {
		throw new Error('Invalid secret key size in backup');
	}
	if (publicKeyBytes.length !== KEY_SIZES[level].publicKey) {
		throw new Error('Invalid public key size in backup');
	}

	// Save imported keypair
	await saveKeypair(backup.publicKey, backup.secretKey, level);

	// Show success
	await snap.request({
		method: 'snap_dialog',
		params: {
			type: 'alert',
			content: panel([
				heading('Import Successful'),
				text('Your keypair has been imported.'),
				text(`**Security Level:** ${level}`),
				copyable(`${backup.publicKey.slice(0, 66)}...`),
			]),
		},
	});

	return {
		publicKey: backup.publicKey,
		level,
		created: false,
	};
}

/**
 * Delete the stored keypair
 */
export async function handleDeleteKey(): Promise<void> {
	const keypair = await getKeypair();
	if (!keypair) {
		throw new Error('No keypair to delete');
	}

	const confirmed = await snap.request({
		method: 'snap_dialog',
		params: {
			type: 'confirmation',
			content: panel([
				heading('Delete Keypair'),
				text('**WARNING:** This will permanently delete your private key.'),
				text('You will lose access to any accounts using this key.'),
				text('Make sure you have exported a backup first!'),
			]),
		},
	});

	if (!confirmed) {
		throw new Error('User cancelled deletion');
	}

	await deleteKeypair();
}
