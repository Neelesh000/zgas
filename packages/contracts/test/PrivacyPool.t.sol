// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {PrivacyPool} from "../src/core/PrivacyPool.sol";
import {MockHasher} from "../src/mocks/MockHasher.sol";
import {MockVerifier} from "../src/mocks/MockVerifier.sol";
import {MockASPRegistry} from "../src/mocks/MockASPRegistry.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {IASPRegistry} from "../src/interfaces/IASPRegistry.sol";

contract PrivacyPoolTest is Test {
    PrivacyPool pool;
    MockHasher hasher;
    MockVerifier verifier;
    MockASPRegistry aspRegistry;

    uint256 constant DENOMINATION = 1 ether;
    address payable recipient = payable(address(0xBEEF));
    address payable relayer = payable(address(0xCAFE));
    bytes32 constant COMMITMENT = bytes32(uint256(0x1234));
    bytes32 constant NULLIFIER_HASH = bytes32(uint256(0x5678));
    bytes32 constant ASP_ROOT = bytes32(uint256(0xABCD));

    function setUp() public {
        hasher = new MockHasher();
        verifier = new MockVerifier();
        aspRegistry = new MockASPRegistry();
        aspRegistry.setASPRoot(ASP_ROOT);

        pool = new PrivacyPool(
            IHasher(address(hasher)),
            IVerifier(address(verifier)),
            IASPRegistry(address(aspRegistry)),
            DENOMINATION
        );
    }

    function _makeProof() internal pure returns (bytes memory) {
        uint256[2] memory pA = [uint256(0), uint256(0)];
        uint256[2][2] memory pB = [[uint256(0), uint256(0)], [uint256(0), uint256(0)]];
        uint256[2] memory pC = [uint256(0), uint256(0)];
        return abi.encode(pA, pB, pC);
    }

    // ===== Deposit Tests =====

    function test_deposit() public {
        pool.deposit{value: DENOMINATION}(COMMITMENT);
        assertTrue(pool.commitments(COMMITMENT), "Commitment should be stored");
    }

    function test_deposit_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit PrivacyPool.Deposit(COMMITMENT, 0, block.timestamp, DENOMINATION);
        pool.deposit{value: DENOMINATION}(COMMITMENT);
    }

    function test_deposit_wrongDenomination() public {
        vm.expectRevert(PrivacyPool.InvalidDenomination.selector);
        pool.deposit{value: 0.5 ether}(COMMITMENT);
    }

    function test_deposit_duplicateCommitment() public {
        pool.deposit{value: DENOMINATION}(COMMITMENT);
        vm.expectRevert(PrivacyPool.CommitmentAlreadyExists.selector);
        pool.deposit{value: DENOMINATION}(COMMITMENT);
    }

    function test_deposit_multipleCommitments() public {
        pool.deposit{value: DENOMINATION}(bytes32(uint256(1)));
        pool.deposit{value: DENOMINATION}(bytes32(uint256(2)));
        pool.deposit{value: DENOMINATION}(bytes32(uint256(3)));
        assertEq(address(pool).balance, 3 ether);
    }

    // ===== Withdraw Tests =====

    function test_withdraw() public {
        pool.deposit{value: DENOMINATION}(COMMITMENT);
        bytes32 root = pool.getLastRoot();

        pool.withdraw(
            _makeProof(),
            root,
            NULLIFIER_HASH,
            recipient,
            relayer,
            0,
            0,
            ASP_ROOT
        );

        assertTrue(pool.nullifierHashes(NULLIFIER_HASH), "Nullifier should be marked spent");
        assertEq(recipient.balance, DENOMINATION);
    }

    function test_withdraw_withFee() public {
        pool.deposit{value: DENOMINATION}(COMMITMENT);
        bytes32 root = pool.getLastRoot();
        uint256 fee = 0.01 ether;

        pool.withdraw(
            _makeProof(),
            root,
            NULLIFIER_HASH,
            recipient,
            relayer,
            fee,
            0,
            ASP_ROOT
        );

        assertEq(recipient.balance, DENOMINATION - fee);
        assertEq(relayer.balance, fee);
    }

    function test_withdraw_doubleSpend() public {
        pool.deposit{value: DENOMINATION}(COMMITMENT);
        bytes32 root = pool.getLastRoot();

        pool.withdraw(
            _makeProof(),
            root,
            NULLIFIER_HASH,
            recipient,
            relayer,
            0,
            0,
            ASP_ROOT
        );

        vm.expectRevert(PrivacyPool.NullifierAlreadySpent.selector);
        pool.withdraw(
            _makeProof(),
            root,
            NULLIFIER_HASH,
            recipient,
            relayer,
            0,
            0,
            ASP_ROOT
        );
    }

    function test_withdraw_invalidRoot() public {
        pool.deposit{value: DENOMINATION}(COMMITMENT);

        vm.expectRevert(PrivacyPool.InvalidMerkleRoot.selector);
        pool.withdraw(
            _makeProof(),
            bytes32(uint256(0xDEAD)),
            NULLIFIER_HASH,
            recipient,
            relayer,
            0,
            0,
            ASP_ROOT
        );
    }

    function test_withdraw_invalidProof() public {
        pool.deposit{value: DENOMINATION}(COMMITMENT);
        bytes32 root = pool.getLastRoot();
        verifier.setVerifyResult(false);

        vm.expectRevert(PrivacyPool.InvalidWithdrawProof.selector);
        pool.withdraw(
            _makeProof(),
            root,
            NULLIFIER_HASH,
            recipient,
            relayer,
            0,
            0,
            ASP_ROOT
        );
    }

    function test_withdraw_feeTooHigh() public {
        pool.deposit{value: DENOMINATION}(COMMITMENT);
        bytes32 root = pool.getLastRoot();

        vm.expectRevert(PrivacyPool.InvalidFee.selector);
        pool.withdraw(
            _makeProof(),
            root,
            NULLIFIER_HASH,
            recipient,
            relayer,
            DENOMINATION + 1,
            0,
            ASP_ROOT
        );
    }
}
