pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "./lib/merkleTree.circom";

/// @title Withdraw
/// @notice Proves that the withdrawer knows a valid (secret, nullifier) pair
/// whose commitment is in both the pool Merkle tree and the ASP Merkle tree.
/// Public inputs are bound to the proof by squaring to prevent malleability.
template Withdraw(levels) {
    // Public inputs (7)
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input relayer;
    signal input fee;
    signal input refund;
    signal input aspRoot;

    // Private inputs
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input aspPathElements[levels];
    signal input aspPathIndices[levels];

    // 1. Compute commitment = Poseidon(secret, nullifier)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== nullifier;
    signal commitment;
    commitment <== commitmentHasher.out;

    // 2. Compute nullifierHash = Poseidon(nullifier) and verify it matches
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.out === nullifierHash;

    // 3. Verify commitment in pool Merkle tree
    component poolTreeChecker = MerkleTreeChecker(levels);
    poolTreeChecker.leaf <== commitment;
    poolTreeChecker.root <== root;
    for (var i = 0; i < levels; i++) {
        poolTreeChecker.pathElements[i] <== pathElements[i];
        poolTreeChecker.pathIndices[i] <== pathIndices[i];
    }

    // 4. Verify commitment in ASP Merkle tree
    component aspTreeChecker = MerkleTreeChecker(levels);
    aspTreeChecker.leaf <== commitment;
    aspTreeChecker.root <== aspRoot;
    for (var i = 0; i < levels; i++) {
        aspTreeChecker.pathElements[i] <== aspPathElements[i];
        aspTreeChecker.pathIndices[i] <== aspPathIndices[i];
    }

    // 5. Square public inputs to bind them to the proof (prevent malleability)
    signal recipientSquare;
    recipientSquare <== recipient * recipient;

    signal relayerSquare;
    relayerSquare <== relayer * relayer;

    signal feeSquare;
    feeSquare <== fee * fee;

    signal refundSquare;
    refundSquare <== refund * refund;

    // 6. Range-check all inputs to 248 bits
    component secretBits = Num2Bits(248);
    secretBits.in <== secret;

    component nullifierBits = Num2Bits(248);
    nullifierBits.in <== nullifier;
}

component main {public [root, nullifierHash, recipient, relayer, fee, refund, aspRoot]} = Withdraw(20);
