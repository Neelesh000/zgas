// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "../interfaces/IVerifier.sol";
import {WithdrawGroth16Verifier} from "./WithdrawGroth16Verifier.sol";

/// @notice Adapts the snarkjs-generated WithdrawGroth16Verifier (fixed uint[7])
///         to the IVerifier interface (dynamic uint256[]).
contract WithdrawVerifier is IVerifier {
    WithdrawGroth16Verifier public immutable groth16;

    constructor(WithdrawGroth16Verifier _groth16) {
        groth16 = _groth16;
    }

    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[] calldata _pubSignals
    ) external view override returns (bool) {
        require(_pubSignals.length == 7, "WithdrawVerifier: expected 7 public signals");
        uint[7] memory signals;
        for (uint i = 0; i < 7; i++) {
            signals[i] = _pubSignals[i];
        }
        return groth16.verifyProof(_pA, _pB, _pC, signals);
    }
}
