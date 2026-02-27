import { Router, Request, Response } from "express";
import { query } from "../db";
import { queueWithdrawal, getWithdrawalStatus } from "../services/relayer.service";
import { sponsorUserOp } from "../services/bundler.service";
import { getASPProof, getASPTree } from "../services/asp.service";
import { checkAddress } from "../services/screening.service";

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/deposit/status
// Check the screening/ASP status of a deposit by commitment.
// Body: { commitment: string }
// ---------------------------------------------------------------------------
router.post("/deposit/status", async (req: Request, res: Response) => {
  try {
    const { commitment } = req.body;

    if (!commitment || typeof commitment !== "string") {
      res.status(400).json({ error: "Missing or invalid commitment" });
      return;
    }

    const result = await query<{
      commitment: string;
      leaf_index: number;
      screening_status: string;
      risk_score: number | null;
      screening_flags: string[] | null;
      asp_included: boolean;
      block_number: string;
      tx_hash: string;
      created_at: Date;
    }>(
      `SELECT commitment, leaf_index, screening_status, risk_score,
              screening_flags, asp_included, block_number, tx_hash, created_at
       FROM deposits WHERE commitment = $1`,
      [commitment]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Deposit not found" });
      return;
    }

    const deposit = result.rows[0];
    res.json({
      commitment: deposit.commitment,
      leafIndex: deposit.leaf_index,
      screening: {
        status: deposit.screening_status,
        riskScore: deposit.risk_score,
        flags: deposit.screening_flags,
      },
      aspIncluded: deposit.asp_included,
      blockNumber: parseInt(deposit.block_number, 10),
      txHash: deposit.tx_hash,
      timestamp: deposit.created_at,
    });
  } catch (err) {
    console.error("[API] POST /deposit/status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/withdraw
// Queue a withdrawal request with randomized jitter.
// Body: { proof, merkleRoot, nullifierHash, recipient, fee, refund, aspRoot, poolAddress }
// ---------------------------------------------------------------------------
router.post("/withdraw", async (req: Request, res: Response) => {
  try {
    const {
      proof,
      merkleRoot,
      nullifierHash,
      recipient,
      fee,
      refund,
      aspRoot,
      poolAddress,
    } = req.body;

    // Validate required fields
    const missing: string[] = [];
    if (!proof) missing.push("proof");
    if (!merkleRoot) missing.push("merkleRoot");
    if (!nullifierHash) missing.push("nullifierHash");
    if (!recipient) missing.push("recipient");
    if (!aspRoot) missing.push("aspRoot");
    if (!poolAddress) missing.push("poolAddress");

    if (missing.length > 0) {
      res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
      });
      return;
    }

    // Screen the recipient address
    const screening = await checkAddress(recipient);
    if (!screening.approved) {
      res.status(403).json({
        error: "Recipient address is sanctioned or blocked",
        flags: screening.flags,
      });
      return;
    }

    const result = await queueWithdrawal({
      proof,
      merkleRoot,
      nullifierHash,
      recipient,
      fee: fee ?? "0",
      refund: refund ?? "0",
      aspRoot,
      poolAddress,
    });

    res.status(202).json({
      id: result.id,
      nullifierHash: result.nullifierHash,
      status: result.status,
      scheduledAt: result.scheduledAt.toISOString(),
      estimatedCompletionAt: result.estimatedCompletionAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    // Client errors (validation failures)
    if (
      message.includes("Invalid") ||
      message.includes("already") ||
      message.includes("Unable to verify")
    ) {
      res.status(400).json({ error: message });
      return;
    }

    console.error("[API] POST /withdraw error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/withdraw/:nullifierHash/status
// Get the status of a queued/processed withdrawal.
// ---------------------------------------------------------------------------
router.get(
  "/withdraw/:nullifierHash/status",
  async (req: Request, res: Response) => {
    try {
      const { nullifierHash } = req.params;

      if (!nullifierHash || !nullifierHash.startsWith("0x")) {
        res.status(400).json({ error: "Invalid nullifier hash format" });
        return;
      }

      const status = await getWithdrawalStatus(nullifierHash);

      if (!status) {
        res.status(404).json({ error: "Withdrawal not found" });
        return;
      }

      res.json({
        nullifierHash: status.nullifierHash,
        status: status.status,
        txHash: status.txHash,
        scheduledAt: status.scheduledAt,
        submittedAt: status.submittedAt,
        error: status.error,
      });
    } catch (err) {
      console.error("[API] GET /withdraw/:nullifierHash/status error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/sponsor/userOp
// Create a sponsored UserOperation with paymaster data and submit to bundler.
// Body: { sender, callData, initCode?, signature?, proof, merkleRoot, nullifierHash, aspRoot }
// ---------------------------------------------------------------------------
router.post("/sponsor/userOp", async (req: Request, res: Response) => {
  try {
    const {
      sender,
      callData,
      initCode,
      signature,
      proof,
      merkleRoot,
      nullifierHash,
      aspRoot,
    } = req.body;

    const missing: string[] = [];
    if (!sender) missing.push("sender");
    if (!callData) missing.push("callData");
    if (!proof) missing.push("proof");
    if (!merkleRoot) missing.push("merkleRoot");
    if (!nullifierHash) missing.push("nullifierHash");
    if (!aspRoot) missing.push("aspRoot");

    if (missing.length > 0) {
      res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
      });
      return;
    }

    const result = await sponsorUserOp({
      sender,
      callData,
      initCode,
      signature,
      proof,
      merkleRoot,
      nullifierHash,
      aspRoot,
    });

    res.json({
      userOpHash: result.userOpHash,
      paymasterAndData: result.paymasterAndData,
      gasEstimates: {
        preVerificationGas: result.preVerificationGas,
        verificationGasLimit: result.verificationGasLimit,
        callGasLimit: result.callGasLimit,
        maxFeePerGas: result.maxFeePerGas,
        maxPriorityFeePerGas: result.maxPriorityFeePerGas,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message.includes("Invalid") || message.includes("already used")) {
      res.status(400).json({ error: message });
      return;
    }

    console.error("[API] POST /sponsor/userOp error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/pool/:token/:denomination/stats
// Get pool statistics (deposit count, pending withdrawals, etc.)
// :token is "BNB" for native or a token address for ERC-20
// :denomination in wei
// ---------------------------------------------------------------------------
router.get(
  "/pool/:token/:denomination/stats",
  async (req: Request, res: Response) => {
    try {
      const { token, denomination } = req.params;

      // Build pool filter
      const isNative = token.toUpperCase() === "BNB";
      const tokenFilter = isNative ? "token IS NULL" : "LOWER(token) = LOWER($3)";

      const params: unknown[] = [denomination];
      let paramIndex = 2;

      let tokenParam: string | undefined;
      if (!isNative) {
        paramIndex++;
        tokenParam = token;
      }

      // Total deposits
      const depositCountResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM deposits
         WHERE denomination = $1 ${!isNative ? `AND LOWER(token) = LOWER($2)` : "AND token IS NULL"}`,
        isNative ? [denomination] : [denomination, tokenParam]
      );

      // Approved deposits (ASP included)
      const approvedResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM deposits
         WHERE denomination = $1 AND asp_included = TRUE
         ${!isNative ? `AND LOWER(token) = LOWER($2)` : "AND token IS NULL"}`,
        isNative ? [denomination] : [denomination, tokenParam]
      );

      // Blocked deposits
      const blockedResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM deposits
         WHERE denomination = $1 AND screening_status = 'blocked'
         ${!isNative ? `AND LOWER(token) = LOWER($2)` : "AND token IS NULL"}`,
        isNative ? [denomination] : [denomination, tokenParam]
      );

      // Pending withdrawals
      const pendingWithdrawals = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM withdrawals
         WHERE status IN ('queued', 'processing')
         ${!isNative ? `AND pool_address IN (
           SELECT DISTINCT pool_address FROM deposits WHERE LOWER(token) = LOWER($1) AND denomination = $2
         )` : `AND pool_address IN (
           SELECT DISTINCT pool_address FROM deposits WHERE token IS NULL AND denomination = $1
         )`}`,
        isNative ? [denomination] : [tokenParam, denomination]
      );

      // Completed withdrawals
      const completedWithdrawals = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM withdrawals
         WHERE status = 'confirmed'
         ${!isNative ? `AND pool_address IN (
           SELECT DISTINCT pool_address FROM deposits WHERE LOWER(token) = LOWER($1) AND denomination = $2
         )` : `AND pool_address IN (
           SELECT DISTINCT pool_address FROM deposits WHERE token IS NULL AND denomination = $1
         )`}`,
        isNative ? [denomination] : [tokenParam, denomination]
      );

      const tree = getASPTree();

      res.json({
        token: isNative ? "BNB" : token,
        denomination,
        deposits: {
          total: parseInt(depositCountResult.rows[0].count, 10),
          approved: parseInt(approvedResult.rows[0].count, 10),
          blocked: parseInt(blockedResult.rows[0].count, 10),
        },
        withdrawals: {
          pending: parseInt(pendingWithdrawals.rows[0].count, 10),
          completed: parseInt(completedWithdrawals.rows[0].count, 10),
        },
        asp: {
          treeSize: tree.leafCount,
          currentRoot: tree.root,
        },
      });
    } catch (err) {
      console.error("[API] GET /pool/:token/:denomination/stats error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/merkle/proof/:commitment
// Get the ASP Merkle proof for a commitment.
// ---------------------------------------------------------------------------
router.get(
  "/merkle/proof/:commitment",
  async (req: Request, res: Response) => {
    try {
      const { commitment } = req.params;

      if (!commitment || !commitment.startsWith("0x")) {
        res.status(400).json({ error: "Invalid commitment format" });
        return;
      }

      // Verify the commitment exists and is approved
      const depositResult = await query<{
        screening_status: string;
        asp_included: boolean;
      }>(
        "SELECT screening_status, asp_included FROM deposits WHERE commitment = $1",
        [commitment]
      );

      if (depositResult.rows.length === 0) {
        res.status(404).json({ error: "Commitment not found" });
        return;
      }

      const deposit = depositResult.rows[0];
      if (!deposit.asp_included) {
        res.status(403).json({
          error: "Commitment is not included in the ASP tree",
          screeningStatus: deposit.screening_status,
        });
        return;
      }

      const proof = getASPProof(commitment);
      if (!proof) {
        res.status(404).json({
          error: "Proof not available (commitment may not be indexed yet)",
        });
        return;
      }

      res.json({
        commitment,
        root: proof.root,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
      });
    } catch (err) {
      console.error("[API] GET /merkle/proof/:commitment error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
