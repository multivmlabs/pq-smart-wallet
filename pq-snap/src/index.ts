/**
 * PQ Wallet Snap
 *
 * Post-quantum ML-DSA (Dilithium) signing for MetaMask.
 *
 * RPC Methods:
 * - pq_getPublicKey: Get or generate keypair
 * - pq_signMessage: Sign arbitrary message
 * - pq_signUserOp: Sign ERC-4337 UserOperation
 * - pq_exportKey: Export encrypted backup
 * - pq_importKey: Import from backup
 * - pq_getInfo: Get snap status
 */

import type { OnRpcRequestHandler } from '@metamask/snaps-sdk';
import {
	handleExportKey,
	handleGetInfo,
	handleGetPublicKey,
	handleImportKey,
	handleSignMessage,
	handleSignUserOp,
} from './handlers';
import type {
	ExportKeyParams,
	GetPublicKeyParams,
	ImportKeyParams,
	SignMessageParams,
	SignUserOpParams,
} from './types';

/**
 * Handle incoming RPC requests
 */
export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
	const { method, params } = request;

	switch (method) {
		case 'pq_getPublicKey':
			return handleGetPublicKey(params as unknown as GetPublicKeyParams);

		case 'pq_signMessage':
			return handleSignMessage(params as unknown as SignMessageParams);

		case 'pq_signUserOp':
			return handleSignUserOp(params as unknown as SignUserOpParams);

		case 'pq_exportKey':
			return handleExportKey(params as unknown as ExportKeyParams);

		case 'pq_importKey':
			return handleImportKey(params as unknown as ImportKeyParams);

		case 'pq_getInfo':
			return handleGetInfo();

		default:
			throw new Error(`Method not supported: ${method}`);
	}
};
