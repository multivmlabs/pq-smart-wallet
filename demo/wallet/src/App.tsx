import { useState, useEffect, useCallback, useRef } from 'react'
import { type Address } from 'viem'
import { getWalletKit, buildNamespaces, KERNEL_ACCOUNT } from './config'
import { buildUserOp } from './lib/userop'
import { submitUserOp, waitForReceipt } from './lib/bundler'
import { configureSignerFromSeed, isSignerConfigured, signUserOpHash } from './lib/signer'
import {
  connectSnap,
  getSnapInfo,
  getSnapPublicKey,
  isSnapConnected,
  signViaSnap,
  type SnapInfo,
} from './lib/snap-signer'
import { PairInput } from './components/PairInput'
import { TxApproval, type PendingTx } from './components/TxApproval'
import { StatusLog, type LogEntry } from './components/StatusLog'

type TxStatus = 'idle' | 'building' | 'signing' | 'submitting' | 'waiting' | 'confirmed' | 'error'
type SignerMode = 'seed' | 'snap'

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [peerName, setPeerName] = useState<string>()
  const [pendingTx, setPendingTx] = useState<PendingTx | null>(null)
  const [txStatus, setTxStatus] = useState<TxStatus>('idle')
  const [txError, setTxError] = useState<string>()
  const [signerMode, setSignerMode] = useState<SignerMode>('seed')
  const [seedInput, setSeedInput] = useState('')
  const [seedSignerReady, setSeedSignerReady] = useState(() => isSignerConfigured())
  const [snapConnected, setSnapConnected] = useState(false)
  const [snapConnecting, setSnapConnecting] = useState(false)
  const [snapInfo, setSnapInfo] = useState<SnapInfo | null>(null)
  const [snapPublicKey, setSnapPublicKey] = useState<string>()
  const [log, setLog] = useState<LogEntry[]>([])
  const walletKitRef = useRef<Awaited<ReturnType<typeof getWalletKit>> | null>(null)
  const signerReady = signerMode === 'seed' ? seedSignerReady : snapConnected

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLog(prev => [...prev, { timestamp: Date.now(), type, message }])
  }, [])

  // Initialize WalletKit and set up event handlers
  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        const wk = await getWalletKit()
        if (!mounted) return
        walletKitRef.current = wk
        addLog('info', 'WalletKit initialized')

        // Handle session proposals (dapp wants to connect)
        wk.on('session_proposal', async (proposal) => {
          addLog('info', `Session proposal from: ${proposal.params.proposer.metadata.name}`)

          try {
            const namespaces = buildNamespaces(proposal)
            await wk.approveSession({ id: proposal.id, namespaces })
            if (mounted) {
              setIsConnected(true)
              setPeerName(proposal.params.proposer.metadata.name)
              addLog('success', `Connected to ${proposal.params.proposer.metadata.name}`)
              addLog('info', `Exposing account: ${KERNEL_ACCOUNT}`)
            }
          } catch (err) {
            addLog('error', `Failed to approve session: ${err}`)
          }
        })

        // Handle session requests (dapp sends a transaction)
        wk.on('session_request', async (event) => {
          const { method, params } = event.params.request
          addLog('info', `Request: ${method}`)

          if (method === 'eth_sendTransaction') {
            const tx = params[0]
            if (mounted) {
              setPendingTx({
                id: event.id,
                topic: event.topic,
                to: tx.to || '0x0',
                value: tx.value || '0x0',
                data: tx.data || '0x',
              })
              setTxStatus('idle')
              setTxError(undefined)
              addLog('warning', `TX request: send ${tx.value || '0'} to ${tx.to}`)
            }
          } else {
            // Reject unsupported methods
            await wk.respondSessionRequest({
              topic: event.topic,
              response: {
                id: event.id,
                jsonrpc: '2.0',
                error: { code: 4001, message: `Unsupported method: ${method}` },
              },
            })
            addLog('warning', `Rejected unsupported method: ${method}`)
          }
        })

        // Handle session delete
        wk.on('session_delete', () => {
          if (mounted) {
            setIsConnected(false)
            setPeerName(undefined)
            addLog('info', 'Session disconnected')
          }
        })

      } catch (err) {
        addLog('error', `Init failed: ${err}`)
      }
    }

    init()
    return () => { mounted = false }
  }, [addLog])

  // Refresh snap connection state when entering snap mode.
  useEffect(() => {
    if (signerMode !== 'snap') return

    let mounted = true

    async function refreshSnapStatus() {
      try {
        const connected = await isSnapConnected()
        if (!mounted) return
        setSnapConnected(connected)

        if (!connected) {
          setSnapInfo(null)
          return
        }

        const info = await getSnapInfo()
        if (!mounted) return
        setSnapInfo(info)
      } catch {
        if (!mounted) return
        setSnapConnected(false)
        setSnapInfo(null)
      }
    }

    refreshSnapStatus()

    return () => { mounted = false }
  }, [signerMode])

  // Pair with a WalletConnect URI
  const handlePair = useCallback(async (uri: string) => {
    const wk = walletKitRef.current
    if (!wk) {
      addLog('error', 'WalletKit not ready')
      return
    }

    try {
      addLog('info', 'Pairing...')
      await wk.pair({ uri })
    } catch (err) {
      addLog('error', `Pairing failed: ${err}`)
    }
  }, [addLog])

  const handleLoadSeed = useCallback(() => {
    const seedHex = seedInput.trim()
    if (!seedHex) return

    try {
      configureSignerFromSeed(seedHex)
      setSeedSignerReady(true)
      setSeedInput('')
      addLog('success', 'ML-DSA seed loaded (in-memory only)')
    } catch (err) {
      addLog('error', `Invalid ML-DSA seed: ${err}`)
    }
  }, [seedInput, addLog])

  const handleConnectSnap = useCallback(async () => {
    setSnapConnecting(true)

    try {
      await connectSnap()
      const connected = await isSnapConnected()
      if (!connected) {
        throw new Error('Snap connection could not be confirmed')
      }

      const initialInfo = await getSnapInfo()
      const publicKey = await getSnapPublicKey()
      const info = await getSnapInfo()

      setSnapConnected(true)
      setSnapInfo(info)
      setSnapPublicKey(publicKey)

      const prefix = `${publicKey.slice(0, 18)}...`
      if (initialInfo.hasKeypair) {
        addLog('success', `Snap connected (pk: ${prefix})`)
      } else {
        addLog('success', `Snap key generated (pk: ${prefix})`)
      }
    } catch (err) {
      const msg = formatError(err)
      setSnapConnected(false)
      setSnapInfo(null)
      addLog('error', `Snap connection failed: ${msg}`)
      if (msg.toLowerCase().includes('fetching local snaps is disabled')) {
        addLog(
          'warning',
          'MetaMask Flask is blocking local snaps. Enable local/localhost snaps in MetaMask settings, then retry.'
        )
      }
    } finally {
      setSnapConnecting(false)
    }
  }, [addLog])

  const handleCopySnapPublicKey = useCallback(async () => {
    if (!snapPublicKey) return

    try {
      await navigator.clipboard.writeText(snapPublicKey)
      addLog('success', 'Snap public key copied to clipboard')
    } catch {
      addLog('warning', 'Clipboard copy failed; copy the public key manually')
    }
  }, [addLog, snapPublicKey])

  // Approve a pending transaction
  const handleApprove = useCallback(async () => {
    const wk = walletKitRef.current
    if (!wk || !pendingTx) return
    if (!signerReady) {
      addLog(
        'error',
        signerMode === 'seed'
          ? 'Signer not ready: load ML-DSA seed first'
          : 'Signer not ready: connect MetaMask Snap first'
      )
      return
    }

    try {
      // Step 1: Build UserOp
      setTxStatus('building')
      addLog('info', 'Building UserOp...')

      const signFn = signerMode === 'snap' ? signViaSnap : signUserOpHash
      const signerLabel = signerMode === 'snap' ? 'MetaMask Snap' : 'in-memory seed'

      const userOp = await buildUserOp({
        to: pendingTx.to as Address,
        value: BigInt(pendingTx.value),
        data: (pendingTx.data || '0x') as `0x${string}`,
      }, signFn)

      if (signerMode === 'snap') {
        const info = await getSnapInfo().catch(() => null)
        if (info) setSnapInfo(info)
      }

      // (signing happens inside buildUserOp, but we show it as a separate step)
      setTxStatus('signing')
      addLog('success', `UserOp built & signed via ${signerLabel} (sig: ${userOp.signature.slice(0, 20)}...)`)

      // Step 2: Submit to bundler
      setTxStatus('submitting')
      addLog('info', 'Submitting to Alto bundler...')

      const opHash = await submitUserOp(userOp)
      addLog('success', `Bundler accepted: ${opHash}`)

      // Step 3: Wait for on-chain receipt
      setTxStatus('waiting')
      addLog('info', 'Waiting for on-chain confirmation...')

      const receipt = await waitForReceipt(opHash)
      setTxStatus('confirmed')
      addLog('success', `Confirmed! TX: ${receipt.txHash} (gas: ${receipt.gasUsed})`)

      // Respond to dapp with the TX hash
      await wk.respondSessionRequest({
        topic: pendingTx.topic,
        response: {
          id: pendingTx.id,
          jsonrpc: '2.0',
          result: receipt.txHash,
        },
      })

      addLog('success', 'TX hash sent back to dapp')
    } catch (err: any) {
      setTxStatus('error')
      const msg = err?.message || String(err)
      setTxError(msg)
      addLog('error', `Failed: ${msg}`)

      // Respond with error to dapp
      if (wk && pendingTx) {
        await wk.respondSessionRequest({
          topic: pendingTx.topic,
          response: {
            id: pendingTx.id,
            jsonrpc: '2.0',
            error: { code: -32000, message: msg },
          },
        }).catch(() => {})
      }
    }
  }, [pendingTx, addLog, signerMode, signerReady])

  // Reject a pending transaction
  const handleReject = useCallback(async () => {
    const wk = walletKitRef.current
    if (!wk || !pendingTx) return

    await wk.respondSessionRequest({
      topic: pendingTx.topic,
      response: {
        id: pendingTx.id,
        jsonrpc: '2.0',
        error: { code: 4001, message: 'User rejected' },
      },
    })

    setPendingTx(null)
    setTxStatus('idle')
    addLog('info', 'Transaction rejected by user')
  }, [pendingTx, addLog])

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>PQ Wallet</h1>
      <p style={{ color: '#888', marginBottom: 8, fontSize: 14 }}>
        Post-quantum ML-DSA wallet. Receives transactions via WalletConnect,
        wraps them in ERC-4337 UserOps signed with ML-DSA-65.
      </p>
      <p style={{ fontSize: 12, color: '#555', marginBottom: 24, fontFamily: 'monospace' }}>
        Account: {KERNEL_ACCOUNT || 'not configured'}
      </p>

      <div style={{ border: '1px solid #333', borderRadius: 8, padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Signer Backend</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setSignerMode('seed')}
            style={{
              flex: 1,
              background: signerMode === 'seed' ? '#4f46e5' : '#222',
              color: '#fff',
              border: signerMode === 'seed' ? '1px solid #6366f1' : '1px solid #333',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Seed
          </button>
          <button
            onClick={() => setSignerMode('snap')}
            style={{
              flex: 1,
              background: signerMode === 'snap' ? '#0f766e' : '#222',
              color: '#fff',
              border: signerMode === 'snap' ? '1px solid #14b8a6' : '1px solid #333',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Snap
          </button>
        </div>

        {signerMode === 'seed' ? (
          <>
            <p style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
              Load a 32-byte ML-DSA seed hex from demo/.keys/sk.bin.
              Convert with: xxd -p demo/.keys/sk.bin | tr -d '\n'
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="password"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="0x..."
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
                onClick={handleLoadSeed}
                disabled={!seedInput.trim()}
                style={{
                  background: seedInput.trim() ? '#7c3aed' : '#333',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 16px',
                  fontSize: 13,
                  cursor: seedInput.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Load
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
              Connect MetaMask Flask with the local snap served at localhost:8080.
            </p>
            <button
              onClick={handleConnectSnap}
              disabled={snapConnecting}
              style={{
                background: snapConnecting ? '#333' : '#0f766e',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                cursor: snapConnecting ? 'not-allowed' : 'pointer',
                marginBottom: 10,
              }}
            >
              {snapConnecting ? 'Connecting...' : 'Connect MetaMask Snap'}
            </button>

            {snapConnected && (
              <div style={{ border: '1px solid #0f766e', borderRadius: 6, padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#4ade80',
                    display: 'inline-block',
                  }} />
                  <span style={{ fontSize: 12, color: '#4ade80' }}>Snap connected</span>
                </div>

                {snapInfo && (
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
                    <div>Level: {snapInfo.level || 'unknown'}</div>
                    <div>Nonce: {snapInfo.nonce}</div>
                  </div>
                )}

                {(snapPublicKey || snapInfo?.publicKeyPrefix) && (
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Public key:</div>
                    <textarea
                      readOnly
                      value={snapPublicKey || `${snapInfo?.publicKeyPrefix || ''}...`}
                      rows={snapPublicKey ? 3 : 1}
                      style={{
                        width: '100%',
                        background: '#111827',
                        border: '1px solid #374151',
                        borderRadius: 6,
                        color: '#cbd5e1',
                        fontSize: 11,
                        fontFamily: 'monospace',
                        padding: 8,
                        resize: 'vertical',
                      }}
                    />
                    {snapPublicKey && (
                      <button
                        onClick={handleCopySnapPublicKey}
                        style={{
                          marginTop: 8,
                          background: '#1f2937',
                          color: '#e5e7eb',
                          border: '1px solid #374151',
                          borderRadius: 6,
                          padding: '6px 10px',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Copy public key
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <p style={{ fontSize: 12, color: signerReady ? '#4ade80' : '#f59e0b', marginTop: 8 }}>
          {signerMode === 'seed'
            ? (seedSignerReady ? 'Seed signer ready' : 'Seed signer not loaded')
            : (snapConnected ? 'Snap signer ready' : 'Snap signer not connected')}
        </p>
      </div>

      <PairInput onPair={handlePair} isConnected={isConnected} peerName={peerName} />
      <TxApproval
        tx={pendingTx}
        onApprove={handleApprove}
        onReject={handleReject}
        status={txStatus}
        error={txError}
      />
      <StatusLog entries={log} />
    </div>
  )
}
