#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
PTAU_DIR="$ROOT_DIR/ptau"
CIRCUITS_DIR="$ROOT_DIR/circuits"

# Use local snarkjs from node_modules
export PATH="$ROOT_DIR/node_modules/.bin:$PATH"

mkdir -p "$BUILD_DIR" "$PTAU_DIR"

PTAU_FILE="$PTAU_DIR/powersOfTau28_hez_final_17.ptau"

# Download powers of tau if not present
if [ ! -f "$PTAU_FILE" ]; then
    echo "Downloading powers of tau (2^17)..."
    curl -L -o "$PTAU_FILE" \
        "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_17.ptau"
fi

build_circuit() {
    local CIRCUIT_NAME=$1
    local CIRCUIT_FILE="$CIRCUITS_DIR/$CIRCUIT_NAME.circom"
    local CIRCUIT_BUILD_DIR="$BUILD_DIR/$CIRCUIT_NAME"

    echo "=== Building $CIRCUIT_NAME ==="
    mkdir -p "$CIRCUIT_BUILD_DIR"

    # Compile circuit
    echo "Compiling $CIRCUIT_NAME..."
    circom "$CIRCUIT_FILE" \
        --r1cs \
        --wasm \
        --sym \
        -o "$CIRCUIT_BUILD_DIR"

    echo "R1CS info:"
    snarkjs r1cs info "$CIRCUIT_BUILD_DIR/$CIRCUIT_NAME.r1cs"

    # Phase 2 setup
    echo "Generating zkey (phase 2)..."
    snarkjs groth16 setup \
        "$CIRCUIT_BUILD_DIR/$CIRCUIT_NAME.r1cs" \
        "$PTAU_FILE" \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_0000.zkey"

    # Contribution 1
    echo "Applying contribution 1..."
    snarkjs zkey contribute \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_0000.zkey" \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_0001.zkey" \
        --name="Contributor 1" -v -e="random entropy 1 $(date +%s)"

    # Contribution 2
    echo "Applying contribution 2..."
    snarkjs zkey contribute \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_0001.zkey" \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_0002.zkey" \
        --name="Contributor 2" -v -e="random entropy 2 $(date +%s)"

    # Contribution 3
    echo "Applying contribution 3..."
    snarkjs zkey contribute \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_0002.zkey" \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_0003.zkey" \
        --name="Contributor 3" -v -e="random entropy 3 $(date +%s)"

    # Finalize (apply random beacon)
    echo "Finalizing zkey..."
    snarkjs zkey beacon \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_0003.zkey" \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
        0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 \
        -n="Final Beacon phase2 contribution"

    # Export verification key
    echo "Exporting verification key..."
    snarkjs zkey export verificationkey \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_verification_key.json"

    # Export Solidity verifier
    echo "Exporting Solidity verifier..."
    snarkjs zkey export solidityverifier \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_verifier.sol"

    # Clean up intermediate zkeys
    rm -f "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_000"*.zkey

    echo "=== $CIRCUIT_NAME build complete ==="
    echo ""
}

# Build both circuits
build_circuit "withdraw"
build_circuit "membership"

echo "All circuits built successfully!"
echo "Verifier contracts at:"
echo "  $BUILD_DIR/withdraw/withdraw_verifier.sol"
echo "  $BUILD_DIR/membership/membership_verifier.sol"
