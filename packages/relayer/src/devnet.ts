/**
 * Lightweight devnet relayer for local Anvil testing.
 * No PostgreSQL, no background workers, no screening.
 * Just accepts withdrawal requests and submits them immediately.
 *
 * Usage: npx ts-node src/devnet.ts
 */

import express from "express";
import cors from "cors";
import { ethers } from "ethers";

/* -------------------------------------------------------------------------- */
/*                              Configuration                                 */
/* -------------------------------------------------------------------------- */

const PORT = Number(process.env.PORT) || 4000;
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

// Anvil default account #0
const RELAYER_PRIVATE_KEY =
  process.env.RELAYER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const POOL_ABI = [
  "function withdraw(bytes calldata _proof, bytes32 _root, bytes32 _nullifierHash, address payable _recipient, address payable _relayer, uint256 _fee, uint256 _refund, bytes32 _aspRoot) external",
  "function nullifierHashes(bytes32) view returns (bool)",
  "function denomination() view returns (uint256)",
];

const ENTRY_POINT_ABI = [
  "function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address payable beneficiary) external",
  "function getNonce(address sender, uint192 key) view returns (uint256 nonce)",
  "function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp) view returns (bytes32)",
];

const ASP_REGISTRY_ABI = [
  "function updateASPRoot(bytes32 newRoot) external",
  "function getLastASPRoot() view returns (bytes32)",
];

const DEPOSIT_EVENT_ABI = [
  "event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp, uint256 denomination)",
];

const ASP_REGISTRY_ADDRESS = process.env.ASP_REGISTRY_ADDRESS || "0x0165878A594ca255338adfa4d48449f69242Eb8F";

// Known devnet pool addresses
const DEVNET_POOL_ADDRESSES = [
  "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6", // 0.1 BNB
  "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318", // 1 BNB
  "0x610178dA211FEF7D417bC0e6FeD39F05609AD788", // 10 BNB
];

// Set via deploy logs — update after redeployment
const ENTRY_POINT_ADDRESS = process.env.ENTRY_POINT_ADDRESS || "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e";

/* -------------------------------------------------------------------------- */
/*                            In-memory state                                 */
/* -------------------------------------------------------------------------- */

interface WithdrawalRecord {
  status: "queued" | "submitted" | "confirmed" | "failed";
  txHash?: string;
  error?: string;
}

interface SponsorRecord {
  status: "queued" | "submitted" | "confirmed" | "failed";
  txHash?: string;
  userOpHash?: string;
  error?: string;
}

const withdrawals = new Map<string, WithdrawalRecord>();
const sponsorships = new Map<string, SponsorRecord>();

/* -------------------------------------------------------------------------- */
/*                              Express app                                   */
/* -------------------------------------------------------------------------- */

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Request logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/* ---- Health ---- */
app.get("/health", (_req, res) => {
  res.json({ status: "healthy", mode: "devnet", timestamp: new Date().toISOString() });
});

/* ---- Submit withdrawal ---- */
app.post("/api/withdraw", async (req, res) => {
  try {
    const { proof, merkleRoot, nullifierHash, recipient, fee, refund, aspRoot, poolAddress } =
      req.body;

    // Basic validation
    if (!proof || !merkleRoot || !nullifierHash || !recipient || !aspRoot || !poolAddress) {
      res.status(400).json({
        error: "Missing required fields: proof, merkleRoot, nullifierHash, recipient, aspRoot, poolAddress",
      });
      return;
    }

    // Check if already processed
    if (withdrawals.has(nullifierHash)) {
      const existing = withdrawals.get(nullifierHash)!;
      res.status(409).json({ error: "Nullifier already submitted", status: existing.status, txHash: existing.txHash });
      return;
    }

    // Mark as queued
    withdrawals.set(nullifierHash, { status: "queued" });

    console.log(`[Devnet] Processing withdrawal to ${recipient} via pool ${poolAddress}`);

    // Submit immediately (no queue, no jitter)
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
    const pool = new ethers.Contract(poolAddress, POOL_ABI, wallet);

    const tx = await pool.withdraw(
      proof,
      merkleRoot,
      nullifierHash,
      recipient,
      ethers.ZeroAddress, // must match relayer value used in proof generation (0)
      fee || "0",
      refund || "0",
      aspRoot
    );

    withdrawals.set(nullifierHash, { status: "submitted", txHash: tx.hash });
    console.log(`[Devnet] Tx submitted: ${tx.hash}`);

    // Wait for confirmation in background
    tx.wait()
      .then(() => {
        withdrawals.set(nullifierHash, { status: "confirmed", txHash: tx.hash });
        console.log(`[Devnet] Tx confirmed: ${tx.hash}`);
      })
      .catch((err: Error) => {
        withdrawals.set(nullifierHash, { status: "failed", txHash: tx.hash, error: err.message });
        console.error(`[Devnet] Tx failed: ${tx.hash}`, err.message);
      });

    res.status(202).json({
      id: nullifierHash,
      nullifierHash,
      status: "submitted",
      txHash: tx.hash,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Devnet] Withdrawal error:", message);

    // Try to update status if we have the nullifierHash
    const nh = req.body?.nullifierHash;
    if (nh) {
      withdrawals.set(nh, { status: "failed", error: message });
    }

    res.status(500).json({ error: message });
  }
});

/* ---- Check withdrawal status ---- */
app.get("/api/withdraw/:nullifierHash/status", (req, res) => {
  const record = withdrawals.get(req.params.nullifierHash);
  if (!record) {
    res.status(404).json({ error: "Withdrawal not found" });
    return;
  }
  res.json({ nullifierHash: req.params.nullifierHash, ...record });
});

/* ---- Submit sponsored UserOp (mini-bundler) ---- */
app.post("/api/sponsor", async (req, res) => {
  try {
    const {
      sender,
      nonce,
      initCode,
      callData,
      accountGasLimits,
      preVerificationGas,
      gasFees,
      paymasterAndData,
      signature,
    } = req.body;

    if (!sender || !callData || !paymasterAndData) {
      res.status(400).json({
        error: "Missing required fields: sender, callData, paymasterAndData",
      });
      return;
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
    const entryPoint = new ethers.Contract(ENTRY_POINT_ADDRESS, ENTRY_POINT_ABI, wallet);

    // Build the PackedUserOperation
    const userOp = {
      sender,
      nonce: nonce || "0x0",
      initCode: initCode || "0x",
      callData,
      accountGasLimits: accountGasLimits || ethers.solidityPacked(
        ["uint128", "uint128"],
        [500_000, 500_000]  // verificationGasLimit, callGasLimit
      ),
      preVerificationGas: preVerificationGas || 100_000,
      gasFees: gasFees || ethers.solidityPacked(
        ["uint128", "uint128"],
        [1_000_000_000, 1_000_000_000]  // maxPriorityFeePerGas, maxFeePerGas
      ),
      paymasterAndData,
      signature: signature || "0x",
    };

    // Compute userOpHash for tracking
    let userOpHash: string;
    try {
      userOpHash = await entryPoint.getUserOpHash(userOp);
    } catch {
      // If getUserOpHash fails, generate a tracking hash
      userOpHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ sender, nonce: userOp.nonce })));
    }

    sponsorships.set(userOpHash, { status: "queued", userOpHash });

    console.log(`[Devnet] Processing sponsored UserOp for ${sender}`);
    console.log(`[Devnet] UserOp hash: ${userOpHash}`);

    // Submit via handleOps — the bundler (our wallet) calls this
    const tx = await entryPoint.handleOps([userOp], wallet.address, {
      gasLimit: 2_000_000,
    });

    sponsorships.set(userOpHash, { status: "submitted", txHash: tx.hash, userOpHash });
    console.log(`[Devnet] Sponsor tx submitted: ${tx.hash}`);

    // Wait for confirmation in background
    tx.wait()
      .then(() => {
        sponsorships.set(userOpHash, { status: "confirmed", txHash: tx.hash, userOpHash });
        console.log(`[Devnet] Sponsor tx confirmed: ${tx.hash}`);
      })
      .catch((err: Error) => {
        sponsorships.set(userOpHash, { status: "failed", txHash: tx.hash, userOpHash, error: err.message });
        console.error(`[Devnet] Sponsor tx failed: ${tx.hash}`, err.message);
      });

    res.status(202).json({
      userOpHash,
      txHash: tx.hash,
      status: "submitted",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Devnet] Sponsor error:", message);
    res.status(500).json({ error: message });
  }
});

/* ---- Check sponsor status ---- */
app.get("/api/sponsor/:hash/status", (req, res) => {
  const record = sponsorships.get(req.params.hash);
  if (!record) {
    res.status(404).json({ error: "Sponsored UserOp not found" });
    return;
  }
  res.json(record);
});

/* ---- Sync ASP tree (devnet only) ---- */
app.post("/api/asp/sync", async (req, res) => {
  try {
    const poolAddresses: string[] = req.body?.poolAddresses || DEVNET_POOL_ADDRESSES;

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);

    // Collect all deposit commitments from all pools
    const allCommitments: { commitment: string; leafIndex: number }[] = [];

    for (const poolAddr of poolAddresses) {
      const pool = new ethers.Contract(poolAddr, DEPOSIT_EVENT_ABI, provider);
      const logs = await pool.queryFilter(pool.filters.Deposit());
      for (const log of logs) {
        const parsed = log as ethers.EventLog;
        allCommitments.push({
          commitment: parsed.args[0],
          leafIndex: allCommitments.length,
        });
      }
    }

    if (allCommitments.length === 0) {
      res.json({ aspRoot: ethers.ZeroHash, commitmentCount: 0, message: "No deposits found" });
      return;
    }

    // Build ASP Merkle tree using Poseidon (via circomlibjs)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildPoseidon } = require("circomlibjs") as { buildPoseidon: () => Promise<any> };
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    function poseidonHash2(left: bigint, right: bigint): bigint {
      const h = poseidon([left, right]);
      return BigInt(F.toObject(h));
    }

    const TREE_DEPTH = 20;
    const zeroValues: bigint[] = new Array(TREE_DEPTH + 1);
    zeroValues[0] = 0n;
    for (let i = 1; i <= TREE_DEPTH; i++) {
      zeroValues[i] = poseidonHash2(zeroValues[i - 1], zeroValues[i - 1]);
    }

    const layers: bigint[][] = new Array(TREE_DEPTH + 1);
    for (let i = 0; i <= TREE_DEPTH; i++) layers[i] = [];

    const leaves: bigint[] = [];
    for (const entry of allCommitments) {
      const leaf = BigInt(entry.commitment);
      const index = leaves.length;
      leaves.push(leaf);
      layers[0] = [...leaves];

      // Rebuild from this leaf
      let currentIndex = index;
      for (let level = 0; level < TREE_DEPTH; level++) {
        const pairIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
        const leftIndex = Math.min(currentIndex, pairIndex);
        const rightIndex = Math.max(currentIndex, pairIndex);
        const left = layers[level][leftIndex] ?? zeroValues[level];
        const right = layers[level][rightIndex] ?? zeroValues[level];
        const parentIndex = Math.floor(currentIndex / 2);
        layers[level + 1][parentIndex] = poseidonHash2(left, right);
        currentIndex = parentIndex;
      }
    }

    const root = layers[TREE_DEPTH][0];
    const aspRootHex = "0x" + root.toString(16).padStart(64, "0");

    // Update ASP registry on-chain
    const aspRegistry = new ethers.Contract(ASP_REGISTRY_ADDRESS, ASP_REGISTRY_ABI, wallet);
    const tx = await aspRegistry.updateASPRoot(aspRootHex);
    await tx.wait();

    console.log(`[Devnet] ASP root synced: ${aspRootHex.slice(0, 18)}... (${allCommitments.length} commitments)`);

    res.json({
      aspRoot: aspRootHex,
      commitmentCount: allCommitments.length,
      txHash: tx.hash,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Devnet] ASP sync error:", message);
    res.status(500).json({ error: message });
  }
});

/* ---- Start ---- */
app.listen(PORT, () => {
  console.log(`\n[Devnet Relayer] Listening on http://localhost:${PORT}`);
  console.log(`[Devnet Relayer] RPC: ${RPC_URL}`);
  console.log(`[Devnet Relayer] Relayer address: ${new ethers.Wallet(RELAYER_PRIVATE_KEY).address}`);
  console.log(`[Devnet Relayer] No DB, no workers, instant submission\n`);
});
