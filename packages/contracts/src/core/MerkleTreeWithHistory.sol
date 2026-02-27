// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHasher} from "../interfaces/IHasher.sol";

/// @title MerkleTreeWithHistory
/// @notice Incremental Merkle tree (depth 20, ~1M deposits) with Poseidon hashing.
/// Stores last 30 roots so that proofs generated against recent roots remain valid.
contract MerkleTreeWithHistory {
    uint32 public constant TREE_DEPTH = 20;
    uint32 public constant ROOT_HISTORY_SIZE = 30;

    IHasher public immutable hasher;

    uint32 public currentRootIndex;
    uint32 public nextLeafIndex;

    // Mapping of root index to root value
    mapping(uint256 => bytes32) public roots;
    // Filled subtrees for incremental insertion
    bytes32[TREE_DEPTH] public filledSubtrees;
    // Zero values per level (precomputed)
    bytes32[TREE_DEPTH] public zeros;

    event LeafInserted(bytes32 indexed leaf, uint32 leafIndex, bytes32 newRoot);

    error MerkleTreeFull();

    constructor(IHasher _hasher) {
        hasher = _hasher;

        // Precompute zero values: zeros[0] is the zero leaf, each subsequent
        // level is hash(zeros[i-1], zeros[i-1])
        bytes32 currentZero = bytes32(0);
        for (uint32 i = 0; i < TREE_DEPTH; i++) {
            zeros[i] = currentZero;
            filledSubtrees[i] = currentZero;
            currentZero = _hashLeftRight(currentZero, currentZero);
        }
        // Store the initial root
        roots[0] = currentZero;
    }

    /// @notice Insert a leaf into the tree and update the root.
    /// @param leaf The leaf value (commitment) to insert.
    /// @return leafIndex The index of the inserted leaf.
    function _insert(bytes32 leaf) internal returns (uint32 leafIndex) {
        leafIndex = nextLeafIndex;
        if (leafIndex >= uint32(2) ** TREE_DEPTH) revert MerkleTreeFull();

        uint32 currentIndex = leafIndex;
        bytes32 currentLevelHash = leaf;
        bytes32 left;
        bytes32 right;

        for (uint32 i = 0; i < TREE_DEPTH; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros[i];
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = _hashLeftRight(left, right);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentLevelHash;
        nextLeafIndex = leafIndex + 1;

        emit LeafInserted(leaf, leafIndex, currentLevelHash);
    }

    /// @notice Check if a root is in the recent root history.
    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;
        uint32 idx = currentRootIndex;
        for (uint32 i = 0; i < ROOT_HISTORY_SIZE; i++) {
            if (roots[idx] == root) return true;
            if (idx == 0) {
                idx = ROOT_HISTORY_SIZE - 1;
            } else {
                idx--;
            }
        }
        return false;
    }

    /// @notice Get the most recent root.
    function getLastRoot() public view returns (bytes32) {
        return roots[currentRootIndex];
    }

    function _hashLeftRight(bytes32 left, bytes32 right) internal view returns (bytes32) {
        return hasher.poseidon([left, right]);
    }
}
