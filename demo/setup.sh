#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Demo Setup: Deploy Kernel + Install PQ Validator + Generate Keys
#
# Prerequisites:
#   - scripts/dev-stack.sh already running
#   - .env.local exists with deployed addresses
#   - Kernel repo at ~/Developer/tools/dlt/kernel/ (dev branch)
# ============================================================

export PATH="$HOME/.foundry/bin:$HOME/.cargo/bin:$PATH"
# Force local-RPC tooling to bypass system proxy resolution (can break reqwest on macOS).
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
export HTTP_PROXY=""
export HTTPS_PROXY=""
export ALL_PROXY=""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KERNEL_DIR="$HOME/Developer/tools/dlt/kernel"
KEY_DIR="$SCRIPT_DIR/.keys"

# --- CLI tool paths ---
CLI_BIN="$PROJECT_ROOT/target/release"
PQ_KEYGEN="$CLI_BIN/pq-keygen"
PQ_SIGN="$CLI_BIN/pq-sign"

# --- Formatting ---
print_success() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
print_error()   { printf '\033[31m✗ %s\033[0m\n' "$1"; }
print_info()    { printf '\033[36m  %s\033[0m\n' "$1"; }
print_section() { printf '\n\033[1;35m━━━ %s ━━━\033[0m\n' "$1"; }

# Strip cast's "[1.23e45]" annotation from large numbers
strip_cast_annotation() { echo "$1" | sed 's/ *\[.*\]//'; }

# --- State ---
KERNEL_IMPL=""
FACTORY=""
FACTORY_STAKER=""
ECDSA_VALIDATOR=""
KERNEL_ACCOUNT=""
SNAP_PUBKEY=""
KEY_SOURCE="local-keygen"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --snap-pubkey)
            [[ $# -ge 2 ]] || { print_error "--snap-pubkey requires a value"; exit 1; }
            SNAP_PUBKEY="$2"
            KEY_SOURCE="snap"
            shift 2
            ;;
        *)
            print_error "Unknown flag: $1"
            exit 1
            ;;
    esac
done

if [[ -n "$SNAP_PUBKEY" ]]; then
    SNAP_PUBKEY="${SNAP_PUBKEY#0x}"
    SNAP_PUBKEY="${SNAP_PUBKEY#0X}"
    [[ "$SNAP_PUBKEY" =~ ^[0-9a-fA-F]+$ ]] || { print_error "Snap public key must be hex"; exit 1; }
    [[ ${#SNAP_PUBKEY} -eq 3904 ]] \
        || { print_error "Snap public key must be 1952 bytes (3904 hex chars), got ${#SNAP_PUBKEY}"; exit 1; }
    SNAP_PUBKEY="0x${SNAP_PUBKEY}"
fi

# ============================================================
# Helper: Deploy a Kernel contract via forge create
# ============================================================
deploy_kernel() {
    local contract="$1"
    shift
    local output
    output=$(cd "$KERNEL_DIR" && FOUNDRY_PROFILE=deploy forge create \
        --rpc-url "$LOCAL_RPC" \
        --private-key "$DEV_PRIVATE_KEY" \
        --json \
        --broadcast \
        "$contract" "$@" 2>/dev/null) || { print_error "Failed to deploy $contract"; exit 1; }
    echo "$output" | jq -r '.deployedTo'
}

# ============================================================
# Helper: Submit a UserOp via handleOps (direct to EntryPoint)
# ============================================================
submit_userop_direct() {
    local sender="$1" nonce="$2" call_data="$3"
    local acct_gas_limits="$4" pre_verif_gas="$5" gas_fees="$6" signature="$7"

    local dev_addr
    dev_addr=$(cast wallet address --private-key "$DEV_PRIVATE_KEY")

    cast send "$ENTRYPOINT" \
        "handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)" \
        "[($sender,$nonce,0x,$call_data,$acct_gas_limits,$pre_verif_gas,$gas_fees,0x,$signature)]" \
        "$dev_addr" \
        --gas-limit 3000000 \
        --private-key "$DEV_PRIVATE_KEY" \
        --rpc-url "$LOCAL_RPC" \
        --json
}

# ============================================================
# Helper: Get UserOp hash from EntryPoint
# ============================================================
get_userop_hash() {
    local sender="$1" nonce="$2" call_data="$3"
    local acct_gas_limits="$4" pre_verif_gas="$5" gas_fees="$6"

    cast call "$ENTRYPOINT" \
        "getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))(bytes32)" \
        "($sender,$nonce,0x,$call_data,$acct_gas_limits,$pre_verif_gas,$gas_fees,0x,0x)" \
        --rpc-url "$LOCAL_RPC"
}

# ############################################################
#                     PHASE 1: PREREQUISITES
# ############################################################
print_section "Prerequisites"

[[ -f "$PROJECT_ROOT/.env.local" ]] || { print_error ".env.local not found. Run scripts/dev-stack.sh first."; exit 1; }
source "$PROJECT_ROOT/.env.local"

DEV_ADDR=$(cast wallet address --private-key "$DEV_PRIVATE_KEY")
print_info "Dev account: $DEV_ADDR"

# Verify deployed contracts
for name_addr in "EntryPoint:$ENTRYPOINT" "Stylus Verifier:$STYLUS_VERIFIER" "PQ Module:$PQ_VALIDATOR_MODULE"; do
    name="${name_addr%%:*}"
    addr="${name_addr##*:}"
    code=$(cast code "$addr" --rpc-url "$LOCAL_RPC" 2>/dev/null || echo "0x")
    [[ "$code" != "0x" && "$code" != "0x0" && -n "$code" ]] || { print_error "$name at $addr has no code"; exit 1; }
    print_success "$name verified at $addr"
done

# Build CLI tools if needed
if [[ ! -x "$PQ_KEYGEN" ]] || [[ ! -x "$PQ_SIGN" ]]; then
    print_info "Building CLI tools..."
    cargo build --release --manifest-path "$PROJECT_ROOT/scripts/cli/Cargo.toml" 2>/dev/null \
        || { print_error "Failed to build CLI tools"; exit 1; }
fi
print_success "CLI tools ready"

# ############################################################
#                  PHASE 2: KERNEL DEPLOYMENT
# ############################################################
print_section "Kernel Account Deployment"

print_info "Deploying Kernel implementation (via-ir=true, may take a moment)..."
KERNEL_IMPL=$(deploy_kernel "src/Kernel.sol:Kernel" --constructor-args "$ENTRYPOINT")
print_success "Kernel impl: $KERNEL_IMPL"

print_info "Deploying KernelFactory..."
FACTORY=$(deploy_kernel "src/factory/KernelFactory.sol:KernelFactory" --constructor-args "$KERNEL_IMPL")
print_success "KernelFactory: $FACTORY"

print_info "Deploying FactoryStaker..."
FACTORY_STAKER=$(deploy_kernel "src/factory/FactoryStaker.sol:FactoryStaker" --constructor-args "$DEV_ADDR")
print_success "FactoryStaker: $FACTORY_STAKER"

print_info "Deploying ECDSAValidator..."
ECDSA_VALIDATOR=$(deploy_kernel "src/validator/ECDSAValidator.sol:ECDSAValidator")
print_success "ECDSAValidator: $ECDSA_VALIDATOR"

# Configure factory
cast send "$FACTORY_STAKER" "approveFactory(address,bool)" "$FACTORY" true \
    --private-key "$DEV_PRIVATE_KEY" --rpc-url "$LOCAL_RPC" > /dev/null 2>&1
print_success "Factory approved"

cast send "$FACTORY_STAKER" "stake(address,uint32)" "$ENTRYPOINT" 86400 \
    --value 1ether \
    --private-key "$DEV_PRIVATE_KEY" --rpc-url "$LOCAL_RPC" > /dev/null 2>&1
print_success "Factory staked"

# Create Kernel account
ECDSA_ADDR_CLEAN=$(echo "$ECDSA_VALIDATOR" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
ROOT_VALIDATOR_ID="0x01${ECDSA_ADDR_CLEAN}"

INIT_CALLDATA=$(cast calldata \
    "initialize(bytes21,address,bytes,bytes,bytes[])" \
    "$ROOT_VALIDATOR_ID" \
    "0x0000000000000000000000000000000000000001" \
    "$DEV_ADDR" \
    "0x" \
    "[]")

SALT="0x0000000000000000000000000000000000000000000000000000000000000001"

KERNEL_ACCOUNT=$(cast call "$FACTORY" \
    "getAddress(bytes,bytes32)(address)" \
    "$INIT_CALLDATA" "$SALT" \
    --rpc-url "$LOCAL_RPC")
print_info "Predicted Kernel account: $KERNEL_ACCOUNT"

cast send "$FACTORY_STAKER" \
    "deployWithFactory(address,bytes,bytes32)" \
    "$FACTORY" "$INIT_CALLDATA" "$SALT" \
    --private-key "$DEV_PRIVATE_KEY" --rpc-url "$LOCAL_RPC" > /dev/null 2>&1

ACCOUNT_CODE=$(cast code "$KERNEL_ACCOUNT" --rpc-url "$LOCAL_RPC" 2>/dev/null)
[[ "$ACCOUNT_CODE" != "0x" && "$ACCOUNT_CODE" != "0x0" && -n "$ACCOUNT_CODE" ]] \
    || { print_error "Kernel account not deployed at $KERNEL_ACCOUNT"; exit 1; }
print_success "Kernel account deployed: $KERNEL_ACCOUNT"

# Fund the account
cast send "$KERNEL_ACCOUNT" --value 1ether \
    --private-key "$DEV_PRIVATE_KEY" --rpc-url "$LOCAL_RPC" > /dev/null 2>&1
print_success "Kernel funded with 1 ETH"

# ############################################################
#              PHASE 3: PQ VALIDATOR INSTALLATION
# ############################################################
print_section "PQ Validator Installation"

# Prepare public key source (snap-provided or locally generated)
rm -rf "$KEY_DIR"
mkdir -p "$KEY_DIR"

if [[ -n "$SNAP_PUBKEY" ]]; then
    PK_HEX="$SNAP_PUBKEY"
    print_success "Using snap-provided public key"
    print_info "PK prefix: ${PK_HEX:0:18}..."
else
    "$PQ_KEYGEN" --output "$KEY_DIR" 2>/dev/null
    PK_SIZE=$(wc -c < "$KEY_DIR/pk.bin" | tr -d ' ')
    [[ "$PK_SIZE" == "1952" ]] || { print_error "Expected 1952-byte public key, got $PK_SIZE"; exit 1; }
    print_success "ML-DSA-65 keypair generated"
    print_info "Seed file for wallet UI: $KEY_DIR/sk.bin"
    print_info "Convert seed to hex when needed: xxd -p \"$KEY_DIR/sk.bin\" | tr -d '\\n'"
    PK_HEX="0x$(xxd -p "$KEY_DIR/pk.bin" | tr -d '\n')"
fi

# Build installModule UserOp
HOOK_BYTES="0000000000000000000000000000000000000001"
EXECUTE_SELECTOR=$(cast sig "execute(bytes32,bytes)")
STRUCT_ABI=$(cast abi-encode "f(bytes,bytes,bytes)" "$PK_HEX" "0x" "$EXECUTE_SELECTOR")
INSTALL_DATA="0x${HOOK_BYTES}${STRUCT_ABI#0x}"

INSTALL_MODULE_CD=$(cast calldata \
    "installModule(uint256,address,bytes)" \
    1 "$PQ_VALIDATOR_MODULE" "$INSTALL_DATA")

EXEC_MODE="0x0000000000000000000000000000000000000000000000000000000000000000"
KERNEL_CLEAN=$(echo "$KERNEL_ACCOUNT" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
INSTALL_CD_CLEAN=$(echo "$INSTALL_MODULE_CD" | sed 's/0x//')
EXEC_CALLDATA="0x${KERNEL_CLEAN}$(printf '%064x' 0)${INSTALL_CD_CLEAN}"

USEROP_CALLDATA=$(cast calldata "execute(bytes32,bytes)" "$EXEC_MODE" "$EXEC_CALLDATA")

# Get nonce and gas params
ROOT_NONCE=$(strip_cast_annotation "$(cast call "$ENTRYPOINT" \
    "getNonce(address,uint192)(uint256)" "$KERNEL_ACCOUNT" 0 \
    --rpc-url "$LOCAL_RPC")")

VERIFICATION_GAS=2000000
CALL_GAS=2000000
ACCOUNT_GAS_LIMITS=$(printf '0x%032x%032x' $VERIFICATION_GAS $CALL_GAS)
PRE_VERIFICATION_GAS=100000
MAX_PRIORITY_FEE=1000000000
MAX_FEE=10000000000
GAS_FEES=$(printf '0x%032x%032x' $MAX_PRIORITY_FEE $MAX_FEE)

# Get hash and sign with ECDSA (root validator)
INSTALL_OP_HASH=$(get_userop_hash \
    "$KERNEL_ACCOUNT" "$ROOT_NONCE" "$USEROP_CALLDATA" \
    "$ACCOUNT_GAS_LIMITS" "$PRE_VERIFICATION_GAS" "$GAS_FEES")

ECDSA_SIG=$(cast wallet sign "$INSTALL_OP_HASH" --private-key "$DEV_PRIVATE_KEY")

# Submit
print_info "Submitting install UserOp..."
TX_RESULT=$(submit_userop_direct \
    "$KERNEL_ACCOUNT" "$ROOT_NONCE" "$USEROP_CALLDATA" \
    "$ACCOUNT_GAS_LIMITS" "$PRE_VERIFICATION_GAS" "$GAS_FEES" \
    "$ECDSA_SIG" 2>/dev/null) || { print_error "Install handleOps failed"; exit 1; }

INSTALL_TX=$(echo "$TX_RESULT" | jq -r '.transactionHash')
INSTALL_STATUS=$(echo "$TX_RESULT" | jq -r '.status')
[[ "$INSTALL_STATUS" == "0x1" || "$INSTALL_STATUS" == "1" ]] \
    || { print_error "Install TX reverted: $INSTALL_TX"; exit 1; }
print_success "PQ validator installed: $INSTALL_TX"

# Verify installation
IS_INSTALLED=$(cast call "$KERNEL_ACCOUNT" \
    "isModuleInstalled(uint256,address,bytes)(bool)" \
    1 "$PQ_VALIDATOR_MODULE" "0x" \
    --rpc-url "$LOCAL_RPC")
[[ "$IS_INSTALLED" == "true" ]] || { print_error "PQ validator NOT installed"; exit 1; }
print_success "Verified: PQ validator installed on Kernel"

# ############################################################
#                   WRITE DEMO .env
# ############################################################
print_section "Writing demo/.env"

# Preserve VITE_REOWN_PROJECT_ID if already set in .env
EXISTING_PROJECT_ID=""
EXISTING_SNAP_ID=""
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    EXISTING_PROJECT_ID=$(grep '^VITE_REOWN_PROJECT_ID=' "$SCRIPT_DIR/.env" || true)
    EXISTING_SNAP_ID=$(grep '^VITE_SNAP_ID=' "$SCRIPT_DIR/.env" || true)
fi

cat > "$SCRIPT_DIR/.env" <<EOF
# Generated by demo/setup.sh — $(date -Iseconds)
${EXISTING_PROJECT_ID:-# VITE_REOWN_PROJECT_ID=your_project_id_here}
${EXISTING_SNAP_ID:-VITE_SNAP_ID=local:http://localhost:8080}
VITE_LOCAL_RPC=$LOCAL_RPC
VITE_BUNDLER_RPC=$BUNDLER_RPC
VITE_CHAIN_ID=$CHAIN_ID
VITE_ENTRYPOINT=$ENTRYPOINT
VITE_KERNEL_ACCOUNT=$KERNEL_ACCOUNT
VITE_PQ_VALIDATOR_MODULE=$PQ_VALIDATOR_MODULE
VITE_STYLUS_VERIFIER=$STYLUS_VERIFIER
VITE_ECDSA_VALIDATOR=$ECDSA_VALIDATOR
EOF

print_success "Wrote $SCRIPT_DIR/.env"

# ############################################################
#                       SUMMARY
# ############################################################
echo ""
echo -e "\033[32m========================================\033[0m"
echo -e "\033[32m  Demo Setup Complete                    \033[0m"
echo -e "\033[32m========================================\033[0m"
echo "  Kernel Account:    $KERNEL_ACCOUNT"
echo "  PQ Validator:      $PQ_VALIDATOR_MODULE"
echo "  Stylus Verifier:   $STYLUS_VERIFIER"
echo "  EntryPoint:        $ENTRYPOINT"
echo "  Key source:        $KEY_SOURCE"
echo "  Public key:        ${PK_HEX:0:18}..."
if [[ "$KEY_SOURCE" == "snap" ]]; then
    echo "  Signer mode:       MetaMask Snap (private key stays in snap)"
else
    echo "  Signer mode:       Seed file at demo/.keys/sk.bin"
fi
echo ""
echo "  Next steps:"
echo "    cd demo/dapp && npm run dev    # port 3000"
echo "    cd demo/wallet && npm run dev  # port 3001"
echo -e "\033[32m========================================\033[0m"
