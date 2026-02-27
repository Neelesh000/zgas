import { ethers } from "ethers";
import { config } from "../config";
import { query } from "../db";

const PRIVACY_POOL_ABI = [
  "function withdraw(bytes calldata _proof, bytes32 _root, bytes32 _nullifierHash, address payable _recipient, address payable _relayer, uint256 _fee, uint256 _refund, bytes32 _aspRoot) external",
  "function nullifierHashes(bytes32) view returns (bool)",
  "function denomination() view returns (uint256)",
];

export interface WithdrawRequest {
  proof: string;
  merkleRoot: string;
  nullifierHash: string;
  recipient: string;
  fee: string;
  refund: string;
  aspRoot: string;
  poolAddress: string;
}

export interface WithdrawResult {
  id: string;
  nullifierHash: string;
  status: string;
  scheduledAt: Date;
  estimatedCompletionAt: Date;
}

export interface WithdrawStatus {
  nullifierHash: string;
  status: string;
  txHash: string | null;
  scheduledAt: Date | null;
  submittedAt: Date | null;
  error: string | null;
}

/**
 * Validate a withdrawal request before queuing.
 */
async function validateWithdrawRequest(
  req: WithdrawRequest
): Promise<{ valid: boolean; reason?: string }> {
  // Validate addresses
  if (!ethers.isAddress(req.recipient)) {
    return { valid: false, reason: "Invalid recipient address" };
  }

  // Validate hex fields
  for (const field of ["proof", "merkleRoot", "nullifierHash", "aspRoot"] as const) {
    if (!req[field] || !req[field].startsWith("0x")) {
      return { valid: false, reason: `Invalid ${field}: must be hex string` };
    }
  }

  // Validate proof length (8 uint256 values = 256 bytes = 512 hex chars + 0x prefix)
  if (req.proof.length < 514) {
    return { valid: false, reason: "Proof data too short" };
  }

  // Check nullifier hasn't been used on-chain
  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const pool = new ethers.Contract(
      req.poolAddress,
      PRIVACY_POOL_ABI,
      provider
    );
    const spent = await pool.nullifierHashes(req.nullifierHash);
    if (spent) {
      return { valid: false, reason: "Nullifier already spent" };
    }
  } catch (err) {
    console.error(
      "[Relayer] Failed to check nullifier on-chain:",
      err instanceof Error ? err.message : err
    );
    return { valid: false, reason: "Unable to verify nullifier status" };
  }

  // Check not already queued
  const existing = await query<{ id: string }>(
    "SELECT id FROM withdrawals WHERE nullifier_hash = $1 AND status NOT IN ('failed', 'rejected')",
    [req.nullifierHash]
  );
  if (existing.rows.length > 0) {
    return { valid: false, reason: "Withdrawal already queued" };
  }

  return { valid: true };
}

/**
 * Compute a randomized delay between min and max withdrawal delay.
 * This jitter prevents timing correlation attacks.
 */
function computeJitterMs(): number {
  const min = config.minWithdrawalDelayMs;
  const max = config.maxWithdrawalDelayMs;
  return min + Math.floor(Math.random() * (max - min));
}

/**
 * Queue a withdrawal request with randomized delay.
 */
export async function queueWithdrawal(
  req: WithdrawRequest
): Promise<WithdrawResult> {
  const validation = await validateWithdrawRequest(req);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const relayerAddress = wallet.address;

  const jitterMs = computeJitterMs();
  const scheduledAt = new Date(Date.now() + jitterMs);
  const estimatedCompletionAt = new Date(scheduledAt.getTime() + 60000); // +1min for tx time

  const result = await query<{ id: string }>(
    `INSERT INTO withdrawals
      (nullifier_hash, recipient, relayer_address, fee, pool_address, proof,
       merkle_root, asp_root, refund, status, scheduled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', $10)
     RETURNING id`,
    [
      req.nullifierHash,
      req.recipient,
      relayerAddress,
      req.fee,
      req.poolAddress,
      req.proof,
      req.merkleRoot,
      req.aspRoot,
      req.refund,
      scheduledAt.toISOString(),
    ]
  );

  console.log(
    `[Relayer] Withdrawal queued: ${req.nullifierHash.slice(0, 10)}... ` +
    `scheduled at ${scheduledAt.toISOString()} (jitter: ${Math.round(jitterMs / 1000)}s)`
  );

  return {
    id: result.rows[0].id,
    nullifierHash: req.nullifierHash,
    status: "queued",
    scheduledAt,
    estimatedCompletionAt,
  };
}

/**
 * Submit a withdrawal transaction on-chain from the relayer hot wallet.
 */
export async function submitWithdrawal(withdrawalId: string): Promise<string> {
  const result = await query<{
    id: string;
    nullifier_hash: string;
    recipient: string;
    relayer_address: string;
    fee: string;
    pool_address: string;
    proof: string;
    merkle_root: string;
    asp_root: string;
    refund: string;
    retry_count: number;
  }>(
    "SELECT * FROM withdrawals WHERE id = $1 AND status IN ('queued', 'processing')",
    [withdrawalId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Withdrawal ${withdrawalId} not found or not in processable state`);
  }

  const w = result.rows[0];

  // Mark as processing
  await query(
    "UPDATE withdrawals SET status = 'processing', updated_at = NOW() WHERE id = $1",
    [withdrawalId]
  );

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);

  const pool = new ethers.Contract(
    w.pool_address,
    PRIVACY_POOL_ABI,
    wallet
  );

  try {
    // Double-check nullifier hasn't been spent since queuing
    const alreadySpent = await pool.nullifierHashes(w.nullifier_hash);
    if (alreadySpent) {
      await query(
        "UPDATE withdrawals SET status = 'rejected', error_message = 'Nullifier already spent', updated_at = NOW() WHERE id = $1",
        [withdrawalId]
      );
      throw new Error("Nullifier already spent on-chain");
    }

    const tx = await pool.withdraw(
      w.proof,
      w.merkle_root,
      w.nullifier_hash,
      w.recipient,
      w.relayer_address,
      w.fee,
      w.refund,
      w.asp_root
    );

    await query(
      "UPDATE withdrawals SET status = 'submitted', tx_hash = $1, submitted_at = NOW(), updated_at = NOW() WHERE id = $2",
      [tx.hash, withdrawalId]
    );

    console.log(
      `[Relayer] Withdrawal submitted: ${w.nullifier_hash.slice(0, 10)}... tx: ${tx.hash}`
    );

    // Wait for confirmation
    const receipt = await tx.wait();

    await query(
      `UPDATE withdrawals
       SET status = 'confirmed', block_number = $1, gas_used = $2, updated_at = NOW()
       WHERE id = $3`,
      [receipt.blockNumber, receipt.gasUsed.toString(), withdrawalId]
    );

    console.log(
      `[Relayer] Withdrawal confirmed: ${w.nullifier_hash.slice(0, 10)}... block: ${receipt.blockNumber}`
    );

    return tx.hash;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const newRetryCount = w.retry_count + 1;
    const maxRetries = 3;

    if (newRetryCount >= maxRetries) {
      await query(
        `UPDATE withdrawals
         SET status = 'failed', error_message = $1, retry_count = $2, updated_at = NOW()
         WHERE id = $3`,
        [errorMessage, newRetryCount, withdrawalId]
      );
    } else {
      // Re-queue with a new jitter delay
      const newScheduledAt = new Date(Date.now() + computeJitterMs());
      await query(
        `UPDATE withdrawals
         SET status = 'queued', error_message = $1, retry_count = $2,
             scheduled_at = $3, updated_at = NOW()
         WHERE id = $4`,
        [errorMessage, newRetryCount, newScheduledAt.toISOString(), withdrawalId]
      );
    }

    throw err;
  }
}

/**
 * Get the status of a withdrawal by nullifier hash.
 */
export async function getWithdrawalStatus(
  nullifierHash: string
): Promise<WithdrawStatus | null> {
  const result = await query<{
    nullifier_hash: string;
    status: string;
    tx_hash: string | null;
    scheduled_at: Date | null;
    submitted_at: Date | null;
    error_message: string | null;
  }>(
    `SELECT nullifier_hash, status, tx_hash, scheduled_at, submitted_at, error_message
     FROM withdrawals
     WHERE nullifier_hash = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [nullifierHash]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    nullifierHash: row.nullifier_hash,
    status: row.status,
    txHash: row.tx_hash,
    scheduledAt: row.scheduled_at,
    submittedAt: row.submitted_at,
    error: row.error_message,
  };
}

/**
 * Fetch all withdrawals that are due for processing.
 */
export async function getDueWithdrawals(): Promise<string[]> {
  const result = await query<{ id: string }>(
    `SELECT id FROM withdrawals
     WHERE status = 'queued' AND scheduled_at <= NOW()
     ORDER BY scheduled_at ASC
     LIMIT 10`
  );
  return result.rows.map((r) => r.id);
}
