import { useState } from 'react'

interface PairInputProps {
  onPair: (uri: string) => void
  isConnected: boolean
  peerName?: string
}

export function PairInput({ onPair, isConnected, peerName }: PairInputProps) {
  const [uri, setUri] = useState('')

  const handlePair = () => {
    if (!uri.trim()) return
    onPair(uri.trim())
    setUri('')
  }

  return (
    <div style={{ border: '1px solid #333', borderRadius: 8, padding: 20, marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 12 }}>WalletConnect Pairing</h3>

      {isConnected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#4ade80',
          }} />
          <span style={{ fontSize: 13, color: '#4ade80' }}>
            Connected to {peerName || 'dapp'}
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            placeholder="Paste WalletConnect URI (wc:...)"
            onKeyDown={(e) => e.key === 'Enter' && handlePair()}
            style={{
              flex: 1,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 6,
              padding: '8px 12px',
              color: '#e0e0e0',
              fontSize: 13,
              outline: 'none',
            }}
          />
          <button
            onClick={handlePair}
            disabled={!uri.trim()}
            style={{
              background: uri.trim() ? '#7c3aed' : '#333',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              cursor: uri.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Connect
          </button>
        </div>
      )}
    </div>
  )
}
