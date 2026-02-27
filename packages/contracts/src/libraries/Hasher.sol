// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHasher} from "../interfaces/IHasher.sol";

/// @title Hasher
/// @notice Wraps an external Poseidon hash contract for 2-input hashing.
/// The Poseidon contract is deployed separately (generated via circomlibjs)
/// and called via staticcall for gas efficiency.
library Hasher {
    function poseidon2(IHasher hasher, bytes32 left, bytes32 right) internal view returns (bytes32) {
        return hasher.poseidon([left, right]);
    }
}
