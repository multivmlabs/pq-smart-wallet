import { useAccount } from 'wagmi'
import { SendTransaction } from './components/SendTransaction'

export default function App() {
  const { isConnected, address } = useAccount()

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>PQ Wallet Demo</h1>
      <p style={{ color: '#888', marginBottom: 32, fontSize: 14 }}>
        This dapp sends a standard eth_sendTransaction. The connected PQ wallet
        wraps it in an ML-DSA-signed UserOp under the hood.
      </p>

      <div style={{ marginBottom: 24 }}>
        {/* AppKit's built-in connect button — renders QR/WC URI */}
        <appkit-button />
      </div>

      {isConnected && (
        <div>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 16, wordBreak: 'break-all' }}>
            Connected: {address}
          </p>
          <SendTransaction />
        </div>
      )}
    </div>
  )
}

// TypeScript: declare the web component
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'appkit-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}
