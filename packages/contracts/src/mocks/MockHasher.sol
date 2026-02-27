// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHasher} from "../interfaces/IHasher.sol";

/// @notice Mock Poseidon hasher for testing. Uses keccak256 as a stand-in.
contract MockHasher is IHasher {
    function poseidon(bytes32[2] calldata inputs) external pure override returns (bytes32) {
        return keccak256(abi.encodePacked(inputs[0], inputs[1]));
    }
}
