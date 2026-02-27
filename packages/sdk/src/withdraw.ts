/**
 * Withdrawal proof generation and relayer submission for the Privacy Paymaster protocol.
 *
 * The withdrawal circuit proves:
 *   - Knowledge of (secret, nullifier) such that Poseidon(secret, nullifier) is in the Merkle tree
 *   - The nullifierHash is correctly derived: Poseidon(nullifier)
 *   - The commitment is in the ASP-approved set (ASP Merkle proof)
 *
 * Public signals (7): root, nullifierHash, recipient, relayer, fee, refund, aspRoot
 */

import type { Groth16Proof, MerkleProof, Note, RelayerWithdrawResponse } from "./types";

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
 * Convert an Ethereum address to a field element (uint160).
 */
function addressToField(address: string): string {
  return BigInt(address).toString();
}

/**
 * Generate a Groth16 withdrawal proof using snarkjs.
 *
 * @param note The Note being withdrawn.
 * @param merkleProof Merkle proof for the commitment in the deposit tree.
 * @param aspMerkleProof Merkle proof for the commitment in the ASP-approved set.
 * @param recipient Address that will receive the withdrawn funds.
 * @param relayer Address of the relayer (use ethers.ZeroAddress for self-relay).
 * @param fee Fee paid to the relayer in wei.
 * @param refund Refund amount (0 for native token pools).
 * @param wasmPath Path to the withdraw circuit WASM file.
 * @param zkeyPath Path to the withdraw circuit zkey file.
 * @returns An object containing the Groth16 proof and public signals.
 */
export async function generateWithdrawProof(
  note: Note,
  merkleProof: MerkleProof,
  aspMerkleProof: MerkleProof,
  recipient: string,
  relayer: string,
  fee: bigint,
  refund: bigint,
  wasmPath: string,
  zkeyPath: string
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  // Build circuit input
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
    nullifierHash: fieldToString(note.nullifierHash),
    recipient: addressToField(recipient),
    relayer: addressToField(relayer),
    fee: fee.toString(),
    refund: refund.toString(),
    aspRoot: fieldToString(aspMerkleProof.root),
  };

  // Generate proof using snarkjs groth16
  const { proof: snarkProof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );

  // Convert snarkjs proof format to our Groth16Proof format
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
 * Encode a Groth16 proof into the ABI-encoded bytes format expected by the
 * PrivacyPool.withdraw() function.
 *
 * @param proof The Groth16 proof.
 * @returns ABI-encoded proof bytes.
 */
export function encodeProofForContract(proof: Groth16Proof): string {
  const { ethers } = require("ethers") as typeof import("ethers");
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
 * Submit a withdrawal request to the relayer.
 *
 * @param relayerUrl The base URL of the relayer API.
 * @param proof The Groth16 proof.
 * @param publicSignals The public signals from the proof.
 * @param poolAddress The address of the PrivacyPool contract.
 * @returns The relayer's response.
 */
export async function submitWithdrawal(
  relayerUrl: string,
  proof: Groth16Proof,
  publicSignals: string[],
  poolAddress: string
): Promise<RelayerWithdrawResponse> {
  const url = `${relayerUrl.replace(/\/$/, "")}/api/withdraw`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proof,
      publicSignals,
      poolAddress,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      success: false,
      error: `Relayer returned ${response.status}: ${errorText}`,
    };
  }

  const data = (await response.json()) as RelayerWithdrawResponse;
  return data;
}
