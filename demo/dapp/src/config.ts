import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { defineChain } from 'viem'
import { http } from 'wagmi'

// Reown Cloud project ID — get yours free at https://cloud.reown.com
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || ''

if (!projectId) {
  console.warn(
    'Missing VITE_REOWN_PROJECT_ID — create one at https://cloud.reown.com and add to demo/.env'
  )
}

// Custom chain definition for Nitro devnode
export const nitroDevnode = defineChain({
  id: 412346,
  name: 'Nitro Devnode',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['/rpc'] },
  },
  testnet: true,
})

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [nitroDevnode],
  transports: {
    [nitroDevnode.id]: http('/rpc'),
  },
})

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [nitroDevnode],
  metadata: {
    name: 'PQ Demo Dapp',
    description: 'Post-Quantum Wallet Demo',
    url: 'http://localhost:3000',
    icons: [],
  },
  features: {
    analytics: false,
  },
})
