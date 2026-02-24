// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";
import {PQValidatorModule} from "../src/PQValidatorModule.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {VALIDATION_SUCCESS, VALIDATION_FAILED, MODULE_TYPE_VALIDATOR} from "erc7579/interfaces/IERC7579Module.sol";
import {IMLDSAVerifier} from "../src/interfaces/IMLDSAVerifier.sol";

contract PQValidatorStubTest is Test {
    PQValidatorModule internal validator;
    address internal mockVerifier;

    // Dummy 1,952-byte ML-DSA-65 public key for testing
    bytes internal dummyPubKey;

    function setUp() public {
        mockVerifier = makeAddr("verifier");
        validator = new PQValidatorModule(mockVerifier);

        // Build a 1,952-byte dummy key
        dummyPubKey = new bytes(1952);
        for (uint256 i = 0; i < 1952; i++) {
            dummyPubKey[i] = bytes1(uint8(i % 256));
        }
    }

    // ─── Exercise 2.1: Interface stubs ───────────────────────────────

    function test_isModuleType_validator() public view {
        assertTrue(validator.isModuleType(MODULE_TYPE_VALIDATOR));
    }

    function test_isModuleType_rejectsOther() public view {
        assertFalse(validator.isModuleType(2));
        assertFalse(validator.isModuleType(3));
        assertFalse(validator.isModuleType(99));
    }

    function test_stub_validateUserOp_rejects() public {
        PackedUserOperation memory userOp;
        uint256 result = validator.validateUserOp(userOp, bytes32(0));
        assertEq(result, VALIDATION_FAILED);
    }

    function test_stub_isValidSignatureWithSender_rejects() public view {
        bytes4 result = validator.isValidSignatureWithSender(
            address(this),
            bytes32(0),
            ""
        );
        assertEq(result, bytes4(0xffffffff));
    }

    // ─── Exercise 2.2: Public key storage ────────────────────────────

    function test_onInstall_storesPubKey() public {
        // Simulate call from a smart account
        address smartAccount = makeAddr("account1");
        vm.prank(smartAccount);
        validator.onInstall(dummyPubKey);

        assertTrue(validator.isInitialized(smartAccount));
    }

    function test_onInstall_revertsIfAlreadyInitialized() public {
        address smartAccount = makeAddr("account1");

        vm.prank(smartAccount);
        validator.onInstall(dummyPubKey);

        // Second install should revert
        vm.prank(smartAccount);
        vm.expectRevert();
        validator.onInstall(dummyPubKey);
    }

    function test_onUninstall_clearsKey() public {
        address smartAccount = makeAddr("account1");

        vm.prank(smartAccount);
        validator.onInstall(dummyPubKey);
        assertTrue(validator.isInitialized(smartAccount));

        vm.prank(smartAccount);
        validator.onUninstall("");

        assertFalse(validator.isInitialized(smartAccount));
    }

    function test_isInitialized_falseByDefault() public {
        assertFalse(validator.isInitialized(makeAddr("nobody")));
    }

    // ─── Exercise 2.3: Verification logic ────────────────────────────

    function test_validateUserOp_validSig() public {
        address smartAccount = makeAddr("account1");
        vm.prank(smartAccount);
        validator.onInstall(dummyPubKey);

        // Mock verifier to return true
        vm.mockCall(
            mockVerifier,
            abi.encodeWithSelector(IMLDSAVerifier.verify.selector),
            abi.encode(true)
        );

        PackedUserOperation memory userOp;
        userOp.signature = hex"deadbeef";

        vm.prank(smartAccount);
        uint256 result = validator.validateUserOp(userOp, bytes32(uint256(1)));
        assertEq(result, VALIDATION_SUCCESS);
    }

    function test_validateUserOp_invalidSig() public {
        address smartAccount = makeAddr("account1");
        vm.prank(smartAccount);
        validator.onInstall(dummyPubKey);

        vm.mockCall(
            mockVerifier,
            abi.encodeWithSelector(IMLDSAVerifier.verify.selector),
            abi.encode(false)
        );

        PackedUserOperation memory userOp;
        userOp.signature = hex"deadbeef";

        vm.prank(smartAccount);
        uint256 result = validator.validateUserOp(userOp, bytes32(uint256(1)));
        assertEq(result, VALIDATION_FAILED);
    }

    function test_isValidSigWithSender_validSig() public {
        address smartAccount = makeAddr("account1");
        vm.prank(smartAccount);
        validator.onInstall(dummyPubKey);

        vm.mockCall(
            mockVerifier,
            abi.encodeWithSelector(IMLDSAVerifier.verify.selector),
            abi.encode(true)
        );

        vm.prank(smartAccount);
        bytes4 result = validator.isValidSignatureWithSender(
            address(0xdead),
            bytes32(uint256(1)),
            hex"cafebabe"
        );
        assertEq(result, bytes4(0x1626ba7e));
    }

    function test_isValidSigWithSender_bindsSenderContext() public {
        address smartAccount = makeAddr("account1");
        address sender = address(0xdead);
        bytes32 hash = bytes32(uint256(1));
        bytes memory sig = hex"cafebabe";

        vm.prank(smartAccount);
        validator.onInstall(dummyPubKey);

        bytes32 senderBoundHash = keccak256(
            abi.encodePacked(address(validator), block.chainid, smartAccount, sender, hash)
        );
        bytes memory expectedCall = abi.encodeWithSelector(
            IMLDSAVerifier.verify.selector,
            dummyPubKey,
            senderBoundHash,
            sig
        );

        vm.expectCall(mockVerifier, expectedCall);
        vm.mockCall(mockVerifier, expectedCall, abi.encode(true));

        vm.prank(smartAccount);
        bytes4 result = validator.isValidSignatureWithSender(sender, hash, sig);
        assertEq(result, bytes4(0x1626ba7e));
    }

    function test_isValidSigWithSender_invalidSig() public {
        address smartAccount = makeAddr("account1");
        vm.prank(smartAccount);
        validator.onInstall(dummyPubKey);

        vm.mockCall(
            mockVerifier,
            abi.encodeWithSelector(IMLDSAVerifier.verify.selector),
            abi.encode(false)
        );

        vm.prank(smartAccount);
        bytes4 result = validator.isValidSignatureWithSender(
            address(0xdead),
            bytes32(uint256(1)),
            hex"cafebabe"
        );
        assertEq(result, bytes4(0xffffffff));
    }

    // ─── Exercise 2.2: Account isolation ───────────────────────────────

    function test_multipleAccounts_independent() public {
        address account1 = makeAddr("account1");
        address account2 = makeAddr("account2");

        vm.prank(account1);
        validator.onInstall(dummyPubKey);

        assertTrue(validator.isInitialized(account1));
        assertFalse(validator.isInitialized(account2));

        vm.prank(account2);
        validator.onInstall(dummyPubKey);

        assertTrue(validator.isInitialized(account1));
        assertTrue(validator.isInitialized(account2));
    }
}
