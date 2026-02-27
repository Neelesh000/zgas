// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IASPRegistry} from "../interfaces/IASPRegistry.sol";

/// @notice Mock ASP registry that accepts any non-zero root. For testing only.
contract MockASPRegistry is IASPRegistry {
    mapping(bytes32 => bool) public knownRoots;
    bytes32 public lastRoot;

    function setASPRoot(bytes32 root) external {
        knownRoots[root] = true;
        lastRoot = root;
    }

    function isKnownASPRoot(bytes32 root) external view override returns (bool) {
        return knownRoots[root];
    }

    function getLastASPRoot() external view override returns (bytes32) {
        return lastRoot;
    }
}
