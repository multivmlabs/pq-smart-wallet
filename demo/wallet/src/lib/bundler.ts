import type { PackedUserOp } from './userop'
import type { Hex } from 'viem'

const BUNDLER_RPC = '/bundler'
const ENTRYPOINT = import.meta.env.VITE_ENTRYPOINT as string

/**
 * Submit a UserOp to the Alto bundler via eth_sendUserOperation.
 * Returns the UserOp hash.
 */
export async function submitUserOp(userOp: PackedUserOp): Promise<string> {
  // Alto expects unpacked format for eth_sendUserOperation
  const unpackedOp = unpackUserOp(userOp)

  const response = await fetch(BUNDLER_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_sendUserOperation',
      id: 1,
      params: [unpackedOp, ENTRYPOINT],
    }),
  })

  const result = await response.json()

  if (result.error) {
    throw new Error(`Bundler error: ${result.error.message}`)
  }

  return result.result as string
}

/**
 * Poll for a UserOp receipt until it's included on-chain.
 */
export async function waitForReceipt(
  opHash: string,
  timeoutMs = 30_000
): Promise<{ txHash: string; gasUsed: string }> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const response = await fetch(BUNDLER_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getUserOperationReceipt',
        id: 1,
        params: [opHash],
      }),
    })

    const result = await response.json()

    if (result.result) {
      return {
        txHash: result.result.receipt?.transactionHash ?? result.result.transactionHash ?? 'unknown',
        gasUsed: result.result.actualGasUsed ?? 'unknown',
      }
    }

    // Wait 1 second before polling again
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(`UserOp receipt not found after ${timeoutMs}ms`)
}

/**
 * Convert packed UserOp (bytes32 fields) to unpacked format for bundler JSON-RPC.
 */
function unpackUserOp(packed: PackedUserOp) {
  // accountGasLimits = verificationGasLimit(16) || callGasLimit(16)
  const agl = packed.accountGasLimits.slice(2) // remove 0x
  const verificationGasLimit = '0x' + (agl.slice(0, 32).replace(/^0+/, '') || '0')
  const callGasLimit = '0x' + (agl.slice(32).replace(/^0+/, '') || '0')

  // gasFees = maxPriorityFeePerGas(16) || maxFeePerGas(16)
  const gf = packed.gasFees.slice(2)
  const maxPriorityFeePerGas = '0x' + (gf.slice(0, 32).replace(/^0+/, '') || '0')
  const maxFeePerGas = '0x' + (gf.slice(32).replace(/^0+/, '') || '0')

  return {
    sender: packed.sender,
    nonce: packed.nonce,
    factory: null,
    factoryData: null,
    callData: packed.callData,
    callGasLimit: ensureHexPrefix(callGasLimit),
    verificationGasLimit: ensureHexPrefix(verificationGasLimit),
    preVerificationGas: packed.preVerificationGas,
    maxFeePerGas: ensureHexPrefix(maxFeePerGas),
    maxPriorityFeePerGas: ensureHexPrefix(maxPriorityFeePerGas),
    paymaster: null,
    paymasterVerificationGasLimit: null,
    paymasterPostOpGasLimit: null,
    paymasterData: null,
    signature: packed.signature,
  }
}

function ensureHexPrefix(val: string): string {
  if (val === '0x' || val === '0x0' || val === '') return '0x0'
  return val.startsWith('0x') ? val : `0x${val}`
}
