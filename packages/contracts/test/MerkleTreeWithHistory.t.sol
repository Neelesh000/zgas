// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {MerkleTreeWithHistory} from "../src/core/MerkleTreeWithHistory.sol";
import {MockHasher} from "../src/mocks/MockHasher.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";

/// @notice Expose internal _insert for testing
contract TestMerkleTree is MerkleTreeWithHistory {
    constructor(IHasher _hasher) MerkleTreeWithHistory(_hasher) {}

    function insert(bytes32 leaf) external returns (uint32) {
        return _insert(leaf);
    }
}

contract MerkleTreeWithHistoryTest is Test {
    TestMerkleTree tree;
    MockHasher hasher;

    function setUp() public {
        hasher = new MockHasher();
        tree = new TestMerkleTree(IHasher(address(hasher)));
    }

    function test_initialRoot() public view {
        bytes32 root = tree.getLastRoot();
        assertTrue(root != bytes32(0), "Initial root should not be zero");
    }

    function test_insertUpdatesRoot() public {
        bytes32 rootBefore = tree.getLastRoot();
        tree.insert(bytes32(uint256(1)));
        bytes32 rootAfter = tree.getLastRoot();
        assertTrue(rootBefore != rootAfter, "Root should change after insertion");
    }

    function test_insertedRootIsKnown() public {
        tree.insert(bytes32(uint256(1)));
        bytes32 root = tree.getLastRoot();
        assertTrue(tree.isKnownRoot(root), "Inserted root should be known");
    }

    function test_multipleInsertions() public {
        for (uint256 i = 1; i <= 5; i++) {
            tree.insert(bytes32(i));
        }
        bytes32 root = tree.getLastRoot();
        assertTrue(tree.isKnownRoot(root), "Latest root should be known");
    }

    function test_rootHistory() public {
        bytes32[] memory roots = new bytes32[](10);
        for (uint256 i = 0; i < 10; i++) {
            tree.insert(bytes32(i + 1));
            roots[i] = tree.getLastRoot();
        }
        // All recent roots should be known
        for (uint256 i = 0; i < 10; i++) {
            assertTrue(tree.isKnownRoot(roots[i]), "Recent root should be known");
        }
    }

    function test_oldRootExpiresAfterHistorySize() public {
        // Insert ROOT_HISTORY_SIZE + 1 leaves to push out the initial root
        bytes32 initialRoot = tree.getLastRoot();
        for (uint256 i = 0; i < 31; i++) {
            tree.insert(bytes32(i + 1));
        }
        assertFalse(tree.isKnownRoot(initialRoot), "Initial root should expire from history");
    }

    function test_zeroRootIsNotKnown() public view {
        assertFalse(tree.isKnownRoot(bytes32(0)), "Zero root should not be known");
    }

    function test_leafIndexIncrementsCorrectly() public {
        assertEq(tree.nextLeafIndex(), 0);
        tree.insert(bytes32(uint256(1)));
        assertEq(tree.nextLeafIndex(), 1);
        tree.insert(bytes32(uint256(2)));
        assertEq(tree.nextLeafIndex(), 2);
    }

    function test_differentLeavesProduceDifferentRoots() public {
        tree.insert(bytes32(uint256(1)));
        bytes32 root1 = tree.getLastRoot();

        TestMerkleTree tree2 = new TestMerkleTree(IHasher(address(hasher)));
        tree2.insert(bytes32(uint256(2)));
        bytes32 root2 = tree2.getLastRoot();

        assertTrue(root1 != root2, "Different leaves should produce different roots");
    }
}
