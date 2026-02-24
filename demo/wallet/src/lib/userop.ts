import {
  type Address,
  type Hex,
  encodeFunctionData,
  encodePacked,
  createPublicClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  concat,
  toHex,
  pad,
  numberToHex,
} from 'viem'

// --- Config from env ---
const LOCAL_RPC = '/rpc'
const ENTRYPOINT = import.meta.env.VITE_ENTRYPOINT as Address
const KERNEL_ACCOUNT = import.meta.env.VITE_KERNEL_ACCOUNT as Address
const PQ_VALIDATOR = import.meta.env.VITE_PQ_VALIDATOR_MODULE as Address
const CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID || '412346')

// --- ABIs ---
const kernelExecuteAbi = [
  {
    name: 'execute',
    type: 'function',
    inputs: [
      { name: 'execMode', type: 'bytes32' },
      { name: 'executionCalldata', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

const entryPointAbi = [
  {
    name: 'getNonce',
    type: 'function',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// --- Types ---
export interface PackedUserOp {
  sender: Address
  nonce: Hex
  initCode: Hex
  callData: Hex
  accountGasLimits: Hex
  preVerificationGas: Hex
  gasFees: Hex
  paymasterAndData: Hex
  signature: Hex
}

export type UserOpSignFunction = (hash: Uint8Array) => Promise<Uint8Array> | Uint8Array

// --- Public client ---
const publicClient = createPublicClient({
  transport: http(LOCAL_RPC),
})

/**
 * Build a complete signed UserOp from a simple transaction request.
 */
export async function buildUserOp(txParams: {
  to: Address
  value: bigint
  data?: Hex
}, signFn: UserOpSignFunction): Promise<PackedUserOp> {
  // 1. Encode Kernel execute() calldata
  //    executionCalldata = abi.encodePacked(target(20), value(32), data(...))
  const executionCalldata = encodePacked(
    ['address', 'uint256', 'bytes'],
    [txParams.to, txParams.value, txParams.data ?? '0x']
  )

  // execMode = 0x00...00 (CALLTYPE_SINGLE, EXECTYPE_DEFAULT)
  const execMode = pad('0x00', { size: 32 })

  const callData = encodeFunctionData({
    abi: kernelExecuteAbi,
    functionName: 'execute',
    args: [execMode, executionCalldata],
  })

  // 2. Compute non-root validator nonce
  //    key = 0x0001{validatorAddr}0000
  const validatorClean = PQ_VALIDATOR.slice(2).toLowerCase()
  const nonceKey = BigInt(`0x0001${validatorClean}0000`)

  const nonce = await publicClient.readContract({
    address: ENTRYPOINT,
    abi: entryPointAbi,
    functionName: 'getNonce',
    args: [KERNEL_ACCOUNT, nonceKey],
  })

  // 3. Gas parameters (hardcoded, same as e2e test)
  const verificationGasLimit = 2_000_000n
  const callGasLimit = 100_000n
  const preVerificationGas = 100_000n
  const maxPriorityFeePerGas = 1_000_000_000n // 1 gwei
  const maxFeePerGas = 10_000_000_000n // 10 gwei

  // Pack gas limits: bytes32 = verificationGasLimit(16 bytes) || callGasLimit(16 bytes)
  const accountGasLimits = concat([
    pad(numberToHex(verificationGasLimit), { size: 16 }),
    pad(numberToHex(callGasLimit), { size: 16 }),
  ]) as Hex

  // Pack gas fees: bytes32 = maxPriorityFeePerGas(16 bytes) || maxFeePerGas(16 bytes)
  const gasFees = concat([
    pad(numberToHex(maxPriorityFeePerGas), { size: 16 }),
    pad(numberToHex(maxFeePerGas), { size: 16 }),
  ]) as Hex

  // 4. Compute UserOp hash (matching EntryPoint v0.7 exactly)
  const userOpHash = computeUserOpHash({
    sender: KERNEL_ACCOUNT,
    nonce: toHex(nonce),
    initCode: '0x',
    callData,
    accountGasLimits,
    preVerificationGas: toHex(preVerificationGas),
    gasFees,
    paymasterAndData: '0x',
  })

  // 5. Sign with ML-DSA-65
  const hashBytes = hexToBytes(userOpHash)
  const sigBytes = await signFn(hashBytes)
  const signature = bytesToHex(sigBytes)

  return {
    sender: KERNEL_ACCOUNT,
    nonce: toHex(nonce),
    initCode: '0x',
    callData,
    accountGasLimits,
    preVerificationGas: toHex(preVerificationGas),
    gasFees,
    paymasterAndData: '0x',
    signature,
  }
}

/**
 * Compute userOpHash exactly as EntryPoint v0.7 does.
 *
 * 1. Pack the UserOp (all fields except signature, dynamic fields individually hashed)
 * 2. Hash the packed data with entrypoint address and chain ID
 */
function computeUserOpHash(op: Omit<PackedUserOp, 'signature'>): Hex {
  // Step 1: pack and hash dynamic fields
  const packed = encodeAbiParameters(
    parseAbiParameters(
      'address, uint256, bytes32, bytes32, bytes32, uint256, bytes32, bytes32'
    ),
    [
      op.sender,
      BigInt(op.nonce),
      keccak256(op.initCode),
      keccak256(op.callData),
      op.accountGasLimits as `0x${string}`,
      BigInt(op.preVerificationGas),
      op.gasFees as `0x${string}`,
      keccak256(op.paymasterAndData),
    ]
  )

  const packedHash = keccak256(packed)

  // Step 2: hash with entrypoint and chain id
  const final = encodeAbiParameters(
    parseAbiParameters('bytes32, address, uint256'),
    [packedHash, ENTRYPOINT, BigInt(CHAIN_ID)]
  )

  return keccak256(final)
}

// --- Helpers ---
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`
}
