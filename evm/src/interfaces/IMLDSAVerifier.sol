// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title IMLDSAVerifier
/// @notice Interface for the Stylus ML-DSA-65 signature verifier contract.
/// @dev Matches the ABI exported by `cargo stylus export-abi` from pq-validator.
interface IMLDSAVerifier {
    function verify(
        bytes calldata publicKey,
        bytes32 message,
        bytes calldata signature
    ) external view returns (bool);
}