/**
 * Main SDK client for the Privacy Paymaster protocol.
 *
 * Provides a high-level interface for interacting with the relayer API
 * and on-chain contracts.
 */

import { ethers } from "ethers";
import type {
  SDKConfig,
  PoolStats,
  DepositStatus,
  WithdrawalStatus,
  RelayerMerkleProofResponse,
  RelayerASPMerkleProofResponse,
  MerkleProof,
} from "./types";

/** Minimal ABI for the PrivacyPool contract (read methods). */
const PRIVACY_POOL_ABI = [
  "function denomination() external view returns (uint256)",
  "function commitments(bytes32) external view returns (bool)",
  "function nullifierHashes(bytes32) external view returns (bool)",
  "function nextLeafIndex() external view returns (uint32)",
  "function getLastRoot() external view returns (bytes32)",
  "function isKnownRoot(bytes32) external view returns (bool)",
  "event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp, uint256 denomination)",
  "event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)",
];

/** Minimal ABI for the ASPRegistry contract (read methods). */
const ASP_REGISTRY_ABI = [
  "function getLastASPRoot() external view returns (bytes32)",
  "function isKnownASPRoot(bytes32) external view returns (bool)",
  "function isBlocked(bytes32) external view returns (bool)",
];

/** Minimal ABI for the PrivacyPaymaster contract (read methods). */
const PAYMASTER_ABI = [
  "function sponsorshipNullifiers(bytes32) external view returns (bool)",
  "function maxGasSponsorship() external view returns (uint256)",
];

/**
 * PrivacyPaymasterClient is the main entry point for interacting with
 * the Privacy Paymaster protocol. It provides methods for querying pool
 * stats, deposit/withdrawal status, and fetching Merkle proofs from
 * the relayer.
 */
export class PrivacyPaymasterClient {
  readonly relayerUrl: string;
  readonly provider: ethers.JsonRpcProvider;
  readonly poolContract: ethers.Contract;
  readonly aspRegistryContract: ethers.Contract;
  readonly paymasterContract: ethers.Contract | null;
  readonly config: SDKConfig;

  /**
   * @param config SDK configuration including relayer URL, RPC URL, and contract addresses.
   */
  constructor(config: SDKConfig) {
    this.config = config;
    this.relayerUrl = config.relayerUrl.replace(/\/$/, "");
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);

    this.poolContract = new ethers.Contract(
      config.contractAddresses.pool,
      PRIVACY_POOL_ABI,
      this.provider
    );

    this.aspRegistryContract = new ethers.Contract(
      config.contractAddresses.aspRegistry,
      ASP_REGISTRY_ABI,
      this.provider
    );

    if (config.contractAddresses.paymaster) {
      this.paymasterContract = new ethers.Contract(
        config.contractAddresses.paymaster,
        PAYMASTER_ABI,
        this.provider
      );
    } else {
      this.paymasterContract = null;
    }
  }

  /**
   * Get pool statistics from the relayer.
   *
   * @returns Pool statistics including deposit count, withdrawal count, and anonymity set size.
   */
  async getPoolStats(): Promise<PoolStats> {
    const response = await fetch(`${this.relayerUrl}/api/pool/stats`);
    if (!response.ok) {
      throw new Error(`Failed to fetch pool stats: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as PoolStats;
  }

  /**
   * Get the status of a deposit by its commitment.
   *
   * @param commitment The commitment (as bigint or hex string) to look up.
   * @returns Deposit status information.
   */
  async getDepositStatus(commitment: bigint | string): Promise<DepositStatus> {
    const commitmentHex =
      typeof commitment === "bigint"
        ? "0x" + commitment.toString(16).padStart(64, "0")
        : commitment;

    const response = await fetch(
      `${this.relayerUrl}/api/deposit/status?commitment=${commitmentHex}`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch deposit status: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as DepositStatus;
  }

  /**
   * Get the status of a withdrawal by its nullifier hash.
   *
   * @param nullifierHash The nullifier hash (as bigint or hex string) to look up.
   * @returns Withdrawal status information.
   */
  async getWithdrawalStatus(nullifierHash: bigint | string): Promise<WithdrawalStatus> {
    const nullifierHex =
      typeof nullifierHash === "bigint"
        ? "0x" + nullifierHash.toString(16).padStart(64, "0")
        : nullifierHash;

    const response = await fetch(
      `${this.relayerUrl}/api/withdrawal/status?nullifierHash=${nullifierHex}`
    );
    if (!response.ok) {
      throw new Error(
        `Failed to fetch withdrawal status: ${response.status} ${response.statusText}`
      );
    }
    return (await response.json()) as WithdrawalStatus;
  }

  /**
   * Fetch the Merkle proof for a commitment from the relayer.
   *
   * @param commitment The commitment (as bigint or hex string) to get a proof for.
   * @returns A MerkleProof suitable for use in proof generation.
   */
  async getMerkleProof(commitment: bigint | string): Promise<MerkleProof> {
    const commitmentHex =
      typeof commitment === "bigint"
        ? "0x" + commitment.toString(16).padStart(64, "0")
        : commitment;

    const response = await fetch(
      `${this.relayerUrl}/api/merkle/proof?commitment=${commitmentHex}`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch merkle proof: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as RelayerMerkleProofResponse;

    return {
      leaf: typeof commitment === "bigint" ? commitment : BigInt(commitment),
      pathElements: data.pathElements.map((el) => BigInt(el)),
      pathIndices: data.pathIndices,
      root: BigInt(data.root),
    };
  }

  /**
   * Fetch the ASP Merkle proof for a commitment from the relayer.
   *
   * @param commitment The commitment (as bigint or hex string) to get an ASP proof for.
   * @returns A MerkleProof for the ASP (Association Set Provider) tree.
   */
  async getASPMerkleProof(commitment: bigint | string): Promise<MerkleProof> {
    const commitmentHex =
      typeof commitment === "bigint"
        ? "0x" + commitment.toString(16).padStart(64, "0")
        : commitment;

    const response = await fetch(
      `${this.relayerUrl}/api/asp/proof?commitment=${commitmentHex}`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch ASP merkle proof: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as RelayerASPMerkleProofResponse;

    return {
      leaf: typeof commitment === "bigint" ? commitment : BigInt(commitment),
      pathElements: data.pathElements.map((el) => BigInt(el)),
      pathIndices: data.pathIndices,
      root: BigInt(data.root),
    };
  }

  /**
   * Check if a commitment has been deposited on-chain (direct contract call).
   *
   * @param commitment The commitment as a bigint or hex string.
   * @returns True if the commitment exists on-chain.
   */
  async isCommitmentOnChain(commitment: bigint | string): Promise<boolean> {
    const commitmentHex =
      typeof commitment === "bigint"
        ? "0x" + commitment.toString(16).padStart(64, "0")
        : commitment;
    return this.poolContract.commitments(commitmentHex) as Promise<boolean>;
  }

  /**
   * Check if a nullifier hash has been spent on-chain (direct contract call).
   *
   * @param nullifierHash The nullifier hash as a bigint or hex string.
   * @returns True if the nullifier has been used.
   */
  async isNullifierSpent(nullifierHash: bigint | string): Promise<boolean> {
    const nullifierHex =
      typeof nullifierHash === "bigint"
        ? "0x" + nullifierHash.toString(16).padStart(64, "0")
        : nullifierHash;
    return this.poolContract.nullifierHashes(nullifierHex) as Promise<boolean>;
  }

  /**
   * Get the denomination of the pool (direct contract call).
   *
   * @returns The pool denomination in wei.
   */
  async getDenomination(): Promise<bigint> {
    return this.poolContract.denomination() as Promise<bigint>;
  }

  /**
   * Get the current Merkle root from the pool contract.
   *
   * @returns The latest Merkle root as a bigint.
   */
  async getLastRoot(): Promise<bigint> {
    const root: string = await this.poolContract.getLastRoot();
    return BigInt(root);
  }

  /**
   * Get the latest ASP root from the ASP registry contract.
   *
   * @returns The latest ASP root as a bigint.
   */
  async getLastASPRoot(): Promise<bigint> {
    const root: string = await this.aspRegistryContract.getLastASPRoot();
    return BigInt(root);
  }

  /**
   * Check if a commitment is blocked in the ASP registry.
   *
   * @param commitment The commitment as a bigint or hex string.
   * @returns True if the commitment is blocked (sanctioned).
   */
  async isCommitmentBlocked(commitment: bigint | string): Promise<boolean> {
    const commitmentHex =
      typeof commitment === "bigint"
        ? "0x" + commitment.toString(16).padStart(64, "0")
        : commitment;
    return this.aspRegistryContract.isBlocked(commitmentHex) as Promise<boolean>;
  }

  /**
   * Check if a sponsorship nullifier has been used (requires paymaster contract).
   *
   * @param nullifierHash The sponsorship nullifier hash.
   * @returns True if the sponsorship nullifier has been consumed.
   */
  async isSponsorshipNullifierUsed(nullifierHash: bigint | string): Promise<boolean> {
    if (!this.paymasterContract) {
      throw new Error("Paymaster contract address not configured");
    }
    const nullifierHex =
      typeof nullifierHash === "bigint"
        ? "0x" + nullifierHash.toString(16).padStart(64, "0")
        : nullifierHash;
    return this.paymasterContract.sponsorshipNullifiers(nullifierHex) as Promise<boolean>;
  }
}
