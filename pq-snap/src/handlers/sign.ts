/**
 * Signing Handlers
 *
 * Handles message and UserOperation signing with user confirmation.
 */

import { copyable, divider, heading, panel, text } from '@metamask/snaps-sdk';
import { bytesToHex, hexToBytes, sign, signUserOp } from '../crypto';
import { getKeypair, incrementNonce } from '../state';
import type { SignMessageParams, SignUserOpParams, SignatureResponse } from '../types';

/**
 * Sign an arbitrary message
 */
export async function handleSignMessage(params: SignMessageParams): Promise<SignatureResponse> {
	if (!params.message) {
		throw new Error('Message required');
	}

	const keypair = await getKeypair();
	if (!keypair) {
		throw new Error('No keypair. Call pq_getPublicKey first.');
	}

	const messageBytes = hexToBytes(params.message);

	// Show confirmation dialog
	const confirmed = await snap.request({
		method: 'snap_dialog',
		params: {
			type: 'confirmation',
			content: panel([
				heading('Sign Message'),
				text('An application wants to sign a message with your post-quantum key.'),
				divider(),
				text('**Message (hex):**'),
				copyable(params.message.slice(0, 66) + (params.message.length > 66 ? '...' : '')),
				divider(),
				text(`**Message size:** ${messageBytes.length} bytes`),
				text('**Signature type:** ML-DSA-65'),
			]),
		},
	});

	if (!confirmed) {
		throw new Error('User rejected signing request');
	}

	// Sign the message
	const secretKey = hexToBytes(keypair.secretKey);
	const signature = sign(secretKey, messageBytes, keypair.level);

	// Increment nonce for tracking
	const nonce = await incrementNonce();

	return {
		signature: bytesToHex(signature),
		nonce,
	};
}

/**
 * Sign an ERC-4337 UserOperation hash
 *
 * Includes domain separation with chain ID and nonce.
 */
export async function handleSignUserOp(params: SignUserOpParams): Promise<SignatureResponse> {
	if (!params.userOpHash) {
		throw new Error('userOpHash required');
	}

	const keypair = await getKeypair();
	if (!keypair) {
		throw new Error('No keypair. Call pq_getPublicKey first.');
	}

	const userOpHashBytes = hexToBytes(params.userOpHash);
	if (userOpHashBytes.length !== 32) {
		throw new Error(`userOpHash must be 32 bytes, got ${userOpHashBytes.length}`);
	}

	// Show confirmation dialog with transaction details
	const confirmed = await snap.request({
		method: 'snap_dialog',
		params: {
			type: 'confirmation',
			content: panel([
				heading('Sign Transaction'),
				text('An application wants to sign a transaction with your post-quantum key.'),
				divider(),
				text('**UserOperation Hash:**'),
				copyable(params.userOpHash),
				divider(),
				...(params.chainId ? [text(`**Chain ID:** ${params.chainId}`)] : []),
				text('**Signature type:** ML-DSA-65'),
				text('**Signature size:** 3,309 bytes'),
			]),
		},
	});

	if (!confirmed) {
		throw new Error('User rejected transaction signing');
	}

	// Increment nonce for tracking
	const nonce = await incrementNonce();

	// Sign raw userOpHash (already includes EntryPoint + chainId per ERC-4337)
	const secretKey = hexToBytes(keypair.secretKey);
	const signature = signUserOp(secretKey, userOpHashBytes, keypair.level);

	return {
		signature: bytesToHex(signature),
		nonce,
	};
}

/**
 * Get snap info (for debugging/display)
 */
export async function handleGetInfo(): Promise<{
	hasKeypair: boolean;
	level: string | null;
	nonce: number;
	publicKeyPrefix: string | null;
}> {
	const keypair = await getKeypair();

	return {
		hasKeypair: !!keypair,
		level: keypair?.level ?? null,
		nonce: keypair?.nonce ?? 0,
		publicKeyPrefix: keypair?.publicKey.slice(0, 18) ?? null,
	};
}
