// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "../interfaces/IVerifier.sol";

/// @notice Mock verifier that always returns true. For testing only.
contract MockVerifier is IVerifier {
    bool public shouldVerify = true;

    function setVerifyResult(bool _result) external {
        shouldVerify = _result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[] calldata
    ) external view override returns (bool) {
        return shouldVerify;
    }
}
