// @ts-ignore — noble-post-quantum requires .js extension for ESM; Vite resolves it
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'

interface MLDSAKeypair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

let cachedKeypair: MLDSAKeypair | undefined

export function configureSignerFromSeed(seedHex: string): void {
  const seed = hexToBytesStrict(seedHex)
  if (seed.length !== 32) throw new Error(`Expected 32-byte seed, got ${seed.length}`)

  cachedKeypair = ml_dsa65.keygen(seed) as MLDSAKeypair
}

export function isSignerConfigured(): boolean {
  return !!cachedKeypair
}

function getKeypair(): MLDSAKeypair {
  if (!cachedKeypair) {
    throw new Error('Signer not initialized. Load a 32-byte ML-DSA seed first.')
  }
  return cachedKeypair
}

/** Sign a 32-byte UserOp hash with ML-DSA-65. Returns 3,309-byte signature. */
export function signUserOpHash(hash: Uint8Array): Uint8Array {
  const kp = getKeypair()
  // v0.5.x API: sign(msg, secretKey) — message first, secret key second
  return ml_dsa65.sign(hash, kp.secretKey)
}

/** Get the ML-DSA-65 public key (1,952 bytes). */
export function getPublicKey(): Uint8Array {
  return getKeypair().publicKey
}

function hexToBytesStrict(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error('Seed hex must have an even length')
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('Seed contains non-hex characters')

  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
