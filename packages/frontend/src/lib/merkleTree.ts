/**
 * Client-side Merkle tree for reconstructing pool/ASP trees from on-chain events.
 * Port of the SDK's MerkleTree class for browser use.
 */

import { getPoseidon } from "./poseidon";
import type { PublicClient, Address } from "viem";

const TREE_DEPTH = 20;

export interface MerkleProof {
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
}

export class MerkleTree {
  readonly depth: number;
  private leaves: bigint[] = [];
  private layers: bigint[][] = [];
  private zeroValues: bigint[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _poseidon: any = null;
  private _initialized = false;

  constructor(depth: number = TREE_DEPTH) {
    this.depth = depth;
  }

  async init(): Promise<void> {
    if (this._initialized) return;
    this._poseidon = await getPoseidon();

    this.zeroValues = new Array(this.depth + 1);
    this.zeroValues[0] = 0n;
    for (let i = 1; i <= this.depth; i++) {
      this.zeroValues[i] = this._hash(this.zeroValues[i - 1], this.zeroValues[i - 1]);
    }

    this.layers = new Array(this.depth + 1);
    for (let i = 0; i <= this.depth; i++) {
      this.layers[i] = [];
    }
    this._initialized = true;
  }

  private _hash(left: bigint, right: bigint): bigint {
    const h = this._poseidon([left, right]);
    return BigInt(this._poseidon.F.toObject(h));
  }

  insert(leaf: bigint): number {
    if (!this._initialized) throw new Error("MerkleTree not initialized");
    const index = this.leaves.length;
    this.leaves.push(leaf);
    this.layers[0] = [...this.leaves];
    this._rebuildFromIndex(index);
    return index;
  }

  private _rebuildFromIndex(leafIndex: number): void {
    let currentIndex = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const pairIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const leftIndex = Math.min(currentIndex, pairIndex);
      const rightIndex = Math.max(currentIndex, pairIndex);
      const left = this._getNode(level, leftIndex);
      const right = this._getNode(level, rightIndex);
      const parentIndex = Math.floor(currentIndex / 2);
      if (!this.layers[level + 1]) this.layers[level + 1] = [];
      this.layers[level + 1][parentIndex] = this._hash(left, right);
      currentIndex = parentIndex;
    }
  }

  private _getNode(level: number, index: number): bigint {
    if (this.layers[level] && index < this.layers[level].length && this.layers[level][index] !== undefined) {
      return this.layers[level][index];
    }
    return this.zeroValues[level];
  }

  getRoot(): bigint {
    if (!this._initialized) throw new Error("MerkleTree not initialized");
    if (this.leaves.length === 0) return this.zeroValues[this.depth];
    return this._getNode(this.depth, 0);
  }

  getProof(leafIndex: number): MerkleProof {
    if (!this._initialized) throw new Error("MerkleTree not initialized");
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of range`);
    }
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      pathElements.push(this._getNode(level, siblingIndex));
      pathIndices.push(isRight ? 1 : 0);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { pathElements, pathIndices, root: this.getRoot() };
  }

  get leafCount(): number {
    return this.leaves.length;
  }

  /** Find the index of a leaf, or -1 if not found. */
  indexOf(leaf: bigint): number {
    return this.leaves.findIndex((l) => l === leaf);
  }
}

/** Block at which our contracts were deployed on BSC testnet */
const DEPLOY_BLOCK = 92962584n;
/** Max block range per eth_getLogs call (Alchemy free tier = 10) */
const LOG_CHUNK_SIZE = 9n;

/**
 * Fetch logs in small chunks to work within Alchemy free-tier block range limits.
 */
async function getLogsChunked(
  publicClient: PublicClient,
  params: { address: Address; event: typeof DEPOSIT_EVENT; fromBlock: bigint; toBlock: bigint }
) {
  const allLogs: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
  let from = params.fromBlock;
  const to = params.toBlock;

  while (from <= to) {
    const chunkEnd = from + LOG_CHUNK_SIZE > to ? to : from + LOG_CHUNK_SIZE;
    try {
      const logs = await publicClient.getLogs({
        address: params.address,
        event: params.event,
        fromBlock: from,
        toBlock: chunkEnd,
      });
      allLogs.push(...logs);
    } catch {
      // skip failed chunks
    }
    from = chunkEnd + 1n;
  }
  return allLogs;
}

const DEPOSIT_EVENT = {
  type: "event" as const,
  name: "Deposit" as const,
  inputs: [
    { type: "bytes32" as const, name: "commitment" as const, indexed: true },
    { type: "uint32" as const, name: "leafIndex" as const, indexed: false },
    { type: "uint256" as const, name: "timestamp" as const, indexed: false },
    { type: "uint256" as const, name: "denomination" as const, indexed: false },
  ],
};

/**
 * Reconstruct the pool Merkle tree from on-chain Deposit events.
 * Returns the tree and the leaf index of a specific commitment (if found).
 */
export async function buildPoolTree(
  poolAddress: Address,
  publicClient: PublicClient
): Promise<MerkleTree> {
  const tree = new MerkleTree();
  await tree.init();

  const latestBlock = await publicClient.getBlockNumber();
  const logs = await getLogsChunked(publicClient, {
    address: poolAddress,
    event: DEPOSIT_EVENT,
    fromBlock: DEPLOY_BLOCK,
    toBlock: latestBlock,
  });

  // Sort by leafIndex to ensure correct insertion order
  const sorted = [...logs].sort((a, b) => {
    const aArgs = a.args as Record<string, unknown>;
    const bArgs = b.args as Record<string, unknown>;
    const aIdx = Number(aArgs.leafIndex ?? 0);
    const bIdx = Number(bArgs.leafIndex ?? 0);
    return aIdx - bIdx;
  });

  for (const log of sorted) {
    const args = log.args as Record<string, unknown>;
    const commitment = BigInt(args.commitment as string);
    tree.insert(commitment);
  }

  return tree;
}

/**
 * Build an ASP Merkle tree from all pool deposits.
 * On devnet, all deposited commitments are considered ASP-approved.
 * The relayer must have already synced the ASP root on-chain via /api/asp/sync.
 *
 * @param poolAddresses - All pool addresses to collect deposits from
 * @param publicClient - Viem public client for reading events
 * @returns MerkleTree containing all deposited commitments
 */
export async function buildASPTree(
  poolAddresses: Address[],
  publicClient: PublicClient
): Promise<MerkleTree> {
  const tree = new MerkleTree();
  await tree.init();

  const latestBlock2 = await publicClient.getBlockNumber();

  // Collect all deposit commitments from all pools
  for (const poolAddress of poolAddresses) {
    const logs = await getLogsChunked(publicClient, {
      address: poolAddress,
      event: DEPOSIT_EVENT,
      fromBlock: DEPLOY_BLOCK,
      toBlock: latestBlock2,
    });

    // Sort by leafIndex within each pool
    const sorted = [...logs].sort((a, b) => {
      const aArgs = a.args as Record<string, unknown>;
      const bArgs = b.args as Record<string, unknown>;
      return Number(aArgs.leafIndex ?? 0) - Number(bArgs.leafIndex ?? 0);
    });

    for (const log of sorted) {
      const args = log.args as Record<string, unknown>;
      const commitment = BigInt(args.commitment as string);
      tree.insert(commitment);
    }
  }

  return tree;
}
