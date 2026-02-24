import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther } from 'viem'

const RECIPIENT = '0x1111111111111111111111111111111111111111' as const
const AMOUNT = '0.001' // ETH

export function SendTransaction() {
  const { sendTransaction, data: txHash, isPending, error } = useSendTransaction()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const handleSend = () => {
    sendTransaction({
      to: RECIPIENT,
      value: parseEther(AMOUNT),
    })
  }

  return (
    <div style={{ border: '1px solid #333', borderRadius: 8, padding: 20 }}>
      <h3 style={{ fontSize: 16, marginBottom: 12 }}>Send Transaction</h3>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
        Send {AMOUNT} ETH to {RECIPIENT.slice(0, 10)}...
      </p>

      <button
        onClick={handleSend}
        disabled={isPending || isConfirming}
        style={{
          background: isPending || isConfirming ? '#333' : '#7c3aed',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '10px 24px',
          fontSize: 14,
          cursor: isPending || isConfirming ? 'not-allowed' : 'pointer',
          width: '100%',
        }}
      >
        {isPending ? 'Confirm in wallet...' : isConfirming ? 'Waiting for confirmation...' : `Send ${AMOUNT} ETH`}
      </button>

      {txHash && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#4ade80', wordBreak: 'break-all' }}>
          TX Hash: {txHash}
        </div>
      )}

      {isSuccess && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#4ade80' }}>
          Transaction confirmed!
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#ef4444', wordBreak: 'break-all' }}>
          Error: {error.message.slice(0, 200)}
        </div>
      )}
    </div>
  )
}
