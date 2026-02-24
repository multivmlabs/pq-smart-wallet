# Post-Quantum Smart Account Module: Design Document

<!--toc:start-->
- [Post-Quantum Smart Account Module: Design Document](#post-quantum-smart-account-module-design-document)
  - [1. Overview](#1-overview)
    - [What We're Building](#what-were-building)
    - [Why Now](#why-now)
  - [2. Goals & Constraints](#2-goals-constraints)
    - [Primary Goals](#primary-goals)
    - [Hard Constraints](#hard-constraints)
    - [Success Criteria](#success-criteria)
  - [3. Design Decisions](#3-design-decisions)
    - [3.1 Platform Selection](#31-platform-selection)
    - [3.2 Signature Scheme Selection](#32-signature-scheme-selection)
    - [3.3 Architecture Pattern](#33-architecture-pattern)
    - [3.4 Smart Account Selection](#34-smart-account-selection)
  - [4. Architecture](#4-architecture)
    - [4.1 Component Overview](#41-component-overview)
    - [4.2 End-to-End Flow](#42-end-to-end-flow)
      - [Setup: Account Creation & Module Installation](#setup-account-creation-module-installation)
      - [Transaction: PQ-Secured UserOp Flow](#transaction-pq-secured-userop-flow)
      - [What a dApp Integration Looks Like](#what-a-dapp-integration-looks-like)
    - [4.3 Gas Cost Breakdown (Measured)](#43-gas-cost-breakdown-measured)
    - [4.4 Security Boundaries](#44-security-boundaries)
      - [What the ML-DSA signature protects](#what-the-ml-dsa-signature-protects)
      - [What it does NOT protect](#what-it-does-not-protect)
      - [Key nuances](#key-nuances)
      - [Honest value proposition](#honest-value-proposition)
    - [4.5 Wallet Integration](#45-wallet-integration)
      - [Client-Side ML-DSA Library](#client-side-ml-dsa-library)
      - [Integration Approaches](#integration-approaches)
      - [Recommended Phased Strategy](#recommended-phased-strategy)
      - [Hardware Wallet Status](#hardware-wallet-status)
  - [5. Implementation Status](#5-implementation-status)
    - [Phase 1: Proof of Concept — COMPLETE](#phase-1-proof-of-concept-complete)
    - [Phase 2: Core Development — COMPLETE (MVP)](#phase-2-core-development-complete-mvp)
    - [Phase 3: Production Readiness — NOT STARTED](#phase-3-production-readiness-not-started)
  - [6. Risks & Mitigations](#6-risks-mitigations)
    - [Validated (no longer risks)](#validated-no-longer-risks)
    - [Active Risks](#active-risks)
  - [7. Why This Design Works](#7-why-this-design-works)
    - [Meets All Constraints (Validated)](#meets-all-constraints-validated)
    - [Uses Best Available Technology](#uses-best-available-technology)
    - [Gradual Migration Path](#gradual-migration-path)
  - [8. Success Metrics](#8-success-metrics)
  - [9. Conclusion](#9-conclusion)
  - [Appendix A: Implementation Reference](#appendix-a-implementation-reference)
    - [A.1 ML-DSA Library Selection](#a1-ml-dsa-library-selection)
    - [A.2 Stylus Platform Gotchas](#a2-stylus-platform-gotchas)
    - [A.3 Kernel v3 Integration Patterns](#a3-kernel-v3-integration-patterns)
    - [A.4 Forge & Cast Tooling Workarounds](#a4-forge-cast-tooling-workarounds)
    - [A.5 Cargo Configuration for Stylus](#a5-cargo-configuration-for-stylus)
    - [A.6 EVM ↔ Stylus Interop Measurements](#a6-evm-stylus-interop-measurements)
    - [A.7 Gas Cost Reference](#a7-gas-cost-reference)
    - [A.8 Local Development Stack](#a8-local-development-stack)
    - [A.9 Off-Chain CLI Tools](#a9-off-chain-cli-tools)
    - [A.10 Testing Patterns](#a10-testing-patterns)
    - [A.11 Troubleshooting Quick Reference](#a11-troubleshooting-quick-reference)
<!--toc:end-->

**A quantum-resistant account abstraction validator using existing EVM infrastructure**

---

## 1. Overview

### What We're Building

A post-quantum secure validator module for EVM smart accounts that protects high-value assets against future quantum computing threats while maintaining full compatibility with existing Ethereum infrastructure.

**Key Properties:**

- Drop-in ERC-7579 validator module for existing smart accounts
- Uses NIST-standardized ML-DSA (Dilithium) signatures
- Deploys on Arbitrum Stylus for cost efficiency
- Full ERC-4337 bundler/paymaster compatibility
- No protocol changes, no new chains, no hard forks

### Why Now

- NIST finalized post-quantum standards (August 2024)
- 10-15 year timeline until quantum threat becomes real
- Institutional demand for future-proof custody solutions
- Account abstraction infrastructure is production-ready (40M+ accounts)
- Arbitrum Stylus makes PQ verification economically viable

---

## 2. Goals & Constraints

### Primary Goals

1. **Quantum Resistance**: Protect against Cryptographically Relevant Quantum Computers (CRQCs)
2. **EVM Compatibility**: Work seamlessly with all EVM chains and existing wallets
3. **Cost Efficiency**: Keep transaction costs practical (<$10 per transaction)
4. **Standards Compliance**: Use NIST standards and ERC specifications

### Hard Constraints

✅ **Must use existing chains** - No custom L1/L2, no hard forks  
✅ **Must be EVM-compatible** - Cannot ostracize EVM users  
✅ **Must support ERC-4337** - Works with existing bundler infrastructure  
✅ **Must support ERC-7579** - Compatible with modular account standard  
✅ **Must be production-ready** - No experimental platforms  

### Success Criteria

- Transaction cost: <$10 per operation
- Verification gas: <1M gas on chosen L2
- Module compatibility: Works with Safe, Kernel, Nexus, Biconomy
- Timeline: Production-ready in 12 weeks
- Security: NIST-compliant cryptography, audited implementation

---

## 3. Design Decisions

### 3.1 Platform Selection

**Decision: Arbitrum Stylus on Arbitrum One**

| Platform | EVM Compat | Cost/Tx | Rust Support | ERC-4337/7579 | Verdict |
|----------|-----------|---------|--------------|---------------|---------|
| **Arbitrum Stylus** | ✅ Full | **$2-5** | ✅ Native | ✅ Yes | **SELECTED** |
| Optimism | ✅ Full | $8-10 | ❌ No | ✅ Yes | Fallback |
| zkSync Era | ⚠️ Custom VM | $4-6 | ⚠️ Limited | ✅ Native AA | Considered |
| StarkNet | ❌ Cairo only | $3-5 | ❌ No | ✅ Native AA | Rejected |
| Ethereum L1 | ✅ Full | $150-400 | ❌ No | ✅ Yes | Too expensive |
| Custom L2 | ✅ Possible | Variable | ✅ Possible | ✅ Possible | Too much work |

**Rationale:**

- **Native Rust contracts** via WASM allow direct use of post-quantum cryptography libraries
- **100x cost reduction** vs Ethereum L1 makes PQ verification economically viable
- **Full EVM interoperability** - Stylus contracts can be called from Solidity and vice versa
- **Production maturity** - Live on Arbitrum One since September 2024, security audited
- **ERC-4337/7579 compatible** - Works with all existing AA infrastructure without modification

**Alternatives Considered:**

- **Optimism/Base**: Pure Solidity implementation possible but 3-5x more expensive than Stylus
- **zkSync Era**: Native AA is attractive but limited Rust support and custom VM
- **StarkNet**: Excellent AA but requires Cairo (different ecosystem, no EVM compatibility)
- **Custom L2**: Maximum flexibility but 6-12 month timeline and ongoing maintenance burden

### 3.2 Signature Scheme Selection

**Decision: ML-DSA-65 (Dilithium Level 3)**

| Scheme | Signature Size | Security | Gas Cost | Maturity | Verdict |
|--------|---------------|----------|----------|----------|---------|
| **ML-DSA-65** | 3,309 B | Level 3 (192-bit) | **200K-500K** | ✅ FIPS 204 | **SELECTED** |
| ML-DSA-44 | 2,420 B | Level 2 (128-bit) | 150K-300K | ✅ FIPS 204 | Lower security |
| ML-DSA-87 | 4,595 B | Level 5 (256-bit) | 300K-800K | ✅ FIPS 204 | Overkill |
| SLH-DSA | 7,856+ B | Various | 3M-30M | ✅ FIPS 205 | Too expensive |
| Falcon-512 | 666 B | Level 1 | 100K-200K | ⚠️ Draft | Not standardized |

**Rationale:**

- **NIST FIPS 204 standard** - Regulatory compliant, peer-reviewed, finalized
- **Best balance** - Strong security (192-bit) at reasonable cost ($2-5 per transaction)
- **Mature implementation** - `ml-dsa` crate (RustCrypto) selected after evaluating 10 crates. Compiles to `wasm32-unknown-unknown`, passes NIST ACVP vectors. See `thoughts/shared/research/ml-dsa-library-comparison.md`
- **Lattice-based** - Well-studied security assumptions, faster than hash-based schemes
- **Middle ground** - Not overkill like Level 5, not too weak like Level 2

**Alternatives Considered:**

- **SLH-DSA (SPHINCS+)**: More conservative (hash-based) security but 10-100x more expensive
- **Falcon**: Smaller signatures but complex implementation and not yet standardized (FIPS 206 pending)
- **Hybrid (ECDSA + ML-DSA)**: Considered for transition period but adds complexity

### 3.3 Architecture Pattern

**Decision: ERC-7579 Validator Module**

**Rationale:**

- **Modularity** - Plug-and-play with existing smart accounts (Safe, Kernel, Nexus, Biconomy)
- **Standardization** - ERC-7579 adopted by all major account abstraction projects
- **Upgradeability** - Users can switch PQ schemes without redeploying accounts
- **Interoperability** - Works across different account implementations
- **Separation of concerns** - PQ verification logic isolated from account logic

**Alternatives Considered:**

- **Core account implementation**: Would require users to deploy new accounts (poor UX)
- **Precompile approach**: Would require protocol changes (violates "no hard fork" constraint)
- **Paymaster-based**: Wrong layer - should be in validation, not execution

### 3.4 Smart Account Selection

**Decision: ZeroDev Kernel v3**

| Account | ERC-7579 | Non-Root Validators | Maturity | Verdict |
|---------|----------|---------------------|----------|---------|
| **Kernel v3** | ✅ Native | ✅ Full support | ✅ Production | **SELECTED** |
| Safe + 7579 adapter | ⚠️ Via adapter | ⚠️ Limited | ✅ Battle-tested | Adapter adds complexity |
| Nexus (Biconomy) | ✅ Native | ✅ Yes | ⚠️ Newer | Less ecosystem tooling |

**Rationale:**

- **ERC-7579 native** — no adapter layer, validators are first-class citizens
- **Non-root validator support** — PQ module can validate specific selectors without replacing the root ECDSA key. Users keep their existing key for day-to-day operations and upgrade specific high-value interactions to PQ
- **Proxy pattern (ERC-1967)** — each account is only 61 bytes of proxy code, sharing a single Kernel implementation contract
- **E2E validated** — Full pipeline proven on local devnode (2026-02-15). See `thoughts/shared/research/kernel-local-deployment-assessment.md`

**Key implementation detail:** Non-root validators in Kernel require three things to function: (a) the module is installed with `installModule`, (b) selector access is granted via `grantAccess()` for each function the validator may authorize, and (c) the UserOp nonce encodes the validation type and validator address correctly.

---

## 4. Architecture

### 4.1 Component Overview

The system has three layers: off-chain signing tools, on-chain smart account infrastructure, and the Stylus verification backend. All components are validated end-to-end on a local Nitro devnode (2026-02-15).

```
                        OFF-CHAIN
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │  pq-keygen   │    │  ML-DSA Key  │                   │
│  │  (one-time)  │───▶│  Storage     │                   │
│  └──────────────┘    │  sk: 4,032 B │                   │
│                      │  pk: 1,952 B │                   │
│                      └──────┬───────┘                   │
│                             │ sk                        │
│  ┌──────────────┐    ┌──────▼───────┐                   │
│  │ dApp / Wallet│───▶│   pq-sign    │                   │
│  │ constructs   │    │  signs hash  │                   │
│  │ UserOp       │    │  sig: 3,309B │                   │
│  └──────────────┘    └──────┬───────┘                   │
│                             │ UserOp + sig              │
└─────────────────────────────┼───────────────────────────┘
                              ▼
                        ON-CHAIN
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ┌─────────────────────────────────────────────┐        │
│  │          ERC-4337 Bundler (Alto)             │        │
│  │  - Receives signed UserOp via JSON-RPC      │        │
│  │  - Simulates validation (eth_call)          │        │
│  │  - Batches and submits handleOps()          │        │
│  └──────────────────┬──────────────────────────┘        │
│                     │ handleOps()                        │
│                     ▼                                    │
│  ┌─────────────────────────────────────────────┐        │
│  │      EntryPoint v0.7 (Singleton)            │        │
│  │  - Computes userOpHash                      │        │
│  │  - Calls account.validateUserOp()           │        │
│  │  - If valid → executes calldata             │        │
│  └──────────────────┬──────────────────────────┘        │
│                     │ validateUserOp(op, hash)           │
│                     ▼                                    │
│  ┌─────────────────────────────────────────────┐        │
│  │       Kernel v3 Smart Account               │        │
│  │  - ERC-1967 proxy (61 bytes)                │        │
│  │  - Reads nonce → routes to validator        │        │
│  │  - Root: ECDSA (day-to-day)                 │        │
│  │  - Non-root: PQ Validator (PQ-secured ops)  │        │
│  └──────────────────┬──────────────────────────┘        │
│                     │ validateUserOp(op, hash)           │
│                     ▼                                    │
│  ┌─────────────────────────────────────────────┐        │
│  │    PQ Validator Module (Solidity)            │        │
│  │  - ERC-7579 IERC7579Validator               │        │
│  │  - Stores ML-DSA public key per account     │        │
│  │  - Calls Stylus verifier                    │        │
│  └──────────────────┬──────────────────────────┘        │
│                     │ verify(pk, hash, sig)              │
│                     ▼                                    │
│  ┌─────────────────────────────────────────────┐        │
│  │  ML-DSA Verifier (Rust/WASM — Stylus)       │        │
│  │  - Pure Rust, ml-dsa crate (RustCrypto)     │        │
│  │  - ML-DSA-65 verification (FIPS 204)        │        │
│  │  - Returns true/false                       │        │
│  │  - 374K gas measured                        │        │
│  └─────────────────────────────────────────────┘        │
│                                                         │
│  If verification passes:                                │
│  EntryPoint executes UserOp calldata                    │
│  (e.g. token transfer, DeFi interaction, etc.)          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.2 End-to-End Flow

The system supports two interaction models: **setup** (one-time account creation) and **transaction** (ongoing PQ-secured operations).

#### Setup: Account Creation & Module Installation

This is performed once per user. The root ECDSA key handles setup; PQ security kicks in for subsequent operations.

```
1. Generate ML-DSA-65 keypair
   $ pq-keygen --output keys/
   → sk.bin (4,032 bytes), pk.bin (1,952 bytes)

2. Deploy Kernel smart account via KernelFactory
   → Account address is deterministic (CREATE2)
   → Root validator: ECDSA (existing key)

3. Install PQ Validator Module (ECDSA-signed UserOp)
   Kernel.installModule(TYPE_VALIDATOR, pqValidatorAddr, initData)
   → initData contains ML-DSA public key (1,952 bytes)
   → Module stores: publicKeys[accountAddr] = pk
   → Gas: ~1,570,000

4. Grant selector access (ECDSA-signed UserOp)
   Kernel.grantAccess(pqValidationId, execute.selector, true)
   → Whitelists which functions the PQ validator can authorize
   → Gas: ~346,000
```

#### Transaction: PQ-Secured UserOp Flow

This is the per-transaction flow. A dApp constructs the intent, the user signs with ML-DSA, and the system verifies on-chain.

```
 Step  │ Actor              │ Action
───────┼────────────────────┼─────────────────────────────────────────
  1    │ dApp               │ Constructs UserOp calldata (e.g. swap,
       │                    │ transfer, governance vote)
       │                    │
  2    │ dApp / Wallet      │ Fills UserOp fields:
       │                    │   sender:    Kernel account address
       │                    │   nonce:     PQ validator nonce*
       │                    │   callData:  encoded dApp interaction
       │                    │   gas fields: verificationGasLimit ≥ 2M
       │                    │
  3    │ EntryPoint (query) │ getUserOpHash(userOp) → userOpHash
       │                    │   = keccak256(pack(userOp), entryPoint, chainId)
       │                    │
  4    │ User (off-chain)   │ Signs userOpHash with ML-DSA private key
       │                    │   $ pq-sign --key sk.bin --hash <userOpHash>
       │                    │   → 3,309 byte signature
       │                    │
  5    │ Bundler            │ Receives signed UserOp via eth_sendUserOperation
       │                    │ Simulates validation → accepts into mempool
       │                    │
  6    │ Bundler            │ Calls EntryPoint.handleOps([userOp], beneficiary)
       │                    │
  7    │ EntryPoint         │ Calls Kernel.validateUserOp(userOp, userOpHash)
       │                    │
  8    │ Kernel             │ Reads nonce → identifies PQ validator (non-root)
       │                    │ Checks selector whitelist
       │                    │ Delegates to PQValidatorModule.validateUserOp()
       │                    │
  9    │ PQ Validator       │ Loads publicKeys[accountAddr] (1,952 bytes)
       │                    │ Calls Stylus: verify(pk, userOpHash, sig)
       │                    │
  10   │ Stylus Verifier    │ ML-DSA-65 verification (FIPS 204)
       │                    │ Returns true/false (374K gas)
       │                    │
  11   │ EntryPoint         │ If valid → executes UserOp calldata
       │                    │ dApp interaction completes on-chain
```

*\*PQ validator nonce encoding: `uint192 = (0x01 << 176) | (uint160(validatorAddr) << 16)` — the `0x01` marks non-root validation, and the validator address routes to the PQ module.*

#### What a dApp Integration Looks Like

From a dApp's perspective, PQ-secured transactions are transparent. The dApp constructs its intent (swap, transfer, stake) as normal calldata. The only difference is the signing step and UserOp nonce encoding:

```
// dApp constructs a normal interaction
const callData = kernel.interface.encodeFunctionData("execute", [
    targetContract,     // e.g. Uniswap router
    value,              // ETH value
    swapCalldata        // e.g. swapExactTokensForTokens(...)
]);

// UserOp uses PQ nonce + ML-DSA signature instead of ECDSA
const userOp = {
    sender: kernelAccountAddress,
    nonce: pqValidatorNonce,        // ← encodes PQ validator
    callData: callData,             // ← standard dApp intent
    signature: mlDsaSignature,      // ← 3,309 bytes (vs 65 for ECDSA)
    verificationGasLimit: 2_000_000 // ← higher for ML-DSA
};
```

The dApp target contract (Uniswap, Aave, etc.) sees a normal `msg.sender` — it has no idea the transaction was PQ-verified. This is the power of the ERC-4337 + ERC-7579 abstraction.

### 4.3 Gas Cost Breakdown (Measured)

Gas costs measured on local Nitro devnode (2026-02-15). L1 data costs are zeroed locally; real L1 costs will be measured on Arbitrum Sepolia (Exercise 3.3).

```
Component                          Gas (Measured)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ML-DSA verification (Stylus)       374,000
Kernel routing + module dispatch   ~377,000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PQ UserOp total (ETH transfer)     751,312

For comparison:
ECDSA UserOp (same operation)      202,816
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PQ overhead vs ECDSA               ~548,500 (3.7x)
```

**One-time setup costs:**

| Operation | Gas |
|-----------|-----|
| Install PQ validator module | ~1,570,000 |
| Grant selector access | ~346,000 |

**Cost projections (Arbitrum mainnet, estimates):**

| Component | Estimate | Notes |
|-----------|----------|-------|
| L2 execution (751K gas) | ~$0.04 | At 0.05 gwei L2 gas price |
| L1 data posting (~5.5 KB calldata) | $2-8 | Dominates cost; depends on L1 gas price |
| **Total per PQ transaction** | **$2-8** | Within $10 target |

**Key insight:** L2 execution cost is negligible. The dominant expense is L1 data posting due to the 3,309-byte ML-DSA signature (vs 65 bytes for ECDSA). This is an inherent trade-off of post-quantum security.

### 4.4 Security Boundaries

PQ AA protects the **control plane** of the smart account — who can authorize transactions. It does NOT protect the **data plane** — the protocols, tokens, and infrastructure the account interacts with.

#### What the ML-DSA signature protects

The `userOpHash` binds `sender`, `nonce`, `callData`, `gasFees`, `chainId`, and `entryPoint`. A quantum attacker **cannot** forge, modify, or replay any signed UserOp. The signing authority over the account is quantum-safe.

```
PROTECTED (account control layer):
  ✅ Transaction authorization — nobody moves assets without ML-DSA signature
  ✅ Module management — validator installs/swaps require owner signature
  ✅ Targeted account takeover — Shor's algorithm cannot derive ML-DSA keys
  ✅ Replay attacks — nonce + chainId + entryPoint binding prevents replay
  ✅ Gradual migration — non-root validator enables per-selector PQ upgrade
```

#### What it does NOT protect

```
NOT PROTECTED (ecosystem around the account):
  ❌ DeFi protocol governance — ECDSA admin keys on Aave, Uniswap, etc.
  ❌ Token contract integrity — ECDSA proxy admins (e.g. Circle's USDC multisig)
  ❌ Bridge custody — ECDSA multisigs securing locked assets
  ❌ L1 consensus — BLS validator signatures (quantum-vulnerable)
  ❌ Mixed multisigs — if other signers use ECDSA, threshold is breakable
```

**Analogy:** PQ AA is a quantum-proof vault door in an ECDSA building. Assets *inside* your account cannot be moved without your ML-DSA signature. But if the token contract itself is compromised (e.g., attacker breaks Circle's ECDSA keys and mints infinite USDC), the tokens in your vault lose value regardless.

#### Key nuances

**1. Protocol governance is the real weak link.** Most DeFi protocols have ECDSA-secured admin keys (multisigs, proxy admins). A quantum attacker doesn't need YOUR key — they need the *protocol's* keys to drain pools, upgrade contracts, or freeze balances.

**2. L1 consensus is quantum-vulnerable.** Ethereum PoS uses BLS signatures (BLS12-381) for validator attestations. If enough validator BLS keys are broken, the chain itself can be reorged — making PQ-signed transactions revertible. The Ethereum Foundation formed a dedicated PQ team (Jan 2026, $2M funding) but protocol-level PQ is years away.

**3. The bundler's ECDSA is irrelevant.** The bundler signs the *outer transaction* with ECDSA but has zero authority over account funds. A compromised bundler key can only waste gas (DoS), not forge UserOps — EntryPoint validates the ML-DSA signature independently.

**4. Old allowances require cleanup.** Pre-migration `approve()` calls created on-chain state that persists. The quantum risk isn't the old signature — it's whether the *spender contract* has ECDSA admin keys. Mitigation: revoke all allowances post-migration via PQ-signed transactions.

**5. ERC-7579 modularity IS the migration strategy.** If ML-DSA is broken, swap the validator module to SLH-DSA or a future scheme — the account and all positions survive. If Ethereum does a protocol-level PQ upgrade, the module adapts. The modularity provides algorithm agility, not just convenience.

#### Honest value proposition

**PQ AA provides:** Quantum-resistant transaction signing — insurance against personal account takeover via quantum key derivation (Shor's algorithm on ECDSA).

**PQ AA does NOT provide:** Comprehensive quantum security for the entire blockchain ecosystem.

**Target users:** High-value holders ($10M+, 5-10yr horizon), institutions with compliance mandates (NIST FIPS 204), long-term custody where Q-Day timeline uncertainty (20% chance by 2030 per Vitalik Buterin) justifies the premium.

### 4.5 Wallet Integration

The on-chain stack (Kernel + PQ Validator + Stylus verifier) is signature-scheme agnostic — ERC-7579's `validateUserOp` accepts arbitrary bytes. The wallet's only job is:

1. Construct UserOp with correct nonce encoding: `(0x01 << 176) | (validatorAddr << 16)`
2. Sign `userOpHash` with ML-DSA private key → 3,309-byte signature
3. Submit to bundler with `verificationGasLimit >= 2M`

#### Client-Side ML-DSA Library

**Selected: `@noble/post-quantum`** ([GitHub](https://github.com/paulmillr/noble-post-quantum))

| Property | Value |
|----------|-------|
| Type | Pure JavaScript (no native bindings) |
| Bundle size | 16 KB gzipped (entire library) |
| ML-DSA-65 signing | ~4ms (Apple M4) |
| ML-DSA-65 keygen | ~2ms |
| Dependencies | `@noble/hashes`, `@noble/curves` (pure JS) |
| Browser/Snap compatible | Yes — only needs `crypto.getRandomValues()` |
| FIPS 204 compliant | Yes (ML-DSA, not pre-standard Dilithium) |
| Audit status | Not independently audited (author: Paul Miller, also maintains `@noble/secp256k1`) |

**Alternatives evaluated:**

| Library | Type | FIPS 204 | Production Ready | Notes |
|---------|------|----------|-----------------|-------|
| `@noble/post-quantum` | Pure JS | Yes | Yes (pending audit) | **Selected** — smallest, fastest pure JS, Snap-compatible |
| `dilithium-crystals-js` | WASM | Unclear | No | Pre-standard Dilithium, WASM loading complexity |
| `pqc.js` (Dashlane) | WASM+JS | Unclear | No | WASM fallback support, but unclear FIPS 204 update |
| `liboqs-node` | WASM | Yes | No | Explicitly "not production-ready" per maintainers |
| Rust `ml-dsa` → wasm-pack | Custom WASM | Yes | DIY | Code reuse with Stylus verifier, but build complexity |

#### Integration Approaches

**Approach 1: SDK + Manual UserOps (Recommended for MVP)**

Fastest path to a working demo. Use `permissionless.js` (viem-based) with a custom `LocalAccount` signer, bypassing the SDK's ECDSA-specific Kernel helpers to construct UserOps manually with PQ nonce encoding.

```
dApp frontend
  → @noble/post-quantum (ML-DSA signing in browser)
  → Manual UserOp construction (custom nonce encoding)
  → bundlerClient.sendUserOperation()
  → Bundler → EntryPoint → Kernel → PQ Validator → Stylus
```

- Dev effort: 2-4 weeks
- User friction: Low (signing embedded in dApp)
- Nonce control: Full (manual construction)
- Production ready: Yes
- Limitation: Keys live in browser — acceptable for demo, not for production custody

**Approach 2: MetaMask Snap (Target for production UX)**

Lowest user friction (500M+ MetaMask installs). Uses the ERC-4337 Keyring API to add "Quantum Accounts" alongside regular MetaMask accounts. Snap stores ML-DSA keys in encrypted state and signs UserOps via `eth_signUserOperation`.

```
dApp → MetaMask UI → Snap (ML-DSA signing)
  → MetaMask submits UserOp to bundler
  → Bundler → EntryPoint → Kernel → PQ Validator → Stylus
```

- Dev effort: 4-6 weeks
- User friction: Lowest (Snap install prompt)
- Production ready: **No** — two blockers:

| Blocker | Risk | Details |
|---------|------|---------|
| ERC-4337 Keyring API maturity | High | Still Flask-only (experimental), not in mainnet MetaMask. No public timeline for stable release. |
| Execution timeout | Medium | Snaps have undocumented timeout. ML-DSA signing (~4ms native, potentially 8-40ms in SES sandbox) may exceed limit. [Open issue #1604](https://github.com/MetaMask/snaps/issues/1604) — unresolved as of Feb 2026. |
| Non-root nonce encoding | Medium | Unclear if `eth_prepareUserOperation` allows custom nonce format for Kernel's non-root validators. Needs empirical testing on Flask. |

**Approach 3: Custom Browser Extension**

Full control over signing, nonce encoding, and UX. Fork an open-source Manifest V3 wallet, add ML-DSA signing module.

- Dev effort: 8-12 weeks
- User friction: Medium (new extension install)
- Nonce control: Full
- Risk: Chrome Web Store review process (weeks to months), distribution trust barrier

**Approach 4: Mobile App + WalletConnect v2**

React Native app with on-device ML-DSA key storage (Keychain/Keystore). Connects to dApps via WalletConnect QR flow.

- Dev effort: 12-16 weeks
- User friction: Medium (new app install)
- Nonce control: Full
- Mobile support: Only option that supports mobile
- Requires: WalletConnect SDK integration, full wallet UX

#### Recommended Phased Strategy

| Phase | Approach | Timeline | Purpose |
|-------|----------|----------|---------|
| 1 (MVP) | SDK + manual UserOps | 2-4 weeks | Prove client-side flow, demo on Sepolia |
| 2 (Test) | Minimal Flask Snap | 1 week | Test timeout + nonce encoding blockers |
| 3 (Production) | Snap (if blockers pass) OR custom extension (if blocked) | 4-8 weeks | Production wallet for users |
| 4 (Future) | Mobile app + hardware wallet integration | 12+ weeks | Expand to mobile, wait for Ledger/Trezor PQ support |

The signing logic (`@noble/post-quantum` + UserOp construction) is portable across all approaches — build it once in Phase 1, reuse in Phases 2-4.

#### Hardware Wallet Status

No hardware wallet currently supports ML-DSA transaction signing. Trezor Safe 7 (Jan 2025) uses SLH-DSA-128 internally for firmware verification, but NOT for user signatures. Ledger and GridPlus have no public PQ roadmaps. Realistic timeline: 2027+ for hardware ML-DSA signing.

---

## 5. Implementation Status

### Phase 1: Proof of Concept — COMPLETE

**Completed 2026-02-11.** Validated technical feasibility and cost model.

**Delivered:**

- Stylus ML-DSA verifier deployed to local Nitro devnode
- Gas cost measured: 374K (under 500K budget)
- NIST ACVP test vectors pass via `ml-dsa` crate
- Off-chain CLI tools: `pq-keygen`, `pq-sign`, `pq-verify`
- Library evaluation: 10 crates assessed, `ml-dsa` (RustCrypto) selected

### Phase 2: Core Development — COMPLETE (MVP)

**Completed 2026-02-15.** Full E2E pipeline validated on local devnode.

**Delivered:**

- ERC-7579 validator module (`evm/src/PQValidatorModule.sol`) — 13/13 Foundry tests
- Stylus ML-DSA verifier (`pq-validator/src/lib.rs`) — deployed and verified
- Kernel v3 integration — account creation, module installation, UserOp execution
- Alto bundler integration — both direct submission and bundler-mediated flow
- UserOp v0.7 hash computation matching EntryPoint spec
- Dev stack automation (`scripts/dev-stack.sh`)

**Key reference:** `thoughts/shared/research/kernel-local-deployment-assessment.md` documents the full E2E spike with all bugs encountered and fixed.

**Deferred from MVP:**

| Item | Reason |
|------|--------|
| Arbitrum Sepolia deployment | Blocked on L1 data cost measurement (Exercise 3.3) |
| Multi-level ML-DSA (44/65/87) | Not needed for MVP, planned for Phase 3 |
| ModuleKit test harness | E2E spike covers integration validation |

### Phase 3: Production Readiness — NOT STARTED

**Goal:** Arbitrum Sepolia deployment, real gas benchmarking, security review, wallet integration.

**Remaining work:**

| Exercise | Description | Priority |
|----------|-------------|----------|
| 3.3 | Sepolia deployment + L1 data cost benchmarking | High |
| 4.1 | Gas optimization (Stylus `opt-level`, storage patterns) | Medium |
| 4.2 | Multi-level ML-DSA support (44/65/87) | Low |
| 4.3 | Security review (Slither, fuzz testing, threat model) | High (pre-mainnet) |
| 4.4 | Wallet integration (MetaMask Snap prototype) | High |

**Critical unknown:** Bundler simulation of Stylus calls. Production bundlers simulate `validateUserOp` via `eth_call`. If their node lacks Stylus WASM support, simulation fails and UserOps are rejected. This must be tested on Sepolia with a real bundler (Exercise 3.3). See Section 6.

But Pimlico claims to support stylus btw, just need to test this
---

## 6. Risks & Mitigations

### Validated (no longer risks)

| Original Risk | Resolution |
|---------------|------------|
| Gas costs higher than estimated | Measured: 374K Stylus verify, 751K total UserOp. Under 500K budget for verification, within $10 total target. |
| EVM↔Stylus interop doesn't work | Cross-runtime calls validated. ~46K gas overhead for context switch. Standard ABI encoding, no special handling. |
| Kernel integration complexity | Full E2E proven. Non-root validators work with correct nonce encoding + selector grants. |

### Active Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Bundler Stylus simulation** | High (70%) | High | Production bundlers simulate `validateUserOp` via `eth_call`. If their node lacks WASM support, UserOps are rejected. Must test with Pimlico/Alchemy on Sepolia. If blocked: run own bundler with Nitro node. |
| **ERC-7562 storage access rules** | Medium (40%) | Medium | PQ validator reads `publicKeys[msg.sender]` — validator-owned storage keyed by sender. Should qualify as "associated storage" under ERC-7562, but bundlers vary in strictness. May need to stake the validator with EntryPoint. |
| **L1 data cost exceeds $10 target** | Medium (30%) | Medium | 3,309-byte signature = ~50x ECDSA L1 data cost. At high L1 gas prices, could push past $10. Mitigation: calldata compression, or accept higher cost for PQ security as a premium feature. |
| **Stylus contract reactivation** | Low (10%) | High | Contracts become inert after 365 days or ArbOS upgrades. Build monitoring + automated reactivation into deployment pipeline. |
| **ML-DSA algorithm break** | Low (5%) | Critical | ERC-7579 module swap — replace PQ validator with SLH-DSA or future scheme without redeploying account. |
| **Smart contract vulnerability** | Medium (15%) | High | Professional audit + fuzz testing (Exercise 4.3). Minimal Stylus contract surface (verify-only). |
| **Stylus SDK bugs** | Low (10%) | Medium | SDK pinned to v0.10.0. OpenZeppelin audit found 2 Critical + 2 High (Aug 2024). Keep Stylus contract minimal (single `verify` function). |

---

## 7. Why This Design Works

### Meets All Constraints (Validated)

| Constraint | Status | Evidence |
|------------|--------|----------|
| No new chain | ✅ Proven | Runs on standard Arbitrum Nitro (devnode validated, Sepolia/mainnet next) |
| EVM compatible | ✅ Proven | Solidity ↔ Stylus interop works via standard ABI calls |
| ERC-4337 compatible | ✅ Proven | UserOps flow through EntryPoint v0.7 + Alto bundler |
| ERC-7579 compatible | ✅ Proven | Module installs/uninstalls on Kernel v3, validates UserOps |
| Cost efficient | ✅ Projected | L2 execution ~$0.04, total $2-8 depending on L1 gas (within $10 target) |
| Verification < 500K gas | ✅ Measured | 374K gas for ML-DSA-65 verification on Stylus |

### Uses Best Available Technology

- **ML-DSA (ml-dsa crate)**: NIST FIPS 204, RustCrypto ecosystem, passes ACVP vectors, compiles to WASM
- **Arbitrum Stylus**: Only production platform with native Rust/WASM for EVM-compatible crypto
- **Kernel v3**: ERC-7579 native, non-root validators enable gradual PQ migration per-selector
- **ERC-4337 v0.7**: Latest standard, packed UserOp format, canonical EntryPoint

### Gradual Migration Path

The non-root validator architecture means users don't need to abandon ECDSA:

1. **Day 1**: Create Kernel account with ECDSA root validator (normal UX)
2. **Upgrade**: Install PQ validator module, grant access to high-value selectors
3. **Selective PQ**: Low-value ops use ECDSA (cheap, fast), high-value ops use ML-DSA (quantum-safe)
4. **Full PQ**: Eventually make PQ validator the root validator (when tooling matures)

This eliminates the "rip and replace" problem that blocks most PQ migration efforts.

---

## 8. Success Metrics

**Technical (MVP — validated):**

- ✅ Verification gas < 500K → **374K measured**
- ✅ Transaction cost < $10 → **$2-8 projected** (L1 data cost pending Sepolia measurement)
- ✅ Full E2E UserOp flow → **Working on local devnode**
- ✅ ERC-7579 compliance → **Kernel v3 integration proven**
- ✅ ERC-4337 bundler compatibility → **Alto bundler working**

**Technical (remaining — Phase 3):**

- [ ] Sepolia deployment + real L1 cost measurement
- [ ] Multi-level ML-DSA support (44/65/87)
- [ ] Security audit — zero critical findings
- [ ] Production bundler compatibility (Pimlico/Alchemy)

**Adoption (future):**

- Target: 10+ institutional users in first 6 months
- Target: $100M+ in assets protected by Year 1
- Target: Integration with ≥3 major smart account platforms

**Business:**

- Revenue model: Open source initially, infrastructure services later
- Market: Institutional custody, protocol treasuries, high-value DeFi
- Competition: First-mover advantage (no production PQ AA exists)

---

## 9. Conclusion

This design provides a **practical, validated solution** for post-quantum secure smart accounts. The full pipeline has been proven end-to-end on a local Arbitrum devnode:

1. **Works today** on existing Arbitrum infrastructure — no protocol changes needed
2. **374K gas** for ML-DSA verification on Stylus (under 500K budget)
3. **$2-8 projected** per transaction on Arbitrum mainnet (within $10 target)
4. **Full EVM compatibility** — dApps see a normal `msg.sender`, PQ verification is transparent
5. **Gradual migration** — non-root validators enable per-selector PQ upgrade without abandoning ECDSA
6. **NIST FIPS 204 compliant** — ML-DSA-65 (192-bit post-quantum security)
7. **Modular** — ERC-7579 allows scheme upgrades (e.g., to SLH-DSA) without redeploying accounts

The critical unknown remaining is **production bundler compatibility with Stylus contracts** — this will be validated in the Sepolia deployment phase (Exercise 3.3).

---

**Status:** MVP complete — full E2E validated on local devnode (2026-02-15)
**Next steps:** Arbitrum Sepolia deployment, real L1 cost benchmarking, production bundler testing
**Reference:** `thoughts/shared/research/kernel-local-deployment-assessment.md` for full spike results

---

## Appendix A: Implementation Reference

Hard-won knowledge from Modules 0-3. Consolidates gotchas, workarounds, measurements, and patterns discovered during development.

### A.1 ML-DSA Library Selection

10 Rust crates evaluated. Only 2 compile to `wasm32-unknown-unknown` with `no_std`:

| Crate | WASM Size (gzipped) | Verdict |
|-------|---------------------|---------|
| `ml-dsa` (RustCrypto) | 7.8 KB | **Selected** — faster benchmarks, standard `Verifier` trait, broader contributor base |
| `fips204` (IntegrityChain) | 6.4 KB | Runner-up — simpler API, zero unsafe, slightly smaller |

**Eliminated:**

| Crate | Blocker |
|-------|---------|
| `pqcrypto-dilithium` | C FFI, requires std, only wasm32-wasi |
| `pqc_dilithium` | No no_std support |
| `crystals-dilithium` | Stale (no updates since July 2023) |
| `qp-rusty-crystals-dilithium` | GPL-3.0 license |
| PQClean C → WASM | Needs libc (Stylus has no libc) |

Both viable crates fit comfortably within Stylus's 24KB compressed WASM limit (~16-17 KB headroom).

**Security notes:** `ml-dsa` had GHSA-h37v-hp6w-2pp8 (use_hint bug) fixed in rc.5+. Includes Trail of Bits contributions for side-channel resistance (Barrett reduction). Neither crate has been independently audited, but both pass NIST ACVP test vectors.

**Reference:** `thoughts/shared/research/ml-dsa-library-comparison.md`

### A.2 Stylus Platform Gotchas

**Deployment & activation:**

- Devnode: activation is automatic
- Sepolia/mainnet: explicit activation required after deploy, and reactivation after ArbOS upgrades or every 365 days. Forgetting → verifier silently becomes inert (no error, just fails)
- First deploy on Apple Silicon is slow (Docker x86 emulation for WASM compilation). Use `--no-verify` for faster local iteration

**`cargo stylus new` is broken from crates.io** — panics due to compile-time `CARGO_MANIFEST_DIR` macro losing workspace context. Install from git:

```bash
cargo install --git https://github.com/OffchainLabs/stylus-sdk-rs cargo-stylus --force
```

**Testing framework limitations:**

- Segfaults when using storage mappings (issue #261, open 9+ months)
- Workaround: test outside Stylus framework using integration tests and `vm.mockCall` in Foundry
- `sol_interface!` doesn't support interface inheritance
- ABI generation broken for struct return types

**SDK maintenance is slow:** Open:Closed issue ratio ~0.8:1, 21 of 29 open issues have zero comments. Core maintainers: ~3. Release gap v0.9.0 → v0.10.0: 8 months. Pin versions, don't upgrade unless required.

**Security audit findings:**

| Audit | Date | Key Finding |
|-------|------|-------------|
| OpenZeppelin | Aug 2024 | 2 Critical, 2 High — *"several features are either non-functional or contain bugs"* |
| Trail of Bits | Jun 2024 | WASM memory safety concerns, insufficient test coverage |
| iosiro | Sep 2024 | Trivially exploitable sequencer crash bug ($80K bounty, patched) |

**Mitigation:** Keep Stylus contract minimal (single `verify` function), pin SDK to v0.10.0, test thoroughly outside SDK test framework.

**Reference:** `thoughts/shared/research/stylus-maturity-assessment.md`

### A.3 Kernel v3 Integration Patterns

**Build requirement:** Kernel MUST compile with `via-ir = true` — default Foundry profile produces 29,739 bytes (exceeds EIP-170 24KB limit). Always use `FOUNDRY_PROFILE=deploy`:

```bash
FOUNDRY_PROFILE=deploy forge create ...
```

**Non-root validator setup requires three things:**

1. Module installed: `installModule(1, validatorAddr, initData)`
2. Selector access granted: `grantAccess(validationId, execute.selector, true)`
3. Correct nonce encoding (see below)

Missing step 2 was the most subtle bug in the spike — a valid ML-DSA signature still gets `InvalidValidator()` because the selector isn't whitelisted.

**Nonce encoding for non-root validators:**

```
Byte layout: mode(1B) | vType(1B) | validatorAddr(20B) | key(2B) | seq(8B)

Solidity:    uint192 nonceKey = (0x01 << 176) | (uint160(validatorAddr) << 16);
```

**Critical pitfall:** `(0x01 << 184)` places 0x01 in the mode byte, not the vType byte. This caused AA23 reverts in the spike. The validation type byte sits at bit 176.

**ValidationId encoding:** `bytes21(abi.encodePacked(bytes1(0x01), address(validator)))` — type byte (0x01 = VALIDATOR) concatenated with 20-byte address.

**Nonce isolation:** PQ validator nonce key is independent of root validator. Different validators have separate nonce sequences that don't interfere.

**initData format for module installation:**

```
hookAddress(20 bytes) ++ abi.encode(validatorData, hookData, selectorData)
```

Where `validatorData` = 1,952-byte ML-DSA public key. Pass non-empty `selectorData` during install to avoid a separate `grantAccess` transaction.

**Reference:** `thoughts/shared/research/kernel-local-deployment-assessment.md`

### A.4 Forge & Cast Tooling Workarounds

**Gas estimation fails for `handleOps`:**
`forge script --broadcast` estimates ~143K gas but actually needs 2.5M+. Solution: encode calldata with forge script (dry run), then submit with explicit gas limit:

```bash
forge script script/SendUserOp.s.sol --sig "run()" --rpc-url $RPC    # encode only
cast send $ENTRYPOINT $ENCODED_CALLDATA --gas-limit 3000000 ...      # submit
```

**`cast run` cannot trace Stylus transactions:** Replays locally without WASM support → `OpcodeNotFound`. Use `cast call` for on-chain simulation when debugging Stylus interactions.

**`forge create` dry-run bug:** Sometimes shows "dry run" even with `--broadcast` flag (hit during PQValidatorModule deployment). Workaround: deploy with `cast send --create` instead.

**File I/O in forge scripts:** `vm.writeFile` / `vm.readFileBinary` require explicit `fs_permissions` in `foundry.toml` under `[profile.default]`, NOT under `[profile.deploy]`:

```toml
[profile.default]
fs_permissions = [{ access = "read-write", path = "./" }]
```

### A.5 Cargo Configuration for Stylus

**Critical dependency settings** (`pq-validator/Cargo.toml`):

```toml
ml-dsa = { version = "0.1.0-rc.7", default-features = false, features = ["alloc", "rand_core"] }
```

- `default-features = false` → disables std (Stylus is `no_std`)
- `alloc` → required for `no_std` environments
- `rand_core` → needed for test keypair generation

**Version pin workaround:**

```toml
alloy-tx-macros = "=1.0.38"
```

Pinned because `alloy-tx-macros` 1.6.x generates code for a `TransactionEnvelope` trait that only exists in `alloy-consensus >= 1.6.x`, but `stylus-test` pulls `alloy-consensus 1.0.x`.

**Release profile (mandatory for 24KB WASM limit):**

```toml
[profile.release]
codegen-units = 1      # single codegen unit for better optimization
strip = true           # remove debug symbols
lto = true             # link-time optimization
panic = "abort"        # no stack unwinding (saves space)
opt-level = 3          # max speed (try "s" or "z" for smaller binaries)
```

### A.6 EVM ↔ Stylus Interop Measurements

| Operation | Gas |
|-----------|-----|
| Direct Stylus call (`setNumber(123)`) | 71,586 |
| Cross-runtime: Solidity → Stylus (read + write + read) | 117,385 |
| **Cross-runtime overhead** | **~46K** |
| ML-DSA-65 verification (Stylus) | 374,228 |

Cross-runtime overhead (~46K) is negligible compared to ML-DSA verification (~374K). The hybrid Solidity + Stylus architecture adds <15% overhead.

Confirmed working: Solidity → Stylus calls use standard ABI encoding, shared state is visible across runtimes, multiple round-trips work within one transaction. No special handling needed.

### A.7 Gas Cost Reference

**Per-operation costs (measured on local devnode):**

| Operation | Gas |
|-----------|-----|
| Deploy Kernel impl (via-ir) | ~4,500,000 |
| Deploy KernelFactory | ~800,000 |
| Deploy FactoryStaker | ~600,000 |
| Create Kernel account | ~350,000 |
| ECDSA UserOp (ETH transfer) | 202,816 |
| Install PQ validator module | ~1,570,000 |
| Grant selector access | ~346,000 |
| **PQ UserOp (ETH transfer)** | **751,312** |
| Stylus ML-DSA verify (alone) | ~374,000 |
| PQ overhead vs ECDSA | ~548,500 (3.7x) |

**Critical gas parameter:** `verificationGasLimit` must be >= 2M for ML-DSA validation. 500K is NOT enough — Stylus verify (~374K) + Kernel routing overhead pushes past it.

**Signature size economics:**

| | ECDSA | ML-DSA-65 | Ratio |
|-|-------|-----------|-------|
| Signature | 65 B | 3,309 B | 50.9x |
| Public key | 64 B | 1,952 B | 30.5x |
| Private key | 32 B | 4,032 B | 126x |

L1 data posting cost (Arbitrum) is proportional to calldata size. ML-DSA's 50x larger signatures make L1 posting the dominant expense (~$2-8 at current prices).

### A.8 Local Development Stack

**Architecture:**

```
Nitro devnode (Docker, port 8547, chain 412346)
  → EntryPoint v0.7 (deployed via cast send --create)
  → Alto bundler (port 4337, --chain-type "arbitrum" --safe-mode false)
```

**Key characteristics:**

- State persistence: NONE — devnode wipes everything on restart
- Setup time: ~35 min first time, ~10 min scripted repeat
- Dev account: `0x3f1Eae7D46d88F08fc2F8ed27FCb2AB183EB2d0E` (pre-funded, unlimited ETH)
- Pimlico's `mock-contract-deployer` does NOT work (uses `anvil_setBalance`)
- EntryPoint address is non-canonical (random, must configure Alto manually)
- Automated via `scripts/dev-stack.sh` (one command, Ctrl-C to stop)

**When to use local vs Sepolia:**

| Use Case | Local | Sepolia |
|----------|-------|---------|
| Stylus contract iteration | ✅ | |
| Solidity module testing | ✅ | |
| Cross-runtime debugging | ✅ | |
| L1 data cost benchmarking | | ✅ |
| Production bundler testing | | ✅ |
| ZeroDev SDK integration | | ✅ |

**Reference:** `docs/LOCAL_DEV_GUIDE.md`, `thoughts/shared/research/local-devnode-assessment.md`

### A.9 Off-Chain CLI Tools

**Key design decisions:**

- `pq-keygen` exports 32-byte **seed**, not the full 4,032-byte signing key — ML-DSA best practice (seed is the portable secret, signing key is derived)
- `pq-sign` reconstructs `SigningKey` from seed via `SigningKey::from_seed()`
- `pq-sign` enforces exactly 32-byte hash input (EntryPoint `userOpHash` is always bytes32)
- `pq-verify` returns exit code 1 on invalid signature (shell script integration pattern)

**UserOp v0.7 hash computation** (matches EntryPoint spec):

1. Pack UserOp — all fields except signature; hash dynamic fields (`initCode`, `callData`, `paymasterAndData`) individually before packing
2. Outer hash: `keccak256(keccak256(packedUserOp), entryPointAddress, chainId)`

### A.10 Testing Patterns

**Mock verifier strategy:** Unit tests use `vm.mockCall` on a fake address instead of deploying the real Stylus contract. This decouples Solidity module tests from Stylus deployment:

```solidity
vm.mockCall(mockVerifier, abi.encodeWithSelector(IMLDSAVerifier.verify.selector, ...), abi.encode(true));
```

**Deterministic test data:** Tests build a 1,952-byte public key by cycling `i % 256` — not random, but reproducible across runs.

**Account simulation:** `vm.prank(smartAccount)` simulates calls from the smart account address (msg.sender isolation for `onInstall`/`onUninstall` testing).

**Stylus contract testing:** Uses `TestVM` wrapper with unsafe block due to SDK limitations. Test outside the Stylus framework where possible (segfault risk with mappings).

### A.11 Troubleshooting Quick Reference

| Problem | Solution |
|---------|----------|
| Devnode won't start | `docker rm -f nitro-dev` then re-run |
| WASM too large | Profile with `twiggy top`, check 24KB compressed limit |
| Cross-runtime call reverts | Check: contract deployed (`cast code`), ABI matches (`cargo stylus export-abi`), sufficient gas |
| `cargo stylus deploy` slow | First deploy on ARM is slow (x86 Docker emulation), use `--no-verify` |
| `cargo stylus new` panics | Install from git (not crates.io) |
| Forge gas estimation fails for handleOps | Encode with forge script, submit with `cast send --gas-limit` |
| `cast run` fails on Stylus tx | Use `cast call` for on-chain simulation instead |
| VM file I/O fails in forge script | Add `fs_permissions` to `[profile.default]` in foundry.toml |
| AA23 revert (nonce) | Check vType byte at bit 176, not 184 |
| InvalidValidator() with valid sig | Grant selector access via `grantAccess()` |
| verificationGasLimit exceeded | Set to >= 2M for ML-DSA validation |
| alloy version conflict | Pin `alloy-tx-macros = "=1.0.38"` |
