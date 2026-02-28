// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHasher} from "../interfaces/IHasher.sol";

/// @notice Wraps a circomlibjs-generated PoseidonT3 contract (deployed as raw bytecode)
///         to conform to the IHasher interface used by MerkleTreeWithHistory.
/// @dev    The PoseidonT3 contract has: function poseidon(uint256[2]) pure returns (uint256)
contract PoseidonHasher is IHasher {
    address public immutable poseidonT3;

    constructor(address _poseidonT3) {
        require(_poseidonT3 != address(0), "PoseidonHasher: zero address");
        poseidonT3 = _poseidonT3;
    }

    function poseidon(bytes32[2] calldata inputs) external view override returns (bytes32) {
        // The PoseidonT3 contract expects: poseidon(uint256[2]) returns (uint256)
        // bytes32 and uint256 are ABI-compatible, so we encode directly.
        (bool success, bytes memory result) = poseidonT3.staticcall(
            abi.encodeWithSignature("poseidon(uint256[2])", [uint256(inputs[0]), uint256(inputs[1])])
        );
        require(success, "PoseidonHasher: call failed");
        return bytes32(abi.decode(result, (uint256)));
    }
}
