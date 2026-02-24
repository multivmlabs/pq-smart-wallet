/**
 * PQ Snap Types
 */

/**
 * ML-DSA security levels
 * - ml_dsa44: NIST Level 2 (~128-bit)
 * - ml_dsa65: NIST Level 3 (~192-bit) - DEFAULT
 * - ml_dsa87: NIST Level 5 (~256-bit)
 */
export type SecurityLevel = 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87';

/**
 * Stored keypair state
 */
export type KeypairState = {
	/** ML-DSA public key (hex) */
	publicKey: string;
	/** ML-DSA secret key (hex, encrypted at rest by MetaMask) */
	secretKey: string;
	/** Security level used */
	level: SecurityLevel;
	/** Creation timestamp */
	createdAt: number;
	/** Signing nonce (increments each signature) */
	nonce: number;
};

/**
 * Snap persistent state
 */
export type SnapState = {
	/** The keypair (null if not generated) */
	keypair: KeypairState | null;
	/** Version for migrations */
	version: number;
};

/**
 * RPC request parameters
 */
export interface GetPublicKeyParams {
	/** Generate new keypair if none exists (default: true) */
	create?: boolean;
}

export interface SignMessageParams {
	/** Message to sign (hex string, 0x prefixed) */
	message: string;
}

export interface SignUserOpParams {
	/** UserOperation hash to sign (32 bytes, hex string) */
	userOpHash: string;
	/** Chain ID (display-only, not used in signing — userOpHash already includes it) */
	chainId?: number;
}

export interface ExportKeyParams {
	/** Password to encrypt the backup */
	password: string;
}

export interface ImportKeyParams {
	/** Encrypted backup data */
	backup: string;
	/** Password to decrypt */
	password: string;
}

/**
 * RPC response types
 */
export type PublicKeyResponse = {
	/** Public key in hex */
	publicKey: string;
	/** Security level */
	level: SecurityLevel;
	/** Whether key was just created */
	created: boolean;
};

export type SignatureResponse = {
	/** Signature in hex */
	signature: string;
	/** Nonce used for this signature */
	nonce: number;
};

export type ExportResponse = {
	/** Encrypted backup blob */
	backup: string;
};

/**
 * Snap RPC methods
 */
export type RpcMethod =
	| 'pq_getPublicKey'
	| 'pq_signMessage'
	| 'pq_signUserOp'
	| 'pq_exportKey'
	| 'pq_importKey'
	| 'pq_getInfo';
