/**
 * State Management
 *
 * Handles encrypted persistent storage for the snap.
 * MetaMask encrypts snap state at rest using the user's password.
 */

import type { KeypairState, SecurityLevel, SnapState } from './types';

/** Current state version for migrations */
const STATE_VERSION = 1;

/** Default state */
const DEFAULT_STATE: SnapState = {
	keypair: null,
	version: STATE_VERSION,
};

/**
 * Get the current snap state
 */
export async function getState(): Promise<SnapState> {
	const state = await snap.request({
		method: 'snap_manageState',
		params: { operation: 'get' },
	});

	if (!state) {
		return DEFAULT_STATE;
	}

	// Migration logic for future versions
	const typedState = state as SnapState;
	if (typedState.version < STATE_VERSION) {
		return migrateState(typedState);
	}

	return typedState;
}

/**
 * Save snap state
 */
export async function setState(state: SnapState): Promise<void> {
	await snap.request({
		method: 'snap_manageState',
		params: {
			operation: 'update',
			newState: state,
		},
	});
}

/**
 * Clear all snap state
 */
export async function clearState(): Promise<void> {
	await snap.request({
		method: 'snap_manageState',
		params: { operation: 'clear' },
	});
}

/**
 * Get the stored keypair
 */
export async function getKeypair(): Promise<KeypairState | null> {
	const state = await getState();
	return state.keypair;
}

/**
 * Save a keypair to state
 */
export async function saveKeypair(
	publicKey: string,
	secretKey: string,
	level: SecurityLevel
): Promise<void> {
	const state = await getState();

	state.keypair = {
		publicKey,
		secretKey,
		level,
		createdAt: Date.now(),
		nonce: 0,
	};

	await setState(state);
}

/**
 * Increment and return the signing nonce
 */
export async function incrementNonce(): Promise<number> {
	const state = await getState();

	if (!state.keypair) {
		throw new Error('No keypair stored');
	}

	const nonce = state.keypair.nonce;
	state.keypair.nonce += 1;

	await setState(state);

	return nonce;
}

/**
 * Get current nonce without incrementing
 */
export async function getNonce(): Promise<number> {
	const state = await getState();

	if (!state.keypair) {
		return 0;
	}

	return state.keypair.nonce;
}

/**
 * Delete the stored keypair
 */
export async function deleteKeypair(): Promise<void> {
	const state = await getState();
	state.keypair = null;
	await setState(state);
}

/**
 * Migrate state from older versions
 */
function migrateState(oldState: SnapState): SnapState {
	// Future migration logic goes here
	// For now, just update the version
	return {
		...oldState,
		version: STATE_VERSION,
	};
}
