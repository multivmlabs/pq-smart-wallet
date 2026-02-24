import { Core } from '@walletconnect/core'
import { WalletKit, type WalletKitTypes } from '@reown/walletkit'
import { buildApprovedNamespaces } from '@walletconnect/utils'

// Reown Cloud project ID — same as dapp, get yours at https://cloud.reown.com
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || ''

if (!projectId) {
  console.warn(
    'Missing VITE_REOWN_PROJECT_ID — create one at https://cloud.reown.com and add to demo/.env'
  )
}

const KERNEL_ACCOUNT = import.meta.env.VITE_KERNEL_ACCOUNT as string
const CHAIN_ID = import.meta.env.VITE_CHAIN_ID || '412346'

let walletKitInstance: InstanceType<typeof WalletKit> | null = null

export async function getWalletKit() {
  if (walletKitInstance) return walletKitInstance

  const core = new Core({ projectId })

  walletKitInstance = await WalletKit.init({
    core,
    metadata: {
      name: 'PQ Wallet',
      description: 'Post-Quantum ML-DSA Wallet Demo',
      url: 'http://localhost:3001',
      icons: [],
    },
  })

  return walletKitInstance
}

/**
 * Build approved namespaces for session proposal.
 * We only support eip155:412346 (Nitro devnode) with eth_sendTransaction.
 */
export function buildNamespaces(proposal: WalletKitTypes.SessionProposal) {
  return buildApprovedNamespaces({
    proposal: proposal.params,
    supportedNamespaces: {
      eip155: {
        chains: [`eip155:${CHAIN_ID}`],
        methods: ['eth_sendTransaction', 'personal_sign', 'eth_sign'],
        events: ['accountsChanged', 'chainChanged'],
        accounts: [`eip155:${CHAIN_ID}:${KERNEL_ACCOUNT}`],
      },
    },
  })
}

export { KERNEL_ACCOUNT, CHAIN_ID }
