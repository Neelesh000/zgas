// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ASPRegistry} from "../src/compliance/ASPRegistry.sol";

contract ASPRegistryTest is Test {
    ASPRegistry registry;
    address owner = address(this);
    address nonOwner = address(0x1234);

    function setUp() public {
        registry = new ASPRegistry(owner);
    }

    function test_updateASPRoot() public {
        bytes32 root = bytes32(uint256(1));
        registry.updateASPRoot(root);
        assertTrue(registry.isKnownASPRoot(root));
        assertEq(registry.getLastASPRoot(), root);
    }

    function test_updateASPRoot_onlyOwner() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        registry.updateASPRoot(bytes32(uint256(1)));
    }

    function test_rootHistory() public {
        bytes32[] memory roots = new bytes32[](10);
        for (uint256 i = 0; i < 10; i++) {
            roots[i] = bytes32(i + 1);
            registry.updateASPRoot(roots[i]);
        }
        for (uint256 i = 0; i < 10; i++) {
            assertTrue(registry.isKnownASPRoot(roots[i]));
        }
    }

    function test_zeroRootNotKnown() public view {
        assertFalse(registry.isKnownASPRoot(bytes32(0)));
    }

    function test_blockCommitment() public {
        bytes32 commitment = bytes32(uint256(0xABCD));
        registry.blockCommitment(commitment, "Sanctioned");
        assertTrue(registry.isBlocked(commitment));
        assertEq(registry.blockReasons(commitment), "Sanctioned");
    }

    function test_unblockCommitment() public {
        bytes32 commitment = bytes32(uint256(0xABCD));
        registry.blockCommitment(commitment, "Sanctioned");
        registry.unblockCommitment(commitment);
        assertFalse(registry.isBlocked(commitment));
    }

    function test_unblockCommitment_notBlocked() public {
        vm.expectRevert(ASPRegistry.CommitmentNotBlocked.selector);
        registry.unblockCommitment(bytes32(uint256(0xABCD)));
    }

    function test_oldRootExpires() public {
        bytes32 firstRoot = bytes32(uint256(1));
        registry.updateASPRoot(firstRoot);

        // Push 30 more roots to expire the first one
        for (uint256 i = 2; i <= 31; i++) {
            registry.updateASPRoot(bytes32(i));
        }
        assertFalse(registry.isKnownASPRoot(firstRoot));
    }
}
