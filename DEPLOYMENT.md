# Deployment Guide

Single place for local deployment/play with different configs:

- `snap` (MetaMask Snap signer)
- `basic-web-wallet` (seed pasted into browser wallet UI)
- `cli-e2e` (scripted end-to-end validation)

All commands are run from:

```bash
cd /Users/rossnkama/Developer/multivm-labs/account_abstraction
```

## Prerequisites

- Docker running
- `forge`, `cast`, `cargo`, `cargo stylus`, Node.js/npm, Bun
- External repos expected by scripts are present under `~/Developer/tools/dlt/`
- Ports free: `8547`, `4337`, `3000`, `3001`, `8080`

## Config Matrix

| Config | Signer | Intended use |
|---|---|---|
| `snap` | MetaMask Snap (key in snap state) | Demo with better key handling UX |
| `basic-web-wallet` | Raw seed pasted into wallet UI | Quick local demo only |
| `cli-e2e` | Local CLI signer | Scripted integration verification |

## Shared Base Step (Required for all configs)

Start stack and keep it running in a dedicated terminal:

```bash
./scripts/dev-stack.sh
```

Wait for:

- `━━━ Ready ━━━`
- `Press Ctrl-C to shut down`

If this terminal stops, deployments and RPC state are gone.

## Config: snap

1. Start snap server:

   ```bash
   cd pq-snap
   bun install
   bun run build
   bun run serve
   ```

2. Start wallet UI:

   ```bash
   cd demo/wallet
   npm install
   npm run dev
   ```

3. In wallet (`http://localhost:3001`):
   - Switch to `Snap` mode
   - Click `Connect MetaMask Snap`
   - Approve prompts in MetaMask Flask
   - Copy displayed full public key

4. Install Kernel + module with snap public key:

   ```bash
   cd /Users/rossnkama/Developer/multivm-labs/account_abstraction
   ./demo/setup.sh --snap-pubkey 0x<copied_3904_hex_chars>
   ```

5. Start dapp and send test tx:

   ```bash
   cd demo/dapp
   npm install
   npm run dev
   ```

6. Open `http://localhost:3000`, pair WalletConnect, send tx, approve in wallet + snap.

## Config: basic-web-wallet

1. Setup with local generated keypair:

   ```bash
   ./demo/setup.sh
   ```

2. Start wallet + dapp:

   ```bash
   cd demo/wallet && npm install && npm run dev
   # new terminal
   cd demo/dapp && npm install && npm run dev
   ```

3. Load seed into wallet UI from generated file:

   ```bash
   xxd -p demo/.keys/sk.bin | tr -d '\n'
   ```

4. Paste seed in wallet UI (`Seed` mode), pair WalletConnect, send tx.

## Config: cli-e2e

Run full scripted integration test:

```bash
./scripts/e2e-test.sh
```

This deploys Kernel infra, installs PQ validator, signs/submits UserOps, and checks receipts.

## Common Issues

- `EntryPoint ... has no code`
  - `./scripts/dev-stack.sh` is not running anymore.

- `Fetching local snaps is disabled`
  - Enable localhost/local snaps in MetaMask Flask settings, then retry connect.

- Wallet shows signer not ready
  - `snap`: reconnect snap and ensure `pq-snap` server is live on `8080`.
  - `basic-web-wallet`: re-paste a valid 32-byte seed hex.

## Related Docs

- Snap details: `pq-snap/README.md`
- Demo app details: `demo/README.md`
- Stack internals: `scripts/README.md`
