/**
 * @privacy-paymaster/sdk
 *
 * TypeScript SDK for the Privacy Paymaster protocol.
 * Provides tools for depositing into privacy pools, generating ZK proofs
 * for withdrawals and gas sponsorship, and interacting with the relayer.
 */

// ── Client ──────────────────────────────────────────────────────────────────
export { PrivacyPaymasterClient } from "./client";

// ── Note generation & serialization ─────────────────────────────────────────
export { generateNote, deriveNote, serializeNote, deserializeNote } from "./note";

// ── Deposit ─────────────────────────────────────────────────────────────────
export { buildDepositTransaction, getPoolContract, isCommitmentDeposited } from "./deposit";

// ── Withdrawal ──────────────────────────────────────────────────────────────
export {
  generateWithdrawProof,
  encodeProofForContract,
  submitWithdrawal,
} from "./withdraw";

// ── Sponsorship / Paymaster ─────────────────────────────────────────────────
export {
  generateMembershipProof,
  buildPaymasterData,
  buildSponsoredUserOp,
} from "./sponsor";

// ── Merkle tree ─────────────────────────────────────────────────────────────
export {
  MerkleTree,
  TREE_DEPTH,
  getPoseidon,
  poseidonHash1,
  poseidonHash2,
} from "./merkle";

// ── Types ───────────────────────────────────────────────────────────────────
export type {
  Field,
  Note,
  MerkleProof,
  PoolConfig,
  SDKConfig,
  PoolStats,
  DepositStatus,
  WithdrawalStatus,
  WithdrawRequest,
  Groth16Proof,
  PackedUserOperation,
  RelayerWithdrawResponse,
  RelayerMerkleProofResponse,
  RelayerASPMerkleProofResponse,
} from "./types";
