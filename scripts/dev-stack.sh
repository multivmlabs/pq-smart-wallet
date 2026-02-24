#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Dev Stack Orchestration
# Starts: Nitro devnode → deploys contracts → starts Alto bundler
# Usage: ./scripts/dev-stack.sh
# ============================================================

# Ensure Foundry and Cargo tools are on PATH
export PATH="$HOME/.foundry/bin:$HOME/.cargo/bin:$PATH"
# Force local-RPC tooling to bypass system proxy resolution (can break reqwest on macOS).
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
export HTTP_PROXY=""
export HTTPS_PROXY=""
export ALL_PROXY=""

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_DIR="$HOME/Developer/tools/dlt"

# --- Paths ---
DEVNODE_SCRIPT="$TOOLS_DIR/nitro-devnode/run-dev-node.sh"
ALTO_CLI="$TOOLS_DIR/alto/src/esm/cli/alto.js"
ARTIFACTS_DIR="$TOOLS_DIR/account-abstraction/artifacts/contracts"
EP_ARTIFACT="$ARTIFACTS_DIR/core/EntryPoint.sol/EntryPoint.json"
FACTORY_ARTIFACT="$ARTIFACTS_DIR/samples/SimpleAccountFactory.sol/SimpleAccountFactory.json"
EP_BYTECODE_FILE="$TOOLS_DIR/entrypoint_v07_bytecode.txt"
FACTORY_BYTECODE_FILE="$TOOLS_DIR/factory_bytecode.txt"

# --- Network ---
RPC="http://127.0.0.1:8547"
BUNDLER_RPC="http://127.0.0.1:4337"
CHAIN_ID=412346
CREATE2_FACTORY="0x4e59b44847b379578588920ca78fbf26c0b4956c"

# --- Keys (dev account + well-known test keys for Alto executors) ---
DEV_PK="0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659"
EXECUTOR_PKS="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d,0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
UTILITY_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
EXECUTOR_ADDRS=("0x70997970C51812dc3A010C7d01b50e0d17dc79C8" "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC")
UTILITY_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# --- State ---
DEVNODE_PID=""
ALTO_PID=""
ENTRYPOINT=""
FACTORY=""
STYLUS_VERIFIER=""
PQ_MODULE=""
LOG_DIR="$PROJECT_ROOT/.dev-stack-logs"

# ============================================================
# Output helpers
# ============================================================
print_success() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
print_error()   { printf '\033[31m✗ %s\033[0m\n' "$1"; }
print_warning() { printf '\033[33m⚠ %s\033[0m\n' "$1"; }
print_info()    { printf '\033[36m  %s\033[0m\n' "$1"; }
print_section() { printf '\n\033[1;35m━━━ %s ━━━\033[0m\n' "$1"; }

# ============================================================
# Cleanup (runs on EXIT, INT, TERM)
# ============================================================
cleanup() {
    echo ""
    print_section "Shutting down"

    if [[ -n "$ALTO_PID" ]] && kill -0 "$ALTO_PID" 2>/dev/null; then
        kill "$ALTO_PID" 2>/dev/null || true
        wait "$ALTO_PID" 2>/dev/null || true
        print_info "Alto bundler stopped"
    fi

    if [[ -n "$DEVNODE_PID" ]] && kill -0 "$DEVNODE_PID" 2>/dev/null; then
        kill "$DEVNODE_PID" 2>/dev/null || true
        wait "$DEVNODE_PID" 2>/dev/null || true
        print_info "Devnode script stopped"
    fi

    # Belt and suspenders — force remove container
    docker rm -f nitro-dev >/dev/null 2>&1 || true
    print_success "Cleanup complete"
}
trap cleanup INT TERM EXIT

# ============================================================
# Preflight checks
# ============================================================
preflight() {
    print_section "Preflight checks"

    local missing=0
    for cmd in docker cast forge node jq curl cargo-stylus; do
        if ! command -v "$cmd" &>/dev/null; then
            print_error "Missing required command: $cmd"
            missing=1
        fi
    done
    [[ $missing -eq 1 ]] && exit 1

    [[ ! -f "$DEVNODE_SCRIPT" ]] && print_error "Devnode script not found: $DEVNODE_SCRIPT" && exit 1
    [[ ! -f "$ALTO_CLI" ]]      && print_error "Alto CLI not found: $ALTO_CLI" && exit 1

    if ! docker info &>/dev/null; then
        print_error "Docker is not running"
        exit 1
    fi

    print_success "All prerequisites met"
}

# ============================================================
# Clean stale state
# ============================================================
clean_stale() {
    print_section "Cleaning stale state"

    # Kill any process holding the bundler port
    local stale_pid
    stale_pid=$(lsof -ti :4337 2>/dev/null || true)
    if [[ -n "$stale_pid" ]]; then
        kill "$stale_pid" 2>/dev/null || true
        sleep 1
        print_info "Killed stale process on port 4337"
    fi

    # Remove stale devnode container
    if docker ps -a --format '{{.Names}}' | grep -q '^nitro-dev$'; then
        docker rm -f nitro-dev >/dev/null 2>&1 || true
        print_info "Removed stale nitro-dev container"
    fi

    mkdir -p "$LOG_DIR"
    print_success "Clean slate"
}

# ============================================================
# Wait for RPC (60s timeout)
# ============================================================
wait_for_rpc() {
    print_section "Waiting for RPC"

    local timeout=60 elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        # Bail if devnode process died
        if ! kill -0 "$DEVNODE_PID" 2>/dev/null; then
            print_error "Devnode script exited unexpectedly"
            print_info "Check $LOG_DIR/devnode.log for details"
            exit 1
        fi

        if curl -sf -X POST -H "Content-Type: application/json" \
            --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}' \
            "$RPC" >/dev/null 2>&1; then
            print_success "RPC responding at $RPC"
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    print_error "RPC failed to respond within ${timeout}s"
    exit 1
}

# ============================================================
# Wait for devnode setup (CREATE2 factory = proxy for "done")
# ============================================================
wait_for_devnode_setup() {
    print_info "Waiting for devnode infrastructure deploys..."

    local timeout=30 elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        if ! kill -0 "$DEVNODE_PID" 2>/dev/null; then
            print_error "Devnode script exited during setup"
            print_info "Check $LOG_DIR/devnode.log for details"
            exit 1
        fi

        local code
        code=$(cast code "$CREATE2_FACTORY" --rpc-url "$RPC" 2>/dev/null || echo "0x")
        if [[ "$code" != "0x" ]]; then
            # Brief pause for remaining deploys (cache manager, stylus deployer)
            sleep 3
            print_success "Devnode setup complete"
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    print_warning "Devnode setup may be incomplete (CREATE2 factory not found)"
}

# ============================================================
# Extract bytecodes from Hardhat artifacts (cached on disk)
# ============================================================
extract_bytecodes() {
    print_section "Bytecode extraction"

    if [[ -f "$EP_BYTECODE_FILE" ]]; then
        print_info "EntryPoint bytecode already cached"
    else
        [[ ! -f "$EP_ARTIFACT" ]] && print_error "EntryPoint artifact not found: $EP_ARTIFACT" && exit 1
        jq -r '.bytecode' "$EP_ARTIFACT" > "$EP_BYTECODE_FILE"
        print_success "Extracted EntryPoint bytecode"
    fi

    if [[ -f "$FACTORY_BYTECODE_FILE" ]]; then
        print_info "Factory bytecode already cached"
    else
        [[ ! -f "$FACTORY_ARTIFACT" ]] && print_error "Factory artifact not found: $FACTORY_ARTIFACT" && exit 1
        jq -r '.bytecode' "$FACTORY_ARTIFACT" > "$FACTORY_BYTECODE_FILE"
        print_success "Extracted Factory bytecode"
    fi
}

# ============================================================
# Deploy EntryPoint v0.7
# ============================================================
deploy_entrypoint() {
    print_section "Deploying EntryPoint v0.7"

    local bytecode output
    bytecode=$(cat "$EP_BYTECODE_FILE")

    output=$(cast send --rpc-url "$RPC" --private-key "$DEV_PK" --create "$bytecode" --json 2>&1)
    ENTRYPOINT=$(echo "$output" | jq -r '.contractAddress')

    if [[ -z "$ENTRYPOINT" || "$ENTRYPOINT" == "null" ]]; then
        print_error "Failed to deploy EntryPoint"
        echo "$output"
        exit 1
    fi

    print_success "EntryPoint deployed at $ENTRYPOINT"
}

# ============================================================
# Deploy SimpleAccountFactory (constructor takes EntryPoint addr)
# ============================================================
deploy_factory() {
    print_section "Deploying SimpleAccountFactory"

    local bytecode constructor_args deploy_data output
    bytecode=$(cat "$FACTORY_BYTECODE_FILE")

    # ABI-encode the EntryPoint address as constructor argument
    constructor_args=$(cast abi-encode "constructor(address)" "$ENTRYPOINT" | sed 's/^0x//')
    deploy_data="${bytecode}${constructor_args}"

    output=$(cast send --rpc-url "$RPC" --private-key "$DEV_PK" --create "$deploy_data" --json 2>&1)
    FACTORY=$(echo "$output" | jq -r '.contractAddress')

    if [[ -z "$FACTORY" || "$FACTORY" == "null" ]]; then
        print_error "Failed to deploy SimpleAccountFactory"
        echo "$output"
        exit 1
    fi

    print_success "Factory deployed at $FACTORY"
}

# ============================================================
# Deploy Stylus ML-DSA verifier
# ============================================================
deploy_stylus_verifier() {
    print_section "Deploying Stylus ML-DSA verifier"

    local output
    # cargo stylus has no --manifest-path flag; must cd into crate directory
    output=$(cd "$PROJECT_ROOT/pq-validator" && cargo stylus deploy \
        --private-key "$DEV_PK" \
        --endpoint "$RPC" \
        --no-verify 2>&1)

    # Strip ANSI codes, extract 0x-prefixed address from deploy output
    STYLUS_VERIFIER=$(echo "$output" | sed 's/\x1b\[[0-9;]*m//g' \
        | grep "deployed code at address:" | grep -oE '0x[0-9a-fA-F]{40}')

    if [[ -z "$STYLUS_VERIFIER" ]]; then
        print_error "Failed to deploy Stylus verifier"
        echo "$output"
        exit 1
    fi

    print_success "Stylus verifier deployed at $STYLUS_VERIFIER"
}

# ============================================================
# Deploy PQValidatorModule (Solidity, constructor takes verifier addr)
# Uses forge build + cast send --create (NOT forge create, which has
# arg-swallowing bugs with --constructor-args variadic parsing)
# ============================================================
deploy_pq_module() {
    print_section "Deploying PQValidatorModule"

    local artifact bytecode constructor_args deploy_data output
    artifact="$PROJECT_ROOT/evm/out/PQValidatorModule.sol/PQValidatorModule.json"

    # Build with forge (need ETH_RPC_URL unset to avoid forge's default RPC behavior)
    (cd "$PROJECT_ROOT/evm" && forge build) >/dev/null 2>&1

    if [[ ! -f "$artifact" ]]; then
        print_error "Forge build artifact not found: $artifact"
        exit 1
    fi

    bytecode=$(jq -r '.bytecode.object' "$artifact")
    constructor_args=$(cast abi-encode "constructor(address)" "$STYLUS_VERIFIER" | sed 's/^0x//')
    deploy_data="${bytecode}${constructor_args}"

    output=$(cast send --rpc-url "$RPC" --private-key "$DEV_PK" --create "$deploy_data" --json 2>&1)
    PQ_MODULE=$(echo "$output" | jq -r '.contractAddress')

    if [[ -z "$PQ_MODULE" || "$PQ_MODULE" == "null" ]]; then
        print_error "Failed to deploy PQValidatorModule"
        echo "$output"
        exit 1
    fi

    # Verify constructor arg was wired correctly
    local stored_verifier
    stored_verifier=$(cast call "$PQ_MODULE" "verifier()(address)" --rpc-url "$RPC" 2>/dev/null || echo "")
    if [[ "$(echo "$stored_verifier" | tr '[:upper:]' '[:lower:]')" != \
          "$(echo "$STYLUS_VERIFIER" | tr '[:upper:]' '[:lower:]')" ]]; then
        print_warning "PQ Module verifier() mismatch: $stored_verifier != $STYLUS_VERIFIER"
    fi

    print_success "PQValidatorModule deployed at $PQ_MODULE"
}

# ============================================================
# Fund executor wallets (10 ETH each from dev account)
# ============================================================
fund_executors() {
    print_section "Funding executor wallets"

    for addr in "${EXECUTOR_ADDRS[@]}" "$UTILITY_ADDR"; do
        cast send --rpc-url "$RPC" --private-key "$DEV_PK" \
            --value "10ether" "$addr" --json >/dev/null 2>&1

        local bal
        bal=$(cast balance --rpc-url "$RPC" "$addr" --ether)
        print_success "$addr → ${bal} ETH"
    done
}

# ============================================================
# Start Alto bundler
# ============================================================
start_alto() {
    print_section "Starting Alto bundler"

    node "$ALTO_CLI" \
        --rpc-url "$RPC" \
        --entrypoints "$ENTRYPOINT" \
        --executor-private-keys "$EXECUTOR_PKS" \
        --utility-private-key "$UTILITY_PK" \
        --chain-type "arbitrum" \
        --safe-mode false \
        --port 4337 \
        --log-level info \
        > "$LOG_DIR/alto.log" 2>&1 &

    ALTO_PID=$!
    print_info "Alto PID: $ALTO_PID"
}

# ============================================================
# Wait for bundler (15s timeout, warning-only on failure)
# ============================================================
wait_for_bundler() {
    print_info "Waiting for bundler..."

    local timeout=15 elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        local response
        response=$(curl -sf -X POST -H "Content-Type: application/json" \
            --data '{"jsonrpc":"2.0","method":"eth_supportedEntryPoints","params":[],"id":1}' \
            "$BUNDLER_RPC" 2>/dev/null || true)

        if [[ -n "$response" ]] && echo "$response" | jq -e '.result' >/dev/null 2>&1; then
            print_success "Bundler responding at $BUNDLER_RPC"
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    print_warning "Bundler did not respond within ${timeout}s (check $LOG_DIR/alto.log)"
}

# ============================================================
# Health checks (6 total — warnings, not hard failures)
# ============================================================
run_health_checks() {
    print_section "Health checks"

    local passed=0 total=8

    # 1. Chain ID
    local chain_id
    chain_id=$(cast chain-id --rpc-url "$RPC" 2>/dev/null || echo "0")
    if [[ "$chain_id" == "$CHAIN_ID" ]]; then
        print_success "Chain ID: $chain_id"
        passed=$((passed + 1))
    else
        print_warning "Chain ID: expected $CHAIN_ID, got $chain_id"
    fi

    # 2. EntryPoint deployed
    local ep_code
    ep_code=$(cast code "$ENTRYPOINT" --rpc-url "$RPC" 2>/dev/null || echo "0x")
    if [[ "$ep_code" != "0x" ]]; then
        print_success "EntryPoint has code"
        passed=$((passed + 1))
    else
        print_warning "EntryPoint has no code at $ENTRYPOINT"
    fi

    # 3. Factory deployed
    local factory_code
    factory_code=$(cast code "$FACTORY" --rpc-url "$RPC" 2>/dev/null || echo "0x")
    if [[ "$factory_code" != "0x" ]]; then
        print_success "Factory has code"
        passed=$((passed + 1))
    else
        print_warning "Factory has no code at $FACTORY"
    fi

    # 4. Stylus verifier deployed
    local stylus_code
    stylus_code=$(cast code "$STYLUS_VERIFIER" --rpc-url "$RPC" 2>/dev/null || echo "0x")
    if [[ "$stylus_code" != "0x" ]]; then
        print_success "Stylus verifier has code"
        passed=$((passed + 1))
    else
        print_warning "Stylus verifier has no code at $STYLUS_VERIFIER"
    fi

    # 5. PQ Validator Module deployed
    local pq_code
    pq_code=$(cast code "$PQ_MODULE" --rpc-url "$RPC" 2>/dev/null || echo "0x")
    if [[ "$pq_code" != "0x" ]]; then
        print_success "PQValidatorModule has code"
        passed=$((passed + 1))
    else
        print_warning "PQValidatorModule has no code at $PQ_MODULE"
    fi

    # 6. Executors funded
    local all_funded=true
    for addr in "${EXECUTOR_ADDRS[@]}" "$UTILITY_ADDR"; do
        local bal
        bal=$(cast balance --rpc-url "$RPC" "$addr" 2>/dev/null || echo "0")
        if [[ "$bal" == "0" ]]; then
            all_funded=false
            break
        fi
    done
    if $all_funded; then
        print_success "Executors funded"
        passed=$((passed + 1))
    else
        print_warning "Some executors have zero balance"
    fi

    # 7. Bundler responds
    local bundler_response
    bundler_response=$(curl -sf -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_supportedEntryPoints","params":[],"id":1}' \
        "$BUNDLER_RPC" 2>/dev/null || true)

    if [[ -n "$bundler_response" ]] && echo "$bundler_response" | jq -e '.result' >/dev/null 2>&1; then
        print_success "Bundler responds"
        passed=$((passed + 1))

        # 8. Bundler EntryPoint matches deployed
        local bundler_ep
        bundler_ep=$(echo "$bundler_response" | jq -r '.result[0]' 2>/dev/null || true)
        if [[ "$(echo "$bundler_ep" | tr '[:upper:]' '[:lower:]')" == \
              "$(echo "$ENTRYPOINT" | tr '[:upper:]' '[:lower:]')" ]]; then
            print_success "Bundler EntryPoint matches deployed"
            passed=$((passed + 1))
        else
            print_warning "Bundler EP ($bundler_ep) != deployed EP ($ENTRYPOINT)"
        fi
    else
        print_warning "Bundler not responding"
        print_warning "Bundler EP check skipped"
    fi

    echo ""
    print_info "Health: $passed/$total checks passed"
}

# ============================================================
# Write .env.local
# ============================================================
write_env_file() {
    print_section "Writing .env.local"

    cat > "$PROJECT_ROOT/.env.local" <<EOF
# Generated by dev-stack.sh — $(date -Iseconds)
LOCAL_RPC=$RPC
BUNDLER_RPC=$BUNDLER_RPC
CHAIN_ID=$CHAIN_ID
ENTRYPOINT=$ENTRYPOINT
SIMPLE_ACCOUNT_FACTORY=$FACTORY
STYLUS_VERIFIER=$STYLUS_VERIFIER
PQ_VALIDATOR_MODULE=$PQ_MODULE
DEV_PRIVATE_KEY=$DEV_PK
EOF

    print_success "Wrote $PROJECT_ROOT/.env.local"
}

# ============================================================
# Main
# ============================================================
main() {
    echo "╔════════════════════════════════════════╗"
    echo "║       Dev Stack Orchestration          ║"
    echo "╚════════════════════════════════════════╝"

    preflight
    clean_stale

    # Start devnode in background (it has its own docker lifecycle)
    print_section "Starting devnode"
    bash -c 'cd "$(dirname "$1")" && bash "$1"' _ "$DEVNODE_SCRIPT" > "$LOG_DIR/devnode.log" 2>&1 &
    DEVNODE_PID=$!
    print_info "Devnode PID: $DEVNODE_PID"

    wait_for_rpc
    wait_for_devnode_setup

    extract_bytecodes
    deploy_entrypoint
    deploy_factory
    deploy_stylus_verifier
    deploy_pq_module
    fund_executors

    start_alto
    wait_for_bundler

    run_health_checks
    write_env_file

    # Summary
    print_section "Ready"
    print_info "RPC:             $RPC"
    print_info "Bundler:         $BUNDLER_RPC"
    print_info "EntryPoint:      $ENTRYPOINT"
    print_info "Factory:         $FACTORY"
    print_info "Stylus Verifier: $STYLUS_VERIFIER"
    print_info "PQ Module:       $PQ_MODULE"
    echo ""
    print_info "source .env.local  # in another terminal"
    print_info "Press Ctrl-C to shut down"

    # Keep alive until Ctrl-C (wait for all background children)
    wait
}

main
