pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "./lib/merkleTree.circom";

/// @title Membership
/// @notice Lightweight proof for gas sponsorship via the paymaster.
/// Proves membership in both the pool and ASP trees using a domain-separated
/// nullifier (distinct from withdrawal nullifier) so one deposit supports
/// both withdrawal AND gas sponsorship.
template Membership(levels) {
    // Public inputs (3)
    signal input root;
    signal input nullifierHash;
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

    // 2. Domain-separated nullifier for sponsorship:
    //    sponsorshipNullifierHash = Poseidon(nullifier, 2)
    //    This is distinct from withdrawal nullifier = Poseidon(nullifier)
    component sponsorNullifierHasher = Poseidon(2);
    sponsorNullifierHasher.inputs[0] <== nullifier;
    sponsorNullifierHasher.inputs[1] <== 2; // Domain separator
    sponsorNullifierHasher.out === nullifierHash;

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

    // 5. Range-check inputs to 248 bits
    component secretBits = Num2Bits(248);
    secretBits.in <== secret;

    component nullifierBits = Num2Bits(248);
    nullifierBits.in <== nullifier;
}

component main {public [root, nullifierHash, aspRoot]} = Membership(20);
