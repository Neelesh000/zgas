// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "../interfaces/IVerifier.sol";
import {MembershipGroth16Verifier} from "./MembershipGroth16Verifier.sol";

/// @notice Adapts the snarkjs-generated MembershipGroth16Verifier (fixed uint[3])
///         to the IVerifier interface (dynamic uint256[]).
contract MembershipVerifier is IVerifier {
    MembershipGroth16Verifier public immutable groth16;

    constructor(MembershipGroth16Verifier _groth16) {
        groth16 = _groth16;
    }

    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[] calldata _pubSignals
    ) external view override returns (bool) {
        require(_pubSignals.length == 3, "MembershipVerifier: expected 3 public signals");
        uint[3] memory signals;
        for (uint i = 0; i < 3; i++) {
            signals[i] = _pubSignals[i];
        }
        return groth16.verifyProof(_pA, _pB, _pC, signals);
    }
}
