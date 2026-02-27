pragma circom 2.1.6;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/mux1.circom";

/// @title HashLeftRight
/// @notice Poseidon hash of two inputs (left, right).
template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    hash <== hasher.out;
}

/// @title MerkleTreeChecker
/// @notice Verifies a Merkle inclusion proof using Poseidon hashing.
/// @param levels The depth of the Merkle tree.
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels]; // 0 = left, 1 = right

    component hashers[levels];
    component mux[levels];

    signal currentHash[levels + 1];
    currentHash[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // Ensure pathIndices are binary
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Select left/right based on pathIndices
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== currentHash[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== currentHash[i];
        mux[i].s <== pathIndices[i];

        // Hash left and right
        hashers[i] = HashLeftRight();
        hashers[i].left <== mux[i].out[0];
        hashers[i].right <== mux[i].out[1];

        currentHash[i + 1] <== hashers[i].hash;
    }

    // Verify the computed root matches the expected root
    root === currentHash[levels];
}
