#!/usr/bin/env node
/**
 * End-to-end test: Deposit → Withdraw with real Poseidon + Groth16.
 */
import { ethers } from "ethers";
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import crypto from "crypto";
import path from "path";
import fs from "fs";

const RPC_URL = "http://127.0.0.1:8545";
const POOL_ADDRESS = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6"; // 0.1 BNB
const ASP_REGISTRY = "0x0165878A594ca255338adfa4d48449f69242Eb8F";
const DENOMINATION = ethers.parseEther("0.1");

const CIRCUITS_DIR = path.resolve("packages/frontend/public/circuits");
const TREE_DEPTH = 20;

const POOL_ABI = [
  "function deposit(bytes32 commitment) payable",
  "function withdraw(bytes calldata _proof, bytes32 _root, bytes32 _nullifierHash, address payable _recipient, address payable _relayer, uint256 _fee, uint256 _refund, bytes32 _aspRoot) external",
  "function commitments(bytes32) view returns (bool)",
  "function nullifierHashes(bytes32) view returns (bool)",
  "function getLastRoot() view returns (bytes32)",
  "event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp, uint256 denomination)",
];

const ASP_ABI = [
  "function getLastASPRoot() view returns (bytes32)",
  "function updateASPRoot(bytes32 newRoot) external",
];

const SNARK_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

function randomFieldElement() {
  const buf = crypto.randomBytes(31);
  let value = 0n;
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8n) | BigInt(buf[i]);
  }
  return value % SNARK_FIELD;
}

function toHex32(val) {
  return "0x" + val.toString(16).padStart(64, "0");
}

class MerkleTree {
  constructor(depth, poseidon, F) {
    this.depth = depth;
    this.poseidon = poseidon;
    this.F = F;
    this.leaves = [];
    this.layers = new Array(depth + 1);
    this.zeroValues = new Array(depth + 1);

    this.zeroValues[0] = 0n;
    for (let i = 1; i <= depth; i++) {
      this.zeroValues[i] = this._hash(this.zeroValues[i - 1], this.zeroValues[i - 1]);
    }
    for (let i = 0; i <= depth; i++) this.layers[i] = [];
  }

  _hash(left, right) {
    const h = this.poseidon([left, right]);
    return BigInt(this.F.toObject(h));
  }

  insert(leaf) {
    const index = this.leaves.length;
    this.leaves.push(leaf);
    this.layers[0] = [...this.leaves];
    this._rebuildFromIndex(index);
    return index;
  }

  _rebuildFromIndex(leafIndex) {
    let currentIndex = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const pairIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const leftIndex = Math.min(currentIndex, pairIndex);
      const rightIndex = Math.max(currentIndex, pairIndex);
      const left = this._getNode(level, leftIndex);
      const right = this._getNode(level, rightIndex);
      const parentIndex = Math.floor(currentIndex / 2);
      this.layers[level + 1][parentIndex] = this._hash(left, right);
      currentIndex = parentIndex;
    }
  }

  _getNode(level, index) {
    if (this.layers[level] && index < this.layers[level].length && this.layers[level][index] !== undefined) {
      return this.layers[level][index];
    }
    return this.zeroValues[level];
  }

  getRoot() {
    if (this.leaves.length === 0) return this.zeroValues[this.depth];
    return this._getNode(this.depth, 0);
  }

  getProof(leafIndex) {
    const pathElements = [];
    const pathIndices = [];
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
}

async function main() {
  console.log("=== E2E Test: Real Poseidon + Groth16 ===\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", provider);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, wallet);
  const aspRegistry = new ethers.Contract(ASP_REGISTRY, ASP_ABI, wallet);

  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  function poseidonHash2(left, right) {
    return BigInt(F.toObject(poseidon([left, right])));
  }

  function poseidonHash1(input) {
    return BigInt(F.toObject(poseidon([input])));
  }

  // ---- Step 1: Generate note ----
  console.log("Step 1: Generating note with Poseidon...");
  const secret = randomFieldElement();
  const nullifier = randomFieldElement();
  const commitment = poseidonHash2(secret, nullifier);
  const nullifierHash = poseidonHash1(nullifier);
  const commitmentHex = toHex32(commitment);
  const nullifierHashHex = toHex32(nullifierHash);
  console.log("  Commitment:", commitmentHex.slice(0, 18) + "...");

  // ---- Step 2: Deposit ----
  console.log("\nStep 2: Depositing 0.1 BNB...");
  const depositTx = await pool.deposit(commitmentHex, { value: DENOMINATION });
  const depositReceipt = await depositTx.wait();
  console.log("  TX:", depositReceipt.hash);

  const exists = await pool.commitments(commitmentHex);
  console.log("  Commitment on-chain:", exists);
  if (!exists) throw new Error("Commitment not found!");

  // ---- Step 3: Build pool Merkle tree ----
  console.log("\nStep 3: Reconstructing pool Merkle tree...");
  const poolTree = new MerkleTree(TREE_DEPTH, poseidon, F);
  const logs = await pool.queryFilter(pool.filters.Deposit());
  for (const log of logs) {
    poolTree.insert(BigInt(log.args[0]));
  }

  const leafIndex = poolTree.leaves.findIndex(l => l === commitment);
  const poolProof = poolTree.getProof(leafIndex);
  const poolRootHex = toHex32(poolProof.root);

  const onChainRoot = await pool.getLastRoot();
  console.log("  Root matches on-chain:", poolRootHex.toLowerCase() === onChainRoot.toLowerCase());
  if (poolRootHex.toLowerCase() !== onChainRoot.toLowerCase()) {
    throw new Error("Pool root mismatch!");
  }

  // ---- Step 4: Build ASP tree with commitment ----
  console.log("\nStep 4: Building ASP tree & updating registry...");
  const aspTree = new MerkleTree(TREE_DEPTH, poseidon, F);
  aspTree.insert(commitment);
  const aspRoot = aspTree.getRoot();
  const aspRootHex = toHex32(aspRoot);
  const aspProof = aspTree.getProof(0);

  const updateTx = await aspRegistry.updateASPRoot(aspRootHex);
  await updateTx.wait();
  console.log("  ASP root set:", aspRootHex.slice(0, 18) + "...");

  // ---- Step 5: Generate Groth16 proof ----
  console.log("\nStep 5: Generating Groth16 proof...");
  const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

  const circuitInput = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    pathElements: poolProof.pathElements.map(e => e.toString()),
    pathIndices: poolProof.pathIndices,
    aspPathElements: aspProof.pathElements.map(e => e.toString()),
    aspPathIndices: aspProof.pathIndices,
    root: poolProof.root.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: BigInt(recipient).toString(),
    relayer: "0",
    fee: "0",
    refund: "0",
    aspRoot: aspRoot.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    path.join(CIRCUITS_DIR, "withdraw.wasm"),
    path.join(CIRCUITS_DIR, "withdraw_final.zkey")
  );
  console.log("  Proof generated! Public signals:", publicSignals.length);

  // Verify locally
  const vkey = JSON.parse(fs.readFileSync(
    path.resolve("packages/circuits/build/withdraw/withdraw_verification_key.json"), "utf-8"));
  const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log("  Local verification:", isValid ? "VALID" : "INVALID");
  if (!isValid) throw new Error("Proof failed local verification!");

  // ---- Step 6: Submit withdrawal ----
  console.log("\nStep 6: Submitting withdrawal on-chain...");

  const pA = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
  const pB = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ];
  const pC = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];

  const abiCoder = new ethers.AbiCoder();
  const encodedProof = abiCoder.encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [pA, pB, pC]
  );

  const recipientBalanceBefore = await provider.getBalance(recipient);

  const withdrawTx = await pool.withdraw(
    encodedProof, poolRootHex, nullifierHashHex, recipient,
    ethers.ZeroAddress, 0, 0, aspRootHex,
    { gasLimit: 1_000_000 }
  );
  const withdrawReceipt = await withdrawTx.wait();
  console.log("  TX:", withdrawReceipt.hash);
  console.log("  Gas used:", withdrawReceipt.gasUsed.toString());

  const recipientBalanceAfter = await provider.getBalance(recipient);
  console.log("  Received:", ethers.formatEther(recipientBalanceAfter - recipientBalanceBefore), "ETH");
  console.log("  Nullifier spent:", await pool.nullifierHashes(nullifierHashHex));

  // ---- Step 7: Double-spend prevention ----
  console.log("\nStep 7: Double-spend prevention...");
  try {
    const dsTx = await pool.withdraw(
      encodedProof, poolRootHex, nullifierHashHex, recipient,
      ethers.ZeroAddress, 0, 0, aspRootHex, { gasLimit: 500_000 }
    );
    await dsTx.wait();
    throw new Error("DOUBLE_SPEND_NOT_REJECTED");
  } catch (err) {
    if (err.message === "DOUBLE_SPEND_NOT_REJECTED") throw err;
    console.log("  Double-spend correctly rejected!");
  }

  // ---- Step 8: Membership proof ----
  console.log("\nStep 8: Membership proof (sponsorship)...");
  const secret2 = randomFieldElement();
  const nullifier2 = randomFieldElement();
  const commitment2 = poseidonHash2(secret2, nullifier2);
  const sponsorNullifierHash = poseidonHash2(nullifier2, 2n);

  const depositTx2 = await pool.deposit(toHex32(commitment2), { value: DENOMINATION });
  await depositTx2.wait();
  console.log("  Second deposit done");

  const poolTree2 = new MerkleTree(TREE_DEPTH, poseidon, F);
  const logs2 = await pool.queryFilter(pool.filters.Deposit());
  for (const log of logs2) {
    poolTree2.insert(BigInt(log.args[0]));
  }

  const leafIndex2 = poolTree2.leaves.findIndex(l => l === commitment2);
  const poolProof2 = poolTree2.getProof(leafIndex2);

  const aspTree2 = new MerkleTree(TREE_DEPTH, poseidon, F);
  aspTree2.insert(commitment);
  aspTree2.insert(commitment2);
  const aspRoot2 = aspTree2.getRoot();
  const aspProof2 = aspTree2.getProof(1);

  await (await aspRegistry.updateASPRoot(toHex32(aspRoot2))).wait();

  const { proof: mProof, publicSignals: mSignals } = await snarkjs.groth16.fullProve(
    {
      secret: secret2.toString(),
      nullifier: nullifier2.toString(),
      pathElements: poolProof2.pathElements.map(e => e.toString()),
      pathIndices: poolProof2.pathIndices,
      aspPathElements: aspProof2.pathElements.map(e => e.toString()),
      aspPathIndices: aspProof2.pathIndices,
      root: poolProof2.root.toString(),
      nullifierHash: sponsorNullifierHash.toString(),
      aspRoot: aspRoot2.toString(),
    },
    path.join(CIRCUITS_DIR, "membership.wasm"),
    path.join(CIRCUITS_DIR, "membership_final.zkey")
  );
  console.log("  Membership proof generated!");

  const mVkey = JSON.parse(fs.readFileSync(
    path.resolve("packages/circuits/build/membership/membership_verification_key.json"), "utf-8"));
  const mValid = await snarkjs.groth16.verify(mVkey, mSignals, mProof);
  console.log("  Membership proof verification:", mValid ? "VALID" : "INVALID");
  if (!mValid) throw new Error("Membership proof failed!");

  console.log("\n=== ALL E2E TESTS PASSED ===");
  console.log("  [OK] Poseidon commitment deposited on-chain");
  console.log("  [OK] Merkle tree reconstructed, root matches on-chain");
  console.log("  [OK] Withdraw Groth16 proof generated + verified locally");
  console.log("  [OK] Withdrawal verified on-chain by real Groth16 verifier");
  console.log("  [OK] Double-spend prevention works");
  console.log("  [OK] Membership proof (domain-separated nullifier) works");
}

main().catch((err) => {
  console.error("\n=== E2E TEST FAILED ===");
  console.error(err.message || err);
  process.exit(1);
});
