#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# E2E Test: Post-Quantum UserOp via Kernel Smart Account
#
# Proves: A Kernel smart account can execute an ETH transfer
# validated entirely by an ML-DSA-65 post-quantum signature,
# verified on-chain by a Stylus WASM contract — through the
# standard ERC-4337 pipeline.
#
# Prerequisites:
#   - scripts/dev-stack.sh already running
#   - .env.local exists with deployed addresses
#   - Kernel repo at ~/Developer/tools/dlt/kernel/ (dev branch)
# ============================================================

export PATH="$HOME/.foundry/bin:$HOME/.cargo/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KERNEL_DIR="$HOME/Developer/tools/dlt/kernel"
KEY_DIR="/tmp/e2e-pq-keys"

# --- CLI tool paths ---
CLI_BIN="$PROJECT_ROOT/target/release"
PQ_KEYGEN="$CLI_BIN/pq-keygen"
PQ_SIGN="$CLI_BIN/pq-sign"

# --- Test parameters ---
RECIPIENT="0x1111111111111111111111111111111111111111"
TRANSFER_WEI=1000000000000000  # 0.001 ETH

# --- Formatting ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { printf "${CYAN}[INFO]${NC} %s\n" "$1"; }
ok()      { printf "${GREEN}[ OK ]${NC} %s\n" "$1"; }
fail()    { printf "${RED}[FAIL]${NC} %s\n" "$1"; exit 1; }
warn()    { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
section() { printf "\n${BOLD}━━━ Phase %s: %s ━━━${NC}\n" "$1" "$2"; }
step()    { printf "\n${CYAN}--- Step %s: %s ---${NC}\n" "$1" "$2"; }

# Strip cast's "[1.23e45]" annotation from large numbers
strip_cast_annotation() { echo "$1" | sed 's/ *\[.*\]//'; }

# --- State (populated during execution) ---
KERNEL_IMPL=""
FACTORY=""
FACTORY_STAKER=""
ECDSA_VALIDATOR=""
KERNEL_ACCOUNT=""
SUBMISSION_METHOD=""
PQ_TX_HASH=""
PQ_USER_OP_HASH=""
GAS_USED=""
BUNDLER_AVAILABLE=false

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
        "$contract" "$@" 2>/dev/null) || fail "Failed to deploy $contract"
    echo "$output" | jq -r '.deployedTo'
}

# ============================================================
# Helper: Submit a UserOp via handleOps (direct to EntryPoint)
# Returns JSON receipt.
# ============================================================
submit_userop_direct() {
    local sender="$1"
    local nonce="$2"
    local call_data="$3"
    local acct_gas_limits="$4"
    local pre_verif_gas="$5"
    local gas_fees="$6"
    local signature="$7"

    cast send "$ENTRYPOINT" \
        "handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)" \
        "[($sender,$nonce,0x,$call_data,$acct_gas_limits,$pre_verif_gas,$gas_fees,0x,$signature)]" \
        "$DEV_ADDR" \
        --gas-limit 3000000 \
        --private-key "$DEV_PRIVATE_KEY" \
        --rpc-url "$LOCAL_RPC" \
        --json
}

# ============================================================
# Helper: Get UserOp hash from EntryPoint
# ============================================================
get_userop_hash() {
    local sender="$1"
    local nonce="$2"
    local call_data="$3"
    local acct_gas_limits="$4"
    local pre_verif_gas="$5"
    local gas_fees="$6"

    cast call "$ENTRYPOINT" \
        "getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))(bytes32)" \
        "($sender,$nonce,0x,$call_data,$acct_gas_limits,$pre_verif_gas,$gas_fees,0x,0x)" \
        --rpc-url "$LOCAL_RPC"
}

# ############################################################
#                    PHASE 1: PREREQUISITES
# ############################################################
section 1 "Prerequisites & Infrastructure"

step "1.1" "Source environment & verify dev-stack"

[[ -f "$PROJECT_ROOT/.env.local" ]] || fail ".env.local not found. Run scripts/dev-stack.sh first."
source "$PROJECT_ROOT/.env.local"

DEV_ADDR=$(cast wallet address --private-key "$DEV_PRIVATE_KEY")
info "Dev account: $DEV_ADDR"

# Verify deployed contracts
for name_addr in "EntryPoint:$ENTRYPOINT" "Stylus Verifier:$STYLUS_VERIFIER" "PQ Validator Module:$PQ_VALIDATOR_MODULE"; do
    name="${name_addr%%:*}"
    addr="${name_addr##*:}"
    code=$(cast code "$addr" --rpc-url "$LOCAL_RPC" 2>/dev/null || echo "0x")
    [[ "$code" != "0x" && "$code" != "0x0" && -n "$code" ]] || fail "$name at $addr has no code"
    ok "$name verified at $addr"
done

# Verify bundler
BUNDLER_RESP=$(curl -sf "$BUNDLER_RPC" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_supportedEntryPoints","params":[],"id":1}' \
    2>/dev/null || echo "")
if [[ -n "$BUNDLER_RESP" ]]; then
    ok "Alto bundler responding"
    BUNDLER_AVAILABLE=true
else
    warn "Alto bundler not responding — will use direct submission only"
fi

step "1.2" "Verify tools & build CLI"

command -v python3 &>/dev/null || fail "python3 required (for big number arithmetic)"
command -v jq &>/dev/null || fail "jq required (for JSON parsing)"

[[ -d "$KERNEL_DIR" ]] || fail "Kernel repo not found at $KERNEL_DIR"
[[ -f "$KERNEL_DIR/src/Kernel.sol" ]] || fail "Kernel.sol not found in $KERNEL_DIR"

if [[ ! -x "$PQ_KEYGEN" ]] || [[ ! -x "$PQ_SIGN" ]]; then
    info "Building CLI tools..."
    cargo build --release --manifest-path "$PROJECT_ROOT/scripts/cli/Cargo.toml" 2>/dev/null \
        || fail "Failed to build CLI tools"
fi
[[ -x "$PQ_KEYGEN" ]] || fail "pq-keygen not found at $PQ_KEYGEN"
[[ -x "$PQ_SIGN" ]] || fail "pq-sign not found at $PQ_SIGN"
ok "CLI tools ready"

# ############################################################
#                 PHASE 2: KERNEL DEPLOYMENT
# ############################################################
section 2 "Kernel Account Deployment"

step "2.1" "Deploy Kernel contracts"

info "Deploying Kernel implementation (via-ir=true, may take a moment)..."
KERNEL_IMPL=$(deploy_kernel "src/Kernel.sol:Kernel" --constructor-args "$ENTRYPOINT")
ok "Kernel impl: $KERNEL_IMPL"

info "Deploying KernelFactory..."
FACTORY=$(deploy_kernel "src/factory/KernelFactory.sol:KernelFactory" --constructor-args "$KERNEL_IMPL")
ok "KernelFactory: $FACTORY"

info "Deploying FactoryStaker..."
FACTORY_STAKER=$(deploy_kernel "src/factory/FactoryStaker.sol:FactoryStaker" --constructor-args "$DEV_ADDR")
ok "FactoryStaker: $FACTORY_STAKER"

info "Deploying ECDSAValidator..."
ECDSA_VALIDATOR=$(deploy_kernel "src/validator/ECDSAValidator.sol:ECDSAValidator")
ok "ECDSAValidator: $ECDSA_VALIDATOR"

step "2.2" "Configure factory (approve + stake)"

cast send "$FACTORY_STAKER" "approveFactory(address,bool)" "$FACTORY" true \
    --private-key "$DEV_PRIVATE_KEY" --rpc-url "$LOCAL_RPC" > /dev/null 2>&1
ok "Factory approved"

cast send "$FACTORY_STAKER" "stake(address,uint32)" "$ENTRYPOINT" 86400 \
    --value 1ether \
    --private-key "$DEV_PRIVATE_KEY" --rpc-url "$LOCAL_RPC" > /dev/null 2>&1
ok "Factory staked 1 ETH with EntryPoint"

step "2.3" "Create Kernel account"

# Build ValidationId: type(0x01) + validator address = 21 bytes
ECDSA_ADDR_CLEAN=$(echo "$ECDSA_VALIDATOR" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
ROOT_VALIDATOR_ID="0x01${ECDSA_ADDR_CLEAN}"

# Encode initialize() calldata
# initialize(bytes21 rootValidator, address hook, bytes validatorData, bytes hookData, bytes[] initConfig)
#   hook = address(1) = no hook
#   validatorData = dev address (20 bytes, for ECDSAValidator.onInstall)
#   hookData = empty
#   initConfig = empty array
INIT_CALLDATA=$(cast calldata \
    "initialize(bytes21,address,bytes,bytes,bytes[])" \
    "$ROOT_VALIDATOR_ID" \
    "0x0000000000000000000000000000000000000001" \
    "$DEV_ADDR" \
    "0x" \
    "[]")

SALT="0x0000000000000000000000000000000000000000000000000000000000000001"

# Predict address deterministically, then deploy
KERNEL_ACCOUNT=$(cast call "$FACTORY" \
    "getAddress(bytes,bytes32)(address)" \
    "$INIT_CALLDATA" "$SALT" \
    --rpc-url "$LOCAL_RPC")
info "Predicted Kernel account: $KERNEL_ACCOUNT"

cast send "$FACTORY_STAKER" \
    "deployWithFactory(address,bytes,bytes32)" \
    "$FACTORY" "$INIT_CALLDATA" "$SALT" \
    --private-key "$DEV_PRIVATE_KEY" --rpc-url "$LOCAL_RPC" > /dev/null 2>&1

# Verify deployment
ACCOUNT_CODE=$(cast code "$KERNEL_ACCOUNT" --rpc-url "$LOCAL_RPC" 2>/dev/null)
[[ "$ACCOUNT_CODE" != "0x" && "$ACCOUNT_CODE" != "0x0" && -n "$ACCOUNT_CODE" ]] \
    || fail "Kernel account not deployed at $KERNEL_ACCOUNT"
ok "Kernel account deployed: $KERNEL_ACCOUNT"

step "2.4" "Fund Kernel account"

cast send "$KERNEL_ACCOUNT" --value 1ether \
    --private-key "$DEV_PRIVATE_KEY" --rpc-url "$LOCAL_RPC" > /dev/null 2>&1
BALANCE=$(cast balance "$KERNEL_ACCOUNT" --rpc-url "$LOCAL_RPC")
ok "Kernel funded: $BALANCE wei"

# ############################################################
#           PHASE 3: PQ VALIDATOR INSTALLATION
# ############################################################
section 3 "PQ Validator Installation (ECDSA-signed root UserOp)"

step "3.1" "Generate ML-DSA-65 keypair"

rm -rf "$KEY_DIR"
mkdir -p "$KEY_DIR"
"$PQ_KEYGEN" --output "$KEY_DIR" 2>/dev/null
PK_SIZE=$(wc -c < "$KEY_DIR/pk.bin" | tr -d ' ')
[[ "$PK_SIZE" == "1952" ]] || fail "Expected 1952-byte public key, got $PK_SIZE"
ok "Keypair generated ($PK_SIZE-byte public key)"

step "3.2" "Build installModule UserOp"

PK_HEX="0x$(xxd -p "$KEY_DIR/pk.bin" | tr -d '\n')"

# Build installModule initData:
#   initData = hookAddr(20 bytes) || abi.encode(validatorData, hookData, selectorData)
# hookAddr = address(1) = no hook
HOOK_BYTES="0000000000000000000000000000000000000001"

# Grant execute(bytes32,bytes) access during install
EXECUTE_SELECTOR=$(cast sig "execute(bytes32,bytes)")
info "execute selector: $EXECUTE_SELECTOR"

# ABI-encode InstallValidatorDataFormat: (bytes validatorData, bytes hookData, bytes selectorData)
STRUCT_ABI=$(cast abi-encode "f(bytes,bytes,bytes)" "$PK_HEX" "0x" "$EXECUTE_SELECTOR")

# Combine hook + struct
INSTALL_DATA="0x${HOOK_BYTES}${STRUCT_ABI#0x}"

# Build installModule(1, pqValidator, installData) calldata
INSTALL_MODULE_CD=$(cast calldata \
    "installModule(uint256,address,bytes)" \
    1 "$PQ_VALIDATOR_MODULE" "$INSTALL_DATA")

# Build execute() calldata (single call to self)
# execute(bytes32 execMode, bytes executionCalldata)
# execMode = 0x00...00 (CALLTYPE_SINGLE, EXECTYPE_DEFAULT)
# executionCalldata = abi.encodePacked(target(20), value(32), data(...))
EXEC_MODE="0x0000000000000000000000000000000000000000000000000000000000000000"
KERNEL_CLEAN=$(echo "$KERNEL_ACCOUNT" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
INSTALL_CD_CLEAN=$(echo "$INSTALL_MODULE_CD" | sed 's/0x//')
EXEC_CALLDATA="0x${KERNEL_CLEAN}$(printf '%064x' 0)${INSTALL_CD_CLEAN}"

USEROP_CALLDATA=$(cast calldata "execute(bytes32,bytes)" "$EXEC_MODE" "$EXEC_CALLDATA")
info "Install UserOp callData built ($(echo -n "$USEROP_CALLDATA" | wc -c | tr -d ' ') hex chars)"

step "3.3" "Sign & submit install UserOp"

# Root nonce (key=0 for root validator)
ROOT_NONCE=$(strip_cast_annotation "$(cast call "$ENTRYPOINT" \
    "getNonce(address,uint192)(uint256)" "$KERNEL_ACCOUNT" 0 \
    --rpc-url "$LOCAL_RPC")")
info "Root nonce: $ROOT_NONCE"

# Gas parameters
VERIFICATION_GAS=2000000
CALL_GAS=2000000
ACCOUNT_GAS_LIMITS=$(printf '0x%032x%032x' $VERIFICATION_GAS $CALL_GAS)
PRE_VERIFICATION_GAS=100000
MAX_PRIORITY_FEE=1000000000   # 1 gwei
MAX_FEE=10000000000           # 10 gwei
GAS_FEES=$(printf '0x%032x%032x' $MAX_PRIORITY_FEE $MAX_FEE)

# Get UserOp hash from EntryPoint (view call — signature excluded from hash)
INSTALL_OP_HASH=$(get_userop_hash \
    "$KERNEL_ACCOUNT" "$ROOT_NONCE" "$USEROP_CALLDATA" \
    "$ACCOUNT_GAS_LIMITS" "$PRE_VERIFICATION_GAS" "$GAS_FEES")
info "Install UserOp hash: $INSTALL_OP_HASH"

# Sign with ECDSA (ECDSAValidator expects EIP-191 wrapped signature)
ECDSA_SIG=$(cast wallet sign "$INSTALL_OP_HASH" --private-key "$DEV_PRIVATE_KEY")

# Submit via direct handleOps (reliable for setup step)
info "Submitting install UserOp via handleOps..."
TX_RESULT=$(submit_userop_direct \
    "$KERNEL_ACCOUNT" "$ROOT_NONCE" "$USEROP_CALLDATA" \
    "$ACCOUNT_GAS_LIMITS" "$PRE_VERIFICATION_GAS" "$GAS_FEES" \
    "$ECDSA_SIG" 2>/dev/null) || fail "Install handleOps failed"

INSTALL_TX=$(echo "$TX_RESULT" | jq -r '.transactionHash')
INSTALL_STATUS=$(echo "$TX_RESULT" | jq -r '.status')
[[ "$INSTALL_STATUS" == "0x1" || "$INSTALL_STATUS" == "1" ]] \
    || fail "Install TX reverted: $INSTALL_TX (status: $INSTALL_STATUS)"
ok "Install TX mined: $INSTALL_TX"

step "3.4" "Verify PQ validator installation"

# Check Kernel sees the module as installed
IS_INSTALLED=$(cast call "$KERNEL_ACCOUNT" \
    "isModuleInstalled(uint256,address,bytes)(bool)" \
    1 "$PQ_VALIDATOR_MODULE" "0x" \
    --rpc-url "$LOCAL_RPC")
[[ "$IS_INSTALLED" == "true" ]] || fail "Kernel reports PQ validator NOT installed"
ok "Kernel.isModuleInstalled = true"

# Check the PQ validator has the public key stored
IS_INITIALIZED=$(cast call "$PQ_VALIDATOR_MODULE" \
    "isInitialized(address)(bool)" "$KERNEL_ACCOUNT" \
    --rpc-url "$LOCAL_RPC")
[[ "$IS_INITIALIZED" == "true" ]] || fail "PQ validator module not initialized for Kernel account"
ok "PQValidatorModule.isInitialized = true"

# ############################################################
#            PHASE 4: PQ-SIGNED USEROP (THE TEST)
# ############################################################
section 4 "Post-Quantum Signed UserOp"

step "4.1" "Record pre-transfer balances"

RECIPIENT_BALANCE_BEFORE=$(cast balance "$RECIPIENT" --rpc-url "$LOCAL_RPC")
KERNEL_BALANCE_BEFORE=$(cast balance "$KERNEL_ACCOUNT" --rpc-url "$LOCAL_RPC")
info "Recipient before: $RECIPIENT_BALANCE_BEFORE wei"
info "Kernel before:    $KERNEL_BALANCE_BEFORE wei"

step "4.2" "Construct PQ UserOp (0.001 ETH transfer)"

# execute() calldata: single ETH transfer to recipient
# executionCalldata = abi.encodePacked(target(20), value(32), data(0))
RECIPIENT_CLEAN=$(echo "$RECIPIENT" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
TRANSFER_EXEC="0x${RECIPIENT_CLEAN}$(printf '%064x' $TRANSFER_WEI)"
PQ_USEROP_CALLDATA=$(cast calldata "execute(bytes32,bytes)" "$EXEC_MODE" "$TRANSFER_EXEC")

# Non-root nonce key: (0x01 << 176) | (uint160(pqValidator) << 16)
# Format: [0x00 mode][0x01 type][20-byte validator addr][0x0000 reserved]
PQ_ADDR_CLEAN=$(echo "$PQ_VALIDATOR_MODULE" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
NONCE_KEY="0x0001${PQ_ADDR_CLEAN}0000"
PQ_NONCE=$(strip_cast_annotation "$(cast call "$ENTRYPOINT" \
    "getNonce(address,uint192)(uint256)" "$KERNEL_ACCOUNT" "$NONCE_KEY" \
    --rpc-url "$LOCAL_RPC")")
info "PQ nonce key: $NONCE_KEY"
info "PQ nonce: $PQ_NONCE"

# Gas parameters
PQ_VERIFICATION_GAS=2000000
PQ_CALL_GAS=100000
PQ_ACCOUNT_GAS_LIMITS=$(printf '0x%032x%032x' $PQ_VERIFICATION_GAS $PQ_CALL_GAS)
PQ_PRE_VERIFICATION_GAS=100000
PQ_GAS_FEES="$GAS_FEES"  # same as install op

step "4.3" "Compute UserOp hash & sign with ML-DSA"

PQ_USER_OP_HASH=$(get_userop_hash \
    "$KERNEL_ACCOUNT" "$PQ_NONCE" "$PQ_USEROP_CALLDATA" \
    "$PQ_ACCOUNT_GAS_LIMITS" "$PQ_PRE_VERIFICATION_GAS" "$PQ_GAS_FEES")
info "PQ UserOp hash: $PQ_USER_OP_HASH"

# Sign with ML-DSA-65
"$PQ_SIGN" --key "$KEY_DIR/sk.bin" --hash "$PQ_USER_OP_HASH" --output "$KEY_DIR/sig.bin"
SIG_HEX="0x$(xxd -p "$KEY_DIR/sig.bin" | tr -d '\n')"
SIG_SIZE=$(wc -c < "$KEY_DIR/sig.bin" | tr -d ' ')
[[ "$SIG_SIZE" == "3309" ]] || warn "Expected 3309-byte signature, got $SIG_SIZE"
ok "ML-DSA-65 signature generated ($SIG_SIZE bytes)"

step "4.4" "Submit PQ UserOp"

# Try 1: Via Alto bundler
if [[ "$BUNDLER_AVAILABLE" == "true" ]]; then
    info "Attempting submission via Alto bundler..."

    # Convert values to hex for JSON-RPC
    PQ_NONCE_HEX=$(python3 -c "print(hex(int('$PQ_NONCE')))")
    PQ_VGAS_HEX=$(printf '0x%x' $PQ_VERIFICATION_GAS)
    PQ_CGAS_HEX=$(printf '0x%x' $PQ_CALL_GAS)
    PQ_PVGAS_HEX=$(printf '0x%x' $PQ_PRE_VERIFICATION_GAS)
    MPFEE_HEX=$(printf '0x%x' $MAX_PRIORITY_FEE)
    MFEE_HEX=$(printf '0x%x' $MAX_FEE)

    BUNDLER_RESULT=$(curl -sf "$BUNDLER_RPC" -H "Content-Type: application/json" -d "{
        \"jsonrpc\": \"2.0\",
        \"method\": \"eth_sendUserOperation\",
        \"params\": [{
            \"sender\": \"$KERNEL_ACCOUNT\",
            \"nonce\": \"$PQ_NONCE_HEX\",
            \"factory\": null,
            \"factoryData\": null,
            \"callData\": \"$PQ_USEROP_CALLDATA\",
            \"callGasLimit\": \"$PQ_CGAS_HEX\",
            \"verificationGasLimit\": \"$PQ_VGAS_HEX\",
            \"preVerificationGas\": \"$PQ_PVGAS_HEX\",
            \"maxFeePerGas\": \"$MFEE_HEX\",
            \"maxPriorityFeePerGas\": \"$MPFEE_HEX\",
            \"paymaster\": null,
            \"paymasterVerificationGasLimit\": null,
            \"paymasterPostOpGasLimit\": null,
            \"paymasterData\": null,
            \"signature\": \"$SIG_HEX\"
        }, \"$ENTRYPOINT\"],
        \"id\": 1
    }" 2>/dev/null || echo '{"error":{"message":"connection failed"}}')

    BUNDLER_OP_HASH=$(echo "$BUNDLER_RESULT" | jq -r '.result // empty')
    BUNDLER_ERROR=$(echo "$BUNDLER_RESULT" | jq -r '.error.message // empty')

    if [[ -n "$BUNDLER_OP_HASH" && "$BUNDLER_OP_HASH" != "null" ]]; then
        ok "Bundler accepted UserOp: $BUNDLER_OP_HASH"
        SUBMISSION_METHOD="bundler"

        # Wait for inclusion
        info "Waiting for UserOp inclusion..."
        for _ in $(seq 1 30); do
            RECEIPT_RESULT=$(curl -sf "$BUNDLER_RPC" -H "Content-Type: application/json" -d "{
                \"jsonrpc\": \"2.0\",
                \"method\": \"eth_getUserOperationReceipt\",
                \"params\": [\"$BUNDLER_OP_HASH\"],
                \"id\": 1
            }" 2>/dev/null || echo '{}')

            RECEIPT_TX=$(echo "$RECEIPT_RESULT" | jq -r '.result.receipt.transactionHash // empty')
            if [[ -n "$RECEIPT_TX" && "$RECEIPT_TX" != "null" ]]; then
                PQ_TX_HASH="$RECEIPT_TX"
                GAS_USED=$(echo "$RECEIPT_RESULT" | jq -r '.result.actualGasUsed // "unknown"')
                break
            fi
            sleep 1
        done

        [[ -n "$PQ_TX_HASH" ]] || fail "Timed out waiting for UserOp receipt (30s)"
        ok "UserOp included in TX: $PQ_TX_HASH"
    else
        warn "Bundler rejected: ${BUNDLER_ERROR:-unknown error}"
        info "Falling back to direct submission..."
    fi
fi

# Try 2: Direct to EntryPoint (fallback or only option)
if [[ -z "$SUBMISSION_METHOD" ]]; then
    info "Submitting via direct handleOps..."
    SUBMISSION_METHOD="direct"

    DIRECT_RESULT=$(submit_userop_direct \
        "$KERNEL_ACCOUNT" "$PQ_NONCE" "$PQ_USEROP_CALLDATA" \
        "$PQ_ACCOUNT_GAS_LIMITS" "$PQ_PRE_VERIFICATION_GAS" "$PQ_GAS_FEES" \
        "$SIG_HEX" 2>/dev/null) || fail "Direct handleOps failed"

    PQ_TX_HASH=$(echo "$DIRECT_RESULT" | jq -r '.transactionHash')
    TX_STATUS=$(echo "$DIRECT_RESULT" | jq -r '.status')
    GAS_USED=$(echo "$DIRECT_RESULT" | jq -r '.gasUsed')

    [[ "$TX_STATUS" == "0x1" || "$TX_STATUS" == "1" ]] \
        || fail "PQ UserOp TX reverted (status: $TX_STATUS, tx: $PQ_TX_HASH)"
    ok "Direct TX: $PQ_TX_HASH (gas: $GAS_USED)"
fi

# ############################################################
#                   PHASE 5: VERIFICATION
# ############################################################
section 5 "Verification"

step "5.1" "Verify balance changes"

RECIPIENT_BALANCE_AFTER=$(cast balance "$RECIPIENT" --rpc-url "$LOCAL_RPC")
KERNEL_BALANCE_AFTER=$(cast balance "$KERNEL_ACCOUNT" --rpc-url "$LOCAL_RPC")
info "Recipient after: $RECIPIENT_BALANCE_AFTER wei"
info "Kernel after:    $KERNEL_BALANCE_AFTER wei"

# Check recipient received exactly 0.001 ETH
BALANCE_INCREASE=$(python3 -c "print(int('${RECIPIENT_BALANCE_AFTER}') - int('${RECIPIENT_BALANCE_BEFORE}'))")
if [[ "$BALANCE_INCREASE" == "$TRANSFER_WEI" ]]; then
    ok "Recipient received exactly 0.001 ETH"
else
    fail "Expected recipient to receive $TRANSFER_WEI wei, got $BALANCE_INCREASE"
fi

# Check Kernel balance decreased (transfer + gas)
KERNEL_DECREASE=$(python3 -c "print(int('${KERNEL_BALANCE_BEFORE}') - int('${KERNEL_BALANCE_AFTER}'))")
KERNEL_SPENT_OK=$(python3 -c "print('yes' if int('$KERNEL_DECREASE') >= $TRANSFER_WEI else 'no')")
[[ "$KERNEL_SPENT_OK" == "yes" ]] || fail "Kernel balance didn't decrease enough"
ok "Kernel spent $KERNEL_DECREASE wei (transfer + gas)"

step "5.2" "Verify UserOperationEvent"

USEROP_EVENT_TOPIC="0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f"
RECEIPT_JSON=$(cast receipt "$PQ_TX_HASH" --json --rpc-url "$LOCAL_RPC" 2>/dev/null || echo "{}")
EVENT_MATCH=$(echo "$RECEIPT_JSON" | jq -r \
    ".logs[] | select(.topics[0] == \"$USEROP_EVENT_TOPIC\") | .topics[0]" 2>/dev/null || echo "")

if [[ -n "$EVENT_MATCH" ]]; then
    ok "UserOperationEvent emitted"

    # Check success flag in event data (first 32 bytes of data, non-zero = success)
    EVENT_DATA=$(echo "$RECEIPT_JSON" | jq -r \
        ".logs[] | select(.topics[0] == \"$USEROP_EVENT_TOPIC\") | .data" 2>/dev/null || echo "")
    if [[ -n "$EVENT_DATA" ]]; then
        # UserOperationEvent(bytes32 userOpHash, address sender, address paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)
        # success is the 5th parameter (after 4 indexed), at offset 128 (4th word in data)
        # Actually: indexed = userOpHash, sender, paymaster. Non-indexed = nonce, success, actualGasCost, actualGasUsed
        # success is at data offset 32 (second word)
        SUCCESS_WORD=$(echo "$EVENT_DATA" | sed 's/0x//' | cut -c65-128)
        SUCCESS_VAL=$(python3 -c "print(int('$SUCCESS_WORD', 16))" 2>/dev/null || echo "0")
        if [[ "$SUCCESS_VAL" == "1" ]]; then
            ok "UserOp success=true in event data"
        else
            warn "UserOp success flag not confirmed (data: $SUCCESS_WORD)"
        fi
    fi
else
    warn "Could not verify UserOperationEvent in logs (non-critical)"
fi

# ############################################################
#                       SUMMARY
# ############################################################
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  E2E POST-QUANTUM VALIDATION: PASSED   ${NC}"
echo -e "${GREEN}========================================${NC}"
echo "  Kernel Account:    $KERNEL_ACCOUNT"
echo "  PQ Validator:      $PQ_VALIDATOR_MODULE"
echo "  Stylus Verifier:   $STYLUS_VERIFIER"
echo "  ECDSA Validator:   $ECDSA_VALIDATOR"
echo "  Submission Method: $SUBMISSION_METHOD"
echo "  PQ UserOp Hash:    $PQ_USER_OP_HASH"
echo "  TX Hash:           $PQ_TX_HASH"
echo "  Gas Used:          $GAS_USED"
echo -e "${GREEN}========================================${NC}"
