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

/* -------------------------------------------------------------------------- */
/*                            In-memory state                                 */
/* -------------------------------------------------------------------------- */

interface WithdrawalRecord {
  status: "queued" | "submitted" | "confirmed" | "failed";
  txHash?: string;
  error?: string;
}

const withdrawals = new Map<string, WithdrawalRecord>();

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
      wallet.address, // relayer = our address
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

/* ---- Start ---- */
app.listen(PORT, () => {
  console.log(`\n[Devnet Relayer] Listening on http://localhost:${PORT}`);
  console.log(`[Devnet Relayer] RPC: ${RPC_URL}`);
  console.log(`[Devnet Relayer] Relayer address: ${new ethers.Wallet(RELAYER_PRIVATE_KEY).address}`);
  console.log(`[Devnet Relayer] No DB, no workers, instant submission\n`);
});
