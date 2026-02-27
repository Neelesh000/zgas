/**
 * Client-side incremental Merkle tree using Poseidon hashing.
 * Mirrors the on-chain MerkleTreeWithHistory (depth 20).
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { buildPoseidon, type Poseidon } from "circomlibjs";
import type { Field, MerkleProof } from "./types";

/** Default tree depth matching the on-chain contract. */
export const TREE_DEPTH = 20;

/**
 * Build and cache the Poseidon hash function from circomlibjs.
 * circomlibjs returns a wasm-backed Poseidon that works on Field elements.
 */
let _poseidon: Poseidon | null = null;
export async function getPoseidon(): Promise<Poseidon> {
  if (!_poseidon) {
    _poseidon = await buildPoseidon();
  }
  return _poseidon;
}

/**
 * Hash two field elements with Poseidon and return as bigint.
 */
export async function poseidonHash2(left: Field, right: Field): Promise<Field> {
  const poseidon = await getPoseidon();
  const hash = poseidon([left, right]);
  return poseidon.F.toObject(hash) as Field;
}

/**
 * Hash a single field element with Poseidon (arity 1).
 */
export async function poseidonHash1(input: Field): Promise<Field> {
  const poseidon = await getPoseidon();
  const hash = poseidon([input]);
  return poseidon.F.toObject(hash) as Field;
}

/**
 * Client-side incremental Merkle tree that mirrors the on-chain
 * MerkleTreeWithHistory contract.
 */
export class MerkleTree {
  readonly depth: number;
  private leaves: Field[];
  private layers: Field[][];
  private zeroValues: Field[];
  private _poseidon: Poseidon | null = null;
  private _initialized: boolean = false;

  constructor(depth: number = TREE_DEPTH) {
    this.depth = depth;
    this.leaves = [];
    this.layers = [];
    this.zeroValues = [];
  }

  /**
   * Initialize the tree by precomputing zero values at each level.
   * Must be called before any insert or proof operations.
   */
  async init(): Promise<void> {
    if (this._initialized) return;
    this._poseidon = await getPoseidon();

    // Compute zero values: zeros[0] = 0, zeros[i] = poseidon(zeros[i-1], zeros[i-1])
    this.zeroValues = new Array(this.depth + 1);
    this.zeroValues[0] = BigInt(0);
    for (let i = 1; i <= this.depth; i++) {
      this.zeroValues[i] = this._hash(this.zeroValues[i - 1], this.zeroValues[i - 1]);
    }

    // Initialize layers
    this.layers = new Array(this.depth + 1);
    for (let i = 0; i <= this.depth; i++) {
      this.layers[i] = [];
    }

    this._initialized = true;
  }

  /**
   * Synchronous Poseidon hash using the cached instance.
   */
  private _hash(left: Field, right: Field): Field {
    if (!this._poseidon) {
      throw new Error("MerkleTree not initialized. Call init() first.");
    }
    const h = this._poseidon([left, right]);
    return this._poseidon.F.toObject(h) as Field;
  }

  /**
   * Insert a leaf into the tree and recompute affected path.
   * @param leaf The commitment value to insert.
   * @returns The leaf index.
   */
  insert(leaf: Field): number {
    if (!this._initialized) {
      throw new Error("MerkleTree not initialized. Call init() first.");
    }
    const index = this.leaves.length;
    if (index >= 2 ** this.depth) {
      throw new Error("Merkle tree is full");
    }

    this.leaves.push(leaf);
    this.layers[0] = [...this.leaves];

    this._rebuildFromIndex(index);
    return index;
  }

  /**
   * Rebuild the tree layers from a given leaf index upward.
   */
  private _rebuildFromIndex(leafIndex: number): void {
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const pairIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const leftIndex = Math.min(currentIndex, pairIndex);
      const rightIndex = Math.max(currentIndex, pairIndex);

      const left = this._getNode(level, leftIndex);
      const right = this._getNode(level, rightIndex);

      const parentIndex = Math.floor(currentIndex / 2);
      const parentHash = this._hash(left, right);

      if (!this.layers[level + 1]) {
        this.layers[level + 1] = [];
      }
      this.layers[level + 1][parentIndex] = parentHash;

      currentIndex = parentIndex;
    }
  }

  /**
   * Get a node value at a specific level and index.
   * Returns the appropriate zero value if the node hasn't been set.
   */
  private _getNode(level: number, index: number): Field {
    if (this.layers[level] && index < this.layers[level].length && this.layers[level][index] !== undefined) {
      return this.layers[level][index];
    }
    return this.zeroValues[level];
  }

  /**
   * Get the current Merkle root.
   */
  getRoot(): Field {
    if (!this._initialized) {
      throw new Error("MerkleTree not initialized. Call init() first.");
    }
    if (this.leaves.length === 0) {
      return this.zeroValues[this.depth];
    }
    return this._getNode(this.depth, 0);
  }

  /**
   * Generate a Merkle proof for a leaf at a given index.
   * @param leafIndex The index of the leaf to prove.
   * @returns A MerkleProof object.
   */
  getProof(leafIndex: number): MerkleProof {
    if (!this._initialized) {
      throw new Error("MerkleTree not initialized. Call init() first.");
    }
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of range [0, ${this.leaves.length})`);
    }

    const pathElements: Field[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      pathElements.push(this._getNode(level, siblingIndex));
      pathIndices.push(isRight ? 1 : 0);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      leaf: this.leaves[leafIndex],
      pathElements,
      pathIndices,
      root: this.getRoot(),
    };
  }

  /**
   * Get the total number of leaves inserted.
   */
  get leafCount(): number {
    return this.leaves.length;
  }
}
