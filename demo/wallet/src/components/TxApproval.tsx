import { formatEther } from 'viem'

export interface PendingTx {
  id: number
  topic: string
  to: string
  value: string
  data: string
}

interface TxApprovalProps {
  tx: PendingTx | null
  onApprove: () => void
  onReject: () => void
  status: 'idle' | 'building' | 'signing' | 'submitting' | 'waiting' | 'confirmed' | 'error'
  error?: string
}

export function TxApproval({ tx, onApprove, onReject, status, error }: TxApprovalProps) {
  if (!tx && status === 'idle') return null

  const statusLabels: Record<string, string> = {
    idle: 'Pending approval',
    building: 'Building UserOp...',
    signing: 'Signing with ML-DSA-65...',
    submitting: 'Submitting to bundler...',
    waiting: 'Waiting for on-chain confirmation...',
    confirmed: 'Transaction confirmed!',
    error: 'Error',
  }

  const statusColors: Record<string, string> = {
    idle: '#f59e0b',
    building: '#3b82f6',
    signing: '#8b5cf6',
    submitting: '#3b82f6',
    waiting: '#3b82f6',
    confirmed: '#4ade80',
    error: '#ef4444',
  }

  const isPending = status === 'idle' && tx
  const isProcessing = ['building', 'signing', 'submitting', 'waiting'].includes(status)

  return (
    <div style={{
      border: `1px solid ${statusColors[status] || '#333'}`,
      borderRadius: 8,
      padding: 20,
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14 }}>Transaction Request</h3>
        <span style={{ fontSize: 12, color: statusColors[status] }}>
          {statusLabels[status]}
        </span>
      </div>

      {tx && (
        <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#666' }}>To: </span>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{tx.to}</span>
          </div>
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#666' }}>Value: </span>
            <span>{formatEther(BigInt(tx.value || '0'))} ETH</span>
          </div>
          {tx.data && tx.data !== '0x' && (
            <div>
              <span style={{ color: '#666' }}>Data: </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {tx.data.slice(0, 66)}...
              </span>
            </div>
          )}
        </div>
      )}

      {isPending && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onApprove}
            style={{
              flex: 1,
              background: '#4ade80',
              color: '#000',
              border: 'none',
              borderRadius: 6,
              padding: '10px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Approve
          </button>
          <button
            onClick={onReject}
            style={{
              flex: 1,
              background: '#333',
              color: '#e0e0e0',
              border: '1px solid #555',
              borderRadius: 6,
              padding: '10px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reject
          </button>
        </div>
      )}

      {isProcessing && (
        <div style={{ fontSize: 12, color: statusColors[status], textAlign: 'center' }}>
          {statusLabels[status]}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8, wordBreak: 'break-all' }}>
          {error}
        </div>
      )}
    </div>
  )
}
