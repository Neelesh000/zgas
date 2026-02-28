// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IHasher {
    function poseidon(bytes32[2] calldata inputs) external view returns (bytes32);
}
