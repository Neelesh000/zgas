/**
 * All shared types for the Privacy Paymaster SDK.
 */

/** A 256-bit value represented as a bigint. */
export type Field = bigint;

/** A privacy note containing all secret material derived from a deposit. */
export interface Note {
  /** Random secret used in the commitment. */
  secret: Field;
  /** Random nullifier used to derive nullifierHash and sponsorshipNullifierHash. */
  nullifier: Field;
  /** Poseidon(secret, nullifier) — the leaf committed on-chain. */
  commitment: Field;
  /** Poseidon(nullifier) — revealed during withdrawal to prevent double-spend. */
  nullifierHash: Field;
  /** Poseidon(nullifier, 2) — domain-separated nullifier for gas sponsorship. */
  sponsorshipNullifierHash: Field;
}

/** A Merkle proof for a leaf in an incremental Merkle tree. */
export interface MerkleProof {
  /** The leaf value. */
  leaf: Field;
  /** Sibling hashes from leaf to root, ordered bottom-up. */
  pathElements: Field[];
  /** Direction indicators: 0 if the sibling is on the right, 1 if on the left. */
  pathIndices: number[];
  /** The Merkle root this proof resolves to. */
  root: Field;
}

/** Configuration for a specific privacy pool instance. */
export interface PoolConfig {
  /** Address of the PrivacyPool contract. */
  poolAddress: string;
  /** Fixed deposit denomination in wei. */
  denomination: bigint;
  /** Address of the ASPRegistry contract. */
  aspRegistryAddress: string;
  /** Address of the PrivacyPaymaster contract (optional if not using sponsorship). */
  paymasterAddress?: string;
}

/** Top-level SDK configuration. */
export interface SDKConfig {
  /** URL of the relayer API. */
  relayerUrl: string;
  /** JSON-RPC URL for on-chain reads. */
  rpcUrl: string;
  /** Contract addresses keyed by a human-readable pool identifier. */
  contractAddresses: {
    pool: string;
    aspRegistry: string;
    paymaster?: string;
  };
}

/** Statistics returned by the relayer for a pool. */
export interface PoolStats {
  /** Total number of deposits. */
  totalDeposits: number;
  /** Total number of withdrawals. */
  totalWithdrawals: number;
  /** Current anonymity set size (deposits - withdrawals). */
  anonymitySetSize: number;
  /** The pool denomination in wei. */
  denomination: string;
  /** Most recent deposit Merkle root. */
  latestRoot: string;
  /** Most recent ASP root. */
  latestAspRoot: string;
}

/** Status of a specific deposit commitment. */
export interface DepositStatus {
  /** Whether the commitment exists on-chain. */
  exists: boolean;
  /** The leaf index if the commitment exists. */
  leafIndex?: number;
  /** Block number of the deposit transaction. */
  blockNumber?: number;
  /** Timestamp of the deposit. */
  timestamp?: number;
}

/** Status of a withdrawal by nullifier hash. */
export interface WithdrawalStatus {
  /** Whether the nullifier has been spent. */
  spent: boolean;
  /** Block number of the withdrawal transaction, if spent. */
  blockNumber?: number;
  /** Recipient address, if spent. */
  recipient?: string;
}

/** A withdrawal request to be sent to the relayer. */
export interface WithdrawRequest {
  /** ABI-encoded Groth16 proof. */
  proof: Groth16Proof;
  /** Public signals for the withdraw circuit. */
  publicSignals: string[];
  /** Pool contract address. */
  poolAddress: string;
}

/** A Groth16 proof in the format expected by the on-chain verifier. */
export interface Groth16Proof {
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
}

/** A packed ERC-4337 UserOperation. */
export interface PackedUserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: bigint;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
}

/** Response from the relayer after submitting a withdrawal. */
export interface RelayerWithdrawResponse {
  /** Whether the relayer accepted the withdrawal. */
  success: boolean;
  /** Transaction hash if the relayer broadcasted the withdrawal. */
  txHash?: string;
  /** Error message if the relayer rejected the withdrawal. */
  error?: string;
}

/** Merkle proof data returned by the relayer. */
export interface RelayerMerkleProofResponse {
  /** Sibling path elements (hex strings). */
  pathElements: string[];
  /** Path direction indices. */
  pathIndices: number[];
  /** Merkle root (hex string). */
  root: string;
  /** Leaf index. */
  leafIndex: number;
}

/** ASP Merkle proof data returned by the relayer. */
export interface RelayerASPMerkleProofResponse {
  /** Sibling path elements (hex strings). */
  pathElements: string[];
  /** Path direction indices. */
  pathIndices: number[];
  /** ASP Merkle root (hex string). */
  root: string;
}
