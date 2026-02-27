// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IASPRegistry} from "../interfaces/IASPRegistry.sol";

/// @title ASPRegistry
/// @notice Association Set Provider registry that maintains an approved-commitment
/// Merkle root. The operator (upgradeable to multisig/DAO) publishes new ASP roots
/// after screening deposits against sanctions lists. Maintains a root history
/// (last 30 roots) for async proof generation.
contract ASPRegistry is IASPRegistry, Ownable {
    uint32 public constant ROOT_HISTORY_SIZE = 30;

    uint32 public currentRootIndex;
    mapping(uint256 => bytes32) public aspRoots;
    mapping(bytes32 => bool) public blockedCommitments;
    mapping(bytes32 => string) public blockReasons;

    event ASPRootUpdated(bytes32 indexed newRoot, uint256 timestamp);
    event CommitmentBlocked(bytes32 indexed commitment, string reason);
    event CommitmentUnblocked(bytes32 indexed commitment);

    error RootAlreadyKnown();
    error CommitmentNotBlocked();

    constructor(address _owner) Ownable(_owner) {
        // Initialize with zero root
        aspRoots[0] = bytes32(0);
    }

    /// @notice Publish a new approved-commitment Merkle root.
    /// @param newRoot The new ASP Merkle root.
    function updateASPRoot(bytes32 newRoot) external onlyOwner {
        uint32 newIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newIndex;
        aspRoots[newIndex] = newRoot;
        emit ASPRootUpdated(newRoot, block.timestamp);
    }

    /// @notice Block a commitment (sanctioned depositor).
    /// @param commitment The commitment to block.
    /// @param reason Human-readable reason for blocking.
    function blockCommitment(bytes32 commitment, string calldata reason) external onlyOwner {
        blockedCommitments[commitment] = true;
        blockReasons[commitment] = reason;
        emit CommitmentBlocked(commitment, reason);
    }

    /// @notice Unblock a previously blocked commitment.
    /// @param commitment The commitment to unblock.
    function unblockCommitment(bytes32 commitment) external onlyOwner {
        if (!blockedCommitments[commitment]) revert CommitmentNotBlocked();
        blockedCommitments[commitment] = false;
        delete blockReasons[commitment];
        emit CommitmentUnblocked(commitment);
    }

    /// @notice Check if a root is in the recent ASP root history.
    function isKnownASPRoot(bytes32 root) external view override returns (bool) {
        if (root == bytes32(0)) return false;
        uint32 idx = currentRootIndex;
        for (uint32 i = 0; i < ROOT_HISTORY_SIZE; i++) {
            if (aspRoots[idx] == root) return true;
            if (idx == 0) {
                idx = ROOT_HISTORY_SIZE - 1;
            } else {
                idx--;
            }
        }
        return false;
    }

    /// @notice Get the most recent ASP root.
    function getLastASPRoot() external view override returns (bytes32) {
        return aspRoots[currentRootIndex];
    }

    /// @notice Check if a commitment is blocked.
    function isBlocked(bytes32 commitment) external view returns (bool) {
        return blockedCommitments[commitment];
    }
}
