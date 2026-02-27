/**
 * Deposit transaction construction for the Privacy Paymaster protocol.
 *
 * Builds an unsigned transaction that calls PrivacyPool.deposit(commitment)
 * with the correct denomination value attached.
 */

import { ethers } from "ethers";
import type { Note } from "./types";

/** Minimal ABI for the PrivacyPool deposit function. */
const PRIVACY_POOL_ABI = [
  "function deposit(bytes32 commitment) external payable",
  "function denomination() external view returns (uint256)",
  "function commitments(bytes32) external view returns (bool)",
  "function nextLeafIndex() external view returns (uint32)",
  "function getLastRoot() external view returns (bytes32)",
];

/**
 * Convert a bigint field element to a bytes32 hex string.
 */
function fieldToBytes32(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

/**
 * Construct an unsigned deposit transaction.
 *
 * @param note The Note whose commitment will be deposited.
 * @param denomination The fixed deposit amount in wei.
 * @param poolAddress Address of the PrivacyPool contract.
 * @returns An ethers TransactionRequest that can be signed and sent.
 */
export function buildDepositTransaction(
  note: Note,
  denomination: bigint,
  poolAddress: string
): ethers.TransactionLike {
  const iface = new ethers.Interface(PRIVACY_POOL_ABI);
  const commitmentBytes32 = fieldToBytes32(note.commitment);
  const data = iface.encodeFunctionData("deposit", [commitmentBytes32]);

  return {
    to: poolAddress,
    value: denomination,
    data,
  };
}

/**
 * Create a PrivacyPool contract instance for read operations.
 *
 * @param poolAddress Address of the PrivacyPool contract.
 * @param provider An ethers Provider for read-only access.
 * @returns An ethers Contract instance.
 */
export function getPoolContract(
  poolAddress: string,
  provider: ethers.Provider
): ethers.Contract {
  return new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, provider);
}

/**
 * Check whether a commitment has already been deposited.
 *
 * @param poolAddress Address of the PrivacyPool contract.
 * @param provider An ethers Provider.
 * @param commitment The commitment to check.
 * @returns True if the commitment exists on-chain.
 */
export async function isCommitmentDeposited(
  poolAddress: string,
  provider: ethers.Provider,
  commitment: bigint
): Promise<boolean> {
  const pool = getPoolContract(poolAddress, provider);
  const commitmentBytes32 = fieldToBytes32(commitment);
  return pool.commitments(commitmentBytes32) as Promise<boolean>;
}
