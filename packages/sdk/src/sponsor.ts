/**
 * Gas sponsorship via the PrivacyPaymaster.
 *
 * Generates a ZK membership proof showing the caller has a valid deposit in
 * the privacy pool (without revealing which one), then encodes this proof as
 * paymasterAndData in an ERC-4337 UserOperation.
 *
 * The membership circuit proves:
 *   - Knowledge of (secret, nullifier) where Poseidon(secret, nullifier) is in the Merkle tree
 *   - The sponsorshipNullifierHash is correctly derived: Poseidon(nullifier, 2)
 *   - The commitment is in the ASP-approved set
 *
 * Public signals (3): root, sponsorshipNullifierHash, aspRoot
 */

import { ethers } from "ethers";
import type { Groth16Proof, MerkleProof, Note, PackedUserOperation } from "./types";

// snarkjs is a CommonJS module
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs = require("snarkjs");

/**
 * Convert a bigint to a decimal string for circuit input.
 */
function fieldToString(value: bigint): string {
  return value.toString();
}

/**
 * Generate a membership proof for gas sponsorship.
 *
 * This proves the user has a valid deposit without revealing which one,
 * using a domain-separated nullifier (Poseidon(nullifier, 2)) so the same
 * deposit can be used for both withdrawal and gas sponsorship.
 *
 * @param note The Note whose membership is being proved.
 * @param merkleProof Merkle proof for the commitment in the deposit tree.
 * @param aspMerkleProof Merkle proof for the commitment in the ASP-approved set.
 * @param wasmPath Path to the membership circuit WASM file.
 * @param zkeyPath Path to the membership circuit zkey file.
 * @returns An object containing the Groth16 proof and public signals.
 */
export async function generateMembershipProof(
  note: Note,
  merkleProof: MerkleProof,
  aspMerkleProof: MerkleProof,
  wasmPath: string,
  zkeyPath: string
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  // Build circuit input for membership proof
  const input = {
    // Private inputs
    secret: fieldToString(note.secret),
    nullifier: fieldToString(note.nullifier),
    pathElements: merkleProof.pathElements.map(fieldToString),
    pathIndices: merkleProof.pathIndices,
    aspPathElements: aspMerkleProof.pathElements.map(fieldToString),
    aspPathIndices: aspMerkleProof.pathIndices,

    // Public inputs
    root: fieldToString(merkleProof.root),
    nullifierHash: fieldToString(note.sponsorshipNullifierHash),
    aspRoot: fieldToString(aspMerkleProof.root),
  };

  // Generate proof using snarkjs groth16
  const { proof: snarkProof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );

  // Convert to our format
  const proof: Groth16Proof = {
    pi_a: [snarkProof.pi_a[0], snarkProof.pi_a[1]],
    pi_b: [
      [snarkProof.pi_b[0][0], snarkProof.pi_b[0][1]],
      [snarkProof.pi_b[1][0], snarkProof.pi_b[1][1]],
    ],
    pi_c: [snarkProof.pi_c[0], snarkProof.pi_c[1]],
  };

  return { proof, publicSignals };
}

/**
 * Encode a Groth16 proof into ABI-encoded bytes (256 bytes) matching the
 * PrivacyPaymaster's expected layout:
 *   [pA[2], pB[2][2], pC[2]] = 8 uint256s = 256 bytes
 */
function encodeProofBytes(proof: Groth16Proof): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [
      proof.pi_a.map(BigInt),
      proof.pi_b.map((row) => row.map(BigInt)),
      proof.pi_c.map(BigInt),
    ]
  );
}

/**
 * Build the paymasterAndData field for a sponsored UserOperation.
 *
 * Layout (after the 20-byte paymaster address + 32-byte gas fields = 52-byte prefix):
 *   [0:256]   - ABI-encoded proof (pA, pB, pC)
 *   [256:288] - merkleRoot (bytes32)
 *   [288:320] - nullifierHash (bytes32, the sponsorship nullifier)
 *   [320:352] - aspRoot (bytes32)
 *
 * @param paymasterAddress Address of the PrivacyPaymaster contract.
 * @param proof The Groth16 membership proof.
 * @param publicSignals Public signals [root, nullifierHash, aspRoot].
 * @param verificationGasLimit Gas limit for the verification step.
 * @param postOpGasLimit Gas limit for the postOp step.
 * @returns The encoded paymasterAndData hex string.
 */
export function buildPaymasterData(
  paymasterAddress: string,
  proof: Groth16Proof,
  publicSignals: string[],
  verificationGasLimit: bigint = BigInt(100000),
  postOpGasLimit: bigint = BigInt(50000)
): string {
  // Encode the proof
  const proofBytes = encodeProofBytes(proof);

  // Public signals: [root, nullifierHash, aspRoot]
  const root = BigInt(publicSignals[0]);
  const nullifierHash = BigInt(publicSignals[1]);
  const aspRoot = BigInt(publicSignals[2]);

  // Pack merkleRoot, nullifierHash, aspRoot as bytes32
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const extraData = abiCoder.encode(
    ["bytes32", "bytes32", "bytes32"],
    [
      "0x" + root.toString(16).padStart(64, "0"),
      "0x" + nullifierHash.toString(16).padStart(64, "0"),
      "0x" + aspRoot.toString(16).padStart(64, "0"),
    ]
  );

  // Build the ERC-4337 paymaster prefix: address(20) + verificationGasLimit(16) + postOpGasLimit(16) = 52 bytes
  const gasData = abiCoder.encode(
    ["uint128", "uint128"],
    [verificationGasLimit, postOpGasLimit]
  );
  // gasData is 64 bytes ABI-encoded, but we need raw 32 bytes (16 + 16)
  // ethers ABI encodes each uint128 as 32 bytes, so extract the last 16 bytes of each
  const verGasHex = verificationGasLimit.toString(16).padStart(32, "0");
  const postGasHex = postOpGasLimit.toString(16).padStart(32, "0");

  const paymasterAndData = ethers.concat([
    paymasterAddress,
    "0x" + verGasHex + postGasHex,
    proofBytes,
    extraData,
  ]);

  return ethers.hexlify(paymasterAndData);
}

/**
 * Build a complete UserOperation with paymaster sponsorship data.
 *
 * @param proof The Groth16 membership proof.
 * @param publicSignals Public signals from the membership proof.
 * @param userOp The base UserOperation (without paymasterAndData).
 * @param paymasterAddress Address of the PrivacyPaymaster contract.
 * @returns A complete PackedUserOperation with paymasterAndData populated.
 */
export function buildSponsoredUserOp(
  proof: Groth16Proof,
  publicSignals: string[],
  userOp: Partial<PackedUserOperation>,
  paymasterAddress: string
): PackedUserOperation {
  const paymasterAndData = buildPaymasterData(
    paymasterAddress,
    proof,
    publicSignals
  );

  return {
    sender: userOp.sender ?? ethers.ZeroAddress,
    nonce: userOp.nonce ?? BigInt(0),
    initCode: userOp.initCode ?? "0x",
    callData: userOp.callData ?? "0x",
    accountGasLimits: userOp.accountGasLimits ?? "0x" + "00".repeat(32),
    preVerificationGas: userOp.preVerificationGas ?? BigInt(21000),
    gasFees: userOp.gasFees ?? "0x" + "00".repeat(32),
    paymasterAndData,
    signature: userOp.signature ?? "0x",
  };
}
