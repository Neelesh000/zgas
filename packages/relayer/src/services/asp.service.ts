import { ethers } from "ethers";
import { config } from "../config";
import { query } from "../db";
import { checkAddress, ScreeningResult } from "./screening.service";

// Minimal ABIs for contract interaction
const PRIVACY_POOL_ABI = [
  "event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp, uint256 denomination)",
  "function denomination() view returns (uint256)",
];

const ASP_REGISTRY_ABI = [
  "function updateASPRoot(bytes32 newRoot) external",
  "function blockCommitment(bytes32 commitment, string reason) external",
  "function getLastASPRoot() view returns (bytes32)",
  "function isKnownASPRoot(bytes32 root) view returns (bool)",
];

/**
 * Off-chain incremental Merkle tree for the ASP (Association Set Provider).
 * Mirrors the on-chain MerkleTreeWithHistory structure but only includes
 * commitments that pass sanctions screening.
 */
export class ASPMerkleTree {
  private depth: number;
  private leaves: string[] = [];
  private layers: string[][] = [];
  private zeroValues: string[] = [];

  constructor(depth: number = 20) {
    this.depth = depth;
    this.zeroValues = this.computeZeroValues();
    this.layers = Array.from({ length: depth + 1 }, () => []);
    this.rebuildTree();
  }

  /**
   * Compute zero values for each level using keccak256 as a stand-in
   * for Poseidon. In production, replace with Poseidon hashing via
   * circomlibjs or snarkjs to match the on-chain hasher.
   */
  private computeZeroValues(): string[] {
    const zeros: string[] = [];
    let current = ethers.ZeroHash;
    for (let i = 0; i < this.depth; i++) {
      zeros.push(current);
      current = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [current, current]
      );
    }
    return zeros;
  }

  private hashPair(left: string, right: string): string {
    return ethers.solidityPackedKeccak256(
      ["bytes32", "bytes32"],
      [left, right]
    );
  }

  /**
   * Insert a leaf (approved commitment) into the tree.
   */
  insert(commitment: string): number {
    const index = this.leaves.length;
    this.leaves.push(commitment);
    this.rebuildTree();
    return index;
  }

  /**
   * Rebuild all layers from leaves. For large trees consider incremental
   * updates, but correctness-first here.
   */
  private rebuildTree(): void {
    const maxLeaves = 2 ** this.depth;
    this.layers = [];

    // Layer 0: leaves padded with zeros
    const layer0: string[] = [];
    for (let i = 0; i < maxLeaves; i++) {
      layer0.push(i < this.leaves.length ? this.leaves[i] : this.zeroValues[0]);
    }
    this.layers.push(layer0);

    // Build up
    for (let level = 1; level <= this.depth; level++) {
      const prevLayer = this.layers[level - 1];
      const currentLayer: string[] = [];
      for (let i = 0; i < prevLayer.length; i += 2) {
        const left = prevLayer[i];
        const right =
          i + 1 < prevLayer.length ? prevLayer[i + 1] : this.zeroValues[level - 1];
        currentLayer.push(this.hashPair(left, right));
      }
      this.layers.push(currentLayer);
    }
  }

  get root(): string {
    if (this.layers.length === 0 || this.layers[this.depth].length === 0) {
      return ethers.ZeroHash;
    }
    return this.layers[this.depth][0];
  }

  get leafCount(): number {
    return this.leaves.length;
  }

  /**
   * Generate a Merkle proof for the leaf at `index`.
   */
  getProof(index: number): { pathElements: string[]; pathIndices: number[] } | null {
    if (index < 0 || index >= this.leaves.length) return null;

    const pathElements: string[] = [];
    const pathIndices: number[] = [];
    let currentIndex = index;

    for (let level = 0; level < this.depth; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const sibling =
        siblingIndex < this.layers[level].length
          ? this.layers[level][siblingIndex]
          : this.zeroValues[level];

      pathElements.push(sibling);
      pathIndices.push(currentIndex % 2);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { pathElements, pathIndices };
  }

  /**
   * Find the index of a commitment in the tree.
   */
  indexOf(commitment: string): number {
    return this.leaves.indexOf(commitment);
  }
}

// Singleton ASP tree instance
let aspTree: ASPMerkleTree | null = null;

export function getASPTree(): ASPMerkleTree {
  if (!aspTree) {
    aspTree = new ASPMerkleTree(config.aspTreeDepth);
  }
  return aspTree;
}

/**
 * Process a new deposit: screen the depositor, update the ASP tree if approved,
 * and persist results to the database.
 */
export async function processDeposit(
  commitment: string,
  leafIndex: number,
  depositor: string,
  poolAddress: string,
  token: string | null,
  denomination: string,
  blockNumber: number,
  txHash: string
): Promise<void> {
  // Persist the deposit
  await query(
    `INSERT INTO deposits
      (commitment, leaf_index, depositor, pool_address, token, denomination, block_number, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (commitment) DO NOTHING`,
    [commitment, leafIndex, depositor, poolAddress, token, denomination, blockNumber, txHash]
  );

  // Screen the depositor
  let screeningResult: ScreeningResult;
  try {
    screeningResult = await checkAddress(depositor);
  } catch (err) {
    console.error(
      `[ASP] Screening failed for depositor ${depositor}:`,
      err instanceof Error ? err.message : err
    );
    await query(
      `UPDATE deposits SET screening_status = 'pending', updated_at = NOW()
       WHERE commitment = $1`,
      [commitment]
    );
    return;
  }

  const status = screeningResult.approved ? "approved" : "blocked";
  await query(
    `UPDATE deposits
     SET screening_status = $1, risk_score = $2, screening_flags = $3, screened_at = NOW(), updated_at = NOW()
     WHERE commitment = $4`,
    [status, screeningResult.riskScore, screeningResult.flags, commitment]
  );

  if (screeningResult.approved) {
    // Add to ASP Merkle tree
    const tree = getASPTree();
    tree.insert(commitment);

    await query(
      `UPDATE deposits SET asp_included = TRUE, updated_at = NOW() WHERE commitment = $1`,
      [commitment]
    );

    console.log(
      `[ASP] Commitment ${commitment.slice(0, 10)}... approved and added to ASP tree (leaf ${tree.leafCount - 1})`
    );
  } else {
    console.warn(
      `[ASP] Commitment ${commitment.slice(0, 10)}... BLOCKED: ${screeningResult.flags.join(", ")}`
    );

    // Block on-chain via ASP registry
    try {
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const wallet = new ethers.Wallet(config.privateKey, provider);
      const registry = new ethers.Contract(
        config.contracts.aspRegistry,
        ASP_REGISTRY_ABI,
        wallet
      );
      const reason = `Sanctioned: ${screeningResult.flags.join(", ")}`;
      const tx = await registry.blockCommitment(commitment, reason);
      await tx.wait();
      console.log(`[ASP] Commitment blocked on-chain, tx: ${tx.hash}`);
    } catch (err) {
      console.error(
        "[ASP] Failed to block commitment on-chain:",
        err instanceof Error ? err.message : err
      );
    }
  }
}

/**
 * Publish the current ASP tree root on-chain.
 * Called periodically by the aspUpdater worker.
 */
export async function publishASPRoot(): Promise<string | null> {
  const tree = getASPTree();
  const newRoot = tree.root;

  if (newRoot === ethers.ZeroHash) {
    console.log("[ASP] Tree is empty, skipping root update");
    return null;
  }

  // Check if this root is already known on-chain
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const registry = new ethers.Contract(
    config.contracts.aspRegistry,
    ASP_REGISTRY_ABI,
    wallet
  );

  try {
    const alreadyKnown = await registry.isKnownASPRoot(newRoot);
    if (alreadyKnown) {
      console.log("[ASP] Current root already known on-chain, skipping");
      return null;
    }
  } catch (err) {
    console.error(
      "[ASP] Failed to check existing root:",
      err instanceof Error ? err.message : err
    );
  }

  // Persist pending root
  const blockedCount = (
    await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM deposits WHERE screening_status = 'blocked'"
    )
  ).rows[0].count;

  await query(
    `INSERT INTO asp_roots (root, leaf_count, blocked_count, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (root) DO NOTHING`,
    [newRoot, tree.leafCount, parseInt(blockedCount, 10)]
  );

  // Submit on-chain
  try {
    const tx = await registry.updateASPRoot(newRoot);
    const receipt = await tx.wait();

    await query(
      `UPDATE asp_roots
       SET tx_hash = $1, block_number = $2, status = 'confirmed'
       WHERE root = $3`,
      [tx.hash, receipt.blockNumber, newRoot]
    );

    console.log(
      `[ASP] Root published on-chain: ${newRoot.slice(0, 10)}... (tx: ${tx.hash})`
    );
    return tx.hash;
  } catch (err) {
    await query(
      `UPDATE asp_roots SET status = 'failed' WHERE root = $1`,
      [newRoot]
    );
    console.error(
      "[ASP] Failed to publish root:",
      err instanceof Error ? err.message : err
    );
    throw err;
  }
}

/**
 * Get a Merkle proof for a commitment in the ASP tree.
 */
export function getASPProof(
  commitment: string
): { root: string; pathElements: string[]; pathIndices: number[] } | null {
  const tree = getASPTree();
  const index = tree.indexOf(commitment);
  if (index === -1) return null;

  const proof = tree.getProof(index);
  if (!proof) return null;

  return {
    root: tree.root,
    ...proof,
  };
}

/**
 * Rebuild the ASP tree from the database on startup.
 */
export async function rebuildASPTreeFromDB(): Promise<void> {
  const tree = getASPTree();

  const result = await query<{ commitment: string }>(
    `SELECT commitment FROM deposits
     WHERE asp_included = TRUE
     ORDER BY leaf_index ASC`
  );

  for (const row of result.rows) {
    tree.insert(row.commitment);
  }

  console.log(
    `[ASP] Rebuilt ASP tree from DB: ${tree.leafCount} leaves, root: ${tree.root.slice(0, 10)}...`
  );
}
