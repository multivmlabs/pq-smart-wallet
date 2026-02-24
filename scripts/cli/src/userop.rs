use alloy_primitives::{Address, B256, U256, keccak256};
use alloy_sol_types::SolValue;

/// ERC-4337 v0.7 PackedUserOperation fields.
///
/// See EntryPoint v0.7 source:
/// https://github.com/eth-infinitism/account-abstraction/blob/v0.7.0/contracts/interfaces/PackedUserOperation.sol
pub struct PackedUserOperation {
    pub sender: Address,
    pub nonce: U256,
    pub init_code: Vec<u8>,
    pub call_data: Vec<u8>,
    pub account_gas_limits: B256,
    pub pre_verification_gas: U256,
    pub gas_fees: B256,
    pub paymaster_and_data: Vec<u8>,
    pub signature: Vec<u8>,
}

/// Compute the userOpHash exactly as EntryPoint v0.7 does.
///
/// The EntryPoint computes this in two steps:
/// 1. Pack the UserOp (all fields except signature, with dynamic fields individually hashed)
/// 2. Hash the packed data with entrypoint address and chain ID
///
/// Reference: EntryPoint.getUserOpHash() and EntryPoint._packUserOp()
pub fn compute_user_op_hash(
    user_op: &PackedUserOperation,
    entry_point: Address,
    chain_id: U256,
) -> B256 {
    // Step 1: pack the UserOp (all fields except signature, dynamic fields hashed)
    let packed = (
        user_op.sender,
        user_op.nonce,
        keccak256(&user_op.init_code),
        keccak256(&user_op.call_data),
        user_op.account_gas_limits,
        user_op.pre_verification_gas,
        user_op.gas_fees,
        keccak256(&user_op.paymaster_and_data),
    )
        .abi_encode();

    // Step 2: hash packed data with entry_point and chain_id
    let packed_hash = keccak256(&packed);
    keccak256(&(packed_hash, entry_point, chain_id).abi_encode())
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::address;

    #[test]
    fn test_empty_userop_hash_is_deterministic() {
        let op = PackedUserOperation {
            sender: address!("0x0000000000000000000000000000000000000001"),
            nonce: U256::ZERO,
            init_code: vec![],
            call_data: vec![],
            account_gas_limits: B256::ZERO,
            pre_verification_gas: U256::ZERO,
            gas_fees: B256::ZERO,
            paymaster_and_data: vec![],
            signature: vec![],
        };
        let ep = address!("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
        let chain_id = U256::from(412346);

        let hash1 = compute_user_op_hash(&op, ep, chain_id);
        let hash2 = compute_user_op_hash(&op, ep, chain_id);
        assert_eq!(hash1, hash2, "same inputs must produce same hash");
    }

    // TODO: Write another test that makes sure that our output is the same as the library's way of packing
}
