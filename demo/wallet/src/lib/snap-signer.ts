type SnapRpcMethod = 'pq_getPublicKey' | 'pq_signUserOp' | 'pq_getInfo'

interface EthereumProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>
}

interface SnapPublicKeyResponse {
  publicKey: string
  level: string
  created: boolean
}

interface SnapSignatureResponse {
  signature: string
  nonce: number
}

export interface SnapInfo {
  hasKeypair: boolean
  level: string | null
  nonce: number
  publicKeyPrefix: string | null
}

export type SignerBackend = (hash: Uint8Array) => Promise<Uint8Array> | Uint8Array

const DEFAULT_SNAP_ID = 'local:http://localhost:8080'
const SNAP_ID = import.meta.env.VITE_SNAP_ID || DEFAULT_SNAP_ID
const CHAIN_ID_RAW = import.meta.env.VITE_CHAIN_ID || '412346'
const CHAIN_ID = Number.parseInt(CHAIN_ID_RAW, 10)

function getEthereumProvider(): EthereumProvider {
  const provider = (window as Window & { ethereum?: EthereumProvider }).ethereum
  if (!provider) {
    throw new Error('MetaMask not detected. Install MetaMask Flask to use Snap mode.')
  }
  return provider
}

async function invokeSnap<T>(method: SnapRpcMethod, params?: Record<string, unknown>): Promise<T> {
  const provider = getEthereumProvider()
  const request = params ? { method, params } : { method }
  const response = await provider.request({
    method: 'wallet_invokeSnap',
    params: {
      snapId: SNAP_ID,
      request,
    },
  })
  return response as T
}

export async function connectSnap(): Promise<void> {
  const provider = getEthereumProvider()
  await provider.request({
    method: 'wallet_requestSnaps',
    params: {
      [SNAP_ID]: {},
    },
  })
}

export async function isSnapConnected(): Promise<boolean> {
  const provider = getEthereumProvider()
  try {
    const snaps = await provider.request({
      method: 'wallet_getSnaps',
    })
    if (!snaps || typeof snaps !== 'object') return false
    return SNAP_ID in (snaps as Record<string, unknown>)
  } catch {
    return false
  }
}

export async function getSnapPublicKey(): Promise<string> {
  const response = await invokeSnap<SnapPublicKeyResponse>('pq_getPublicKey', { create: true })
  if (!response.publicKey || typeof response.publicKey !== 'string') {
    throw new Error('Snap returned an invalid public key')
  }
  return normalizeHex(response.publicKey)
}

export async function getSnapInfo(): Promise<SnapInfo> {
  const info = await invokeSnap<SnapInfo>('pq_getInfo')
  return {
    hasKeypair: Boolean(info?.hasKeypair),
    level: info?.level ?? null,
    nonce: info?.nonce ?? 0,
    publicKeyPrefix: info?.publicKeyPrefix ?? null,
  }
}

export async function signViaSnap(hash: Uint8Array): Promise<Uint8Array> {
  if (hash.length !== 32) {
    throw new Error(`Expected 32-byte UserOp hash, got ${hash.length}`)
  }

  const params: Record<string, unknown> = {
    userOpHash: bytesToHex(hash),
  }

  if (Number.isInteger(CHAIN_ID) && CHAIN_ID > 0) {
    params.chainId = CHAIN_ID
  }

  const response = await invokeSnap<SnapSignatureResponse>('pq_signUserOp', params)
  if (!response.signature || typeof response.signature !== 'string') {
    throw new Error('Snap returned an invalid signature')
  }

  return hexToBytesStrict(response.signature)
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function normalizeHex(hex: string): `0x${string}` {
  const prefixed = hex.startsWith('0x') ? hex : `0x${hex}`
  if (!/^0x[0-9a-fA-F]*$/.test(prefixed)) {
    throw new Error('Expected hex string response from snap')
  }
  return prefixed as `0x${string}`
}

function hexToBytesStrict(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error('Hex value must have an even length')
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('Hex value contains non-hex characters')

  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

