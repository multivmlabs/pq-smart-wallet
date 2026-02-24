# PQ Wallet Snap

Post-quantum ML-DSA (Dilithium) signing snap for MetaMask Flask.

## Overview

This MetaMask Snap provides post-quantum cryptographic signing using ML-DSA-65 (FIPS 204), a NIST-standardized lattice-based digital signature scheme.

**Key Features:**
- ML-DSA-65 (NIST Level 3, ~192-bit security)
- FIPS 204 compliant (verified against NIST ACVP test vectors)
- Secure key storage in MetaMask
- ERC-4337 UserOperation signing with domain separation
- Encrypted key backup/restore
- Nonce tracking for replay protection

## Security Properties

| Property | Value |
|----------|-------|
| Algorithm | ML-DSA-65 (FIPS 204) |
| Security Level | NIST Level 3 (~192-bit) |
| Public Key Size | 1,952 bytes |
| Secret Key Size | 4,032 bytes |
| Signature Size | ~3,309 bytes |
| Quantum Resistant | Yes |

## Installation

### For Users

The snap will be installed automatically when connecting to a dapp that uses PQ Wallet.

### For Developers

```bash
bun install
bun run build
bun run serve
```

## Testing

### Unit Tests

```bash
# Run all tests
bun test

# Run with coverage
bun run test:coverage
```

### NIST KAT Validation

The implementation is validated against official NIST ACVP test vectors (FIPS 204):

```
✓ ML-DSA-44 Keygen: 25/25 passed
✓ ML-DSA-65 Keygen: 25/25 passed
✓ ML-DSA-87 Keygen: 25/25 passed
✓ Cross-verification: 30/30 passed
```

Test vectors from: https://github.com/usnistgov/ACVP-Server

### Test UI

A browser-based test UI is included for manual testing:

```bash
# Start the snap server
bun run serve

# In another terminal, serve the test UI
bunx http-server test-ui -p 3000

# Open http://localhost:3000 in browser with MetaMask Flask
```

## RPC Methods

### pq_getPublicKey

Get or generate a post-quantum keypair.

```typescript
// Parameters
{ create?: boolean }  // Generate new keypair if none exists (default: true)

// Response
{
  publicKey: string;  // Hex-encoded public key (1,952 bytes)
  level: string;      // Security level ("ml_dsa65")
  created: boolean;   // Whether a new keypair was generated
}
```

### pq_signMessage

Sign an arbitrary message.

```typescript
// Parameters
{ message: string }  // Hex-encoded message to sign

// Response
{
  signature: string;  // Hex-encoded signature (~3,309 bytes)
  nonce: number;      // Signing nonce used
}
```

### pq_signUserOp

Sign an ERC-4337 UserOperation hash with domain separation.

```typescript
// Parameters
{
  userOpHash: string;  // 32-byte UserOperation hash (hex)
  chainId: number;     // Chain ID for domain separation
}

// Response
{
  signature: string;  // Hex-encoded signature (~3,309 bytes)
  nonce: number;      // Signing nonce used
}
```

**Domain Separation:**

The actual signed message is: `SHA3-256(userOpHash || chainId || nonce)`

This prevents:
- Cross-chain replay attacks (chainId)
- Session replay attacks (nonce)

### pq_exportKey

Export keypair as encrypted backup.

```typescript
// Parameters
{ password: string }  // Encryption password (min 8 characters)

// Response
{ backup: string }  // Hex-encoded encrypted backup
```

### pq_importKey

Import keypair from encrypted backup.

```typescript
// Parameters
{
  backup: string;    // Encrypted backup from pq_exportKey
  password: string;  // Decryption password
}

// Response
{
  publicKey: string;
  level: string;
  created: boolean;
}
```

### pq_getInfo

Get snap status information.

```typescript
// Response
{
  hasKeypair: boolean;
  level: string | null;
  nonce: number;
  publicKeyPrefix: string | null;
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MetaMask Extension                       │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Sandboxed Snap Environment              │   │
│   │                                                      │   │
│   │   ┌──────────────┐    ┌────────────────────────┐    │   │
│   │   │  RPC Router  │───►│  Handlers              │    │   │
│   │   │  (index.ts)  │    │  - keys.ts             │    │   │
│   │   └──────────────┘    │  - sign.ts             │    │   │
│   │                       └───────────┬────────────┘    │   │
│   │                                   │                 │   │
│   │                       ┌───────────▼────────────┐    │   │
│   │                       │  Crypto (mldsa.ts)     │    │   │
│   │                       │  @noble/post-quantum   │    │   │
│   │                       └───────────┬────────────┘    │   │
│   │                                   │                 │   │
│   │                       ┌───────────▼────────────┐    │   │
│   │                       │  State (state.ts)      │    │   │
│   │                       │  Encrypted storage     │    │   │
│   │                       └────────────────────────┘    │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
pq-snap/
├── snap.manifest.json     # Snap permissions and metadata
├── snap.config.ts         # Build configuration
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts           # RPC request handler
│   ├── types.ts           # TypeScript types
│   ├── state.ts           # Encrypted state management
│   ├── crypto/
│   │   ├── index.ts
│   │   └── mldsa.ts       # ML-DSA operations
│   ├── handlers/
│   │   ├── index.ts
│   │   ├── keys.ts        # Key management
│   │   └── sign.ts        # Signing operations
│   └── utils/
│       ├── index.ts
│       └── encryption.ts  # Backup encryption
├── test/
│   ├── mldsa.test.ts      # Unit tests
│   ├── kat.test.ts        # NIST KAT validation
│   └── kat/               # NIST ACVP test vectors
│       ├── keygen.json
│       ├── siggen.json
│       └── sigver.json
└── test-ui/
    └── index.html         # Browser test interface
```

## Security Considerations

### Key Storage

- Private keys are stored encrypted in MetaMask's secure storage
- Encryption uses MetaMask's entropy-derived key
- Keys never leave the snap sandbox

### Signing

- All signatures require explicit user confirmation via dialog
- UserOperation signing includes domain separation (chainId + nonce)
- Nonce prevents replay attacks across signing sessions

### Backup

- Backups are encrypted with PBKDF2 (100,000 iterations) + AES-256-GCM
- Password must be at least 8 characters
- User must confirm before export

### Sandbox

- Snap runs in SES (Secure EcmaScript) compartment
- No network access (no exfiltration possible)
- No access to MetaMask's Ethereum keys

## Development

### Prerequisites

- Bun 1.0+
- MetaMask Flask (developer version)

### Commands

```bash
# Build snap
bun run build

# Watch mode (rebuild on changes)
bun run watch

# Serve locally
bun run serve

# Run tests
bun test

# Type check
bun run typecheck

# Lint
bun run lint
```

### Testing in MetaMask Flask

1. Install [MetaMask Flask](https://metamask.io/flask/)
2. Run `bun run serve`
3. Open browser console and run:
   ```javascript
   await ethereum.request({
     method: 'wallet_requestSnaps',
     params: { 'local:http://localhost:8080': {} }
   });
   ```

### End-to-End Local Demo (Snap + WalletConnect)

Use this flow to run the full local stack and sign ERC-4337 UserOps with the snap.

Prerequisites:
- MetaMask Flask installed and unlocked
- `bun`, `npm`, `cargo`, `forge`, `cast`, Docker available
- No other local stack already bound to ports `8547`, `4337`, `8080`, `3000`, `3001`

1. Start the local chain + bundler stack (keep this terminal open):
   ```bash
   cd /Users/rossnkama/Developer/multivm-labs/account_abstraction
   ./scripts/dev-stack.sh
   ```
   Wait for:
   - `━━━ Ready ━━━`
   - `Press Ctrl-C to shut down`

2. Build and serve the snap:
   ```bash
   cd /Users/rossnkama/Developer/multivm-labs/account_abstraction/pq-snap
   bun install
   bun run build
   bun run serve
   ```

3. Start the wallet app:
   ```bash
   cd /Users/rossnkama/Developer/multivm-labs/account_abstraction/demo/wallet
   npm install
   npm run dev
   ```

4. In the wallet UI (`http://localhost:3001`):
   - Switch signer mode to `Snap`
   - Click `Connect MetaMask Snap`
   - Approve MetaMask prompts
   - Copy the full public key shown by the wallet

5. Install the copied snap public key into the demo account setup:
   ```bash
   cd /Users/rossnkama/Developer/multivm-labs/account_abstraction
   ./demo/setup.sh --snap-pubkey 0x<copied_3904_hex_chars>
   ```

6. Start the dapp:
   ```bash
   cd /Users/rossnkama/Developer/multivm-labs/account_abstraction/demo/dapp
   npm install
   npm run dev
   ```

7. Execute a transaction:
   - Open `http://localhost:3000`
   - Connect wallet and copy WalletConnect URI
   - Paste URI into wallet UI (`http://localhost:3001`)
   - Send the demo transaction from the dapp
   - Approve in the wallet, then approve the snap signing dialog

Expected result:
- Wallet log shows UserOp signed via MetaMask Snap
- Bundler accepts the UserOp
- On-chain confirmation appears
- Dapp receives the transaction hash

### Troubleshooting

- `Fetching local snaps is disabled`
  - In MetaMask Flask, enable local/localhost snaps in settings (Snaps/Experimental/Advanced depending on Flask version), then retry.

- `Snap signer not connected` right after connect
  - Confirm `bun run serve` is active in `pq-snap` and wallet uses `local:http://localhost:8080`.
  - Check wallet logs for detailed snap error text.

- `EntryPoint ... has no code` during `demo/setup.sh`
  - `scripts/dev-stack.sh` is not running or was interrupted. Restart it and keep it running while setup executes.

## Integration Example

```typescript
const SNAP_ID = 'local:http://localhost:8080';

// Install snap
await ethereum.request({
  method: 'wallet_requestSnaps',
  params: { [SNAP_ID]: {} }
});

// Get public key
const { publicKey } = await ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: SNAP_ID,
    request: { method: 'pq_getPublicKey' }
  }
});

// Sign UserOperation
const { signature } = await ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: SNAP_ID,
    request: {
      method: 'pq_signUserOp',
      params: {
        userOpHash: '0x...',
        chainId: 11155420  // OP Sepolia
      }
    }
  }
});
```

## Dependencies

- [@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum) - ML-DSA implementation
- [@noble/hashes](https://github.com/paulmillr/noble-hashes) - SHA3, PBKDF2
- [@metamask/snaps-sdk](https://docs.metamask.io/snaps/) - Snap framework

## License

MIT

## References

- [FIPS 204 (ML-DSA)](https://csrc.nist.gov/pubs/fips/204/final)
- [noble-post-quantum](https://github.com/paulmillr/noble-post-quantum)
- [MetaMask Snaps](https://docs.metamask.io/snaps/)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [NIST ACVP Test Vectors](https://github.com/usnistgov/ACVP-Server)
