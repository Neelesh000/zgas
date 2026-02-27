import { ethers } from "ethers";
import { config } from "../config";
import { query } from "../db";

// ERC-4337 EntryPoint ABI (minimal)
const ENTRY_POINT_ABI = [
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp) view returns (bytes32)",
];

const PRIVACY_PAYMASTER_ABI = [
  "function maxGasSponsorship() view returns (uint256)",
];

/**
 * Packed UserOperation for ERC-4337 v0.7 (EntryPoint 0.7).
 */
export interface PackedUserOperation {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  accountGasLimits: string; // bytes32: packed(verificationGasLimit, callGasLimit)
  preVerificationGas: string;
  gasFees: string; // bytes32: packed(maxFeePerGas, maxPriorityFeePerGas)
  paymasterAndData: string;
  signature: string;
}

export interface UserOpRequest {
  sender: string;
  callData: string;
  initCode?: string;
  signature?: string;
  // ZK proof fields for paymaster
  proof: string;
  merkleRoot: string;
  nullifierHash: string;
  aspRoot: string;
}

export interface SponsorResult {
  userOpHash: string;
  paymasterAndData: string;
  preVerificationGas: string;
  verificationGasLimit: string;
  callGasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

/**
 * Pack two uint128 values into a single bytes32.
 */
function packUint128(high: bigint, low: bigint): string {
  const packed = (high << 128n) | low;
  return ethers.zeroPadValue(ethers.toBeHex(packed), 32);
}

/**
 * Encode paymaster data for the PrivacyPaymaster contract.
 *
 * Layout (after 52-byte standard prefix):
 *   [0:256]   - proof (8 uint256 = 256 bytes)
 *   [256:288] - merkleRoot (bytes32)
 *   [288:320] - nullifierHash (bytes32)
 *   [320:352] - aspRoot (bytes32)
 */
function encodePaymasterData(
  paymasterAddress: string,
  verificationGasLimit: bigint,
  postOpGasLimit: bigint,
  proof: string,
  merkleRoot: string,
  nullifierHash: string,
  aspRoot: string
): string {
  // Standard prefix: paymaster address (20 bytes) + packed gas limits (32 bytes)
  // = 52 bytes total
  const packedGas = packUint128(verificationGasLimit, postOpGasLimit);

  // Paymaster-specific data: proof + merkleRoot + nullifierHash + aspRoot
  const paymasterSpecificData = ethers.concat([
    proof,
    merkleRoot,
    nullifierHash,
    aspRoot,
  ]);

  return ethers.concat([
    paymasterAddress,
    packedGas,
    paymasterSpecificData,
  ]);
}

/**
 * Estimate gas for a UserOperation using the bundler's eth_estimateUserOperationGas.
 */
async function estimateGasViaBundler(
  userOp: PackedUserOperation
): Promise<{
  preVerificationGas: bigint;
  verificationGasLimit: bigint;
  callGasLimit: bigint;
}> {
  if (!config.bundlerUrl) {
    // Return conservative defaults if no bundler configured
    return {
      preVerificationGas: 50000n,
      verificationGasLimit: 500000n,
      callGasLimit: 300000n,
    };
  }

  try {
    const response = await fetch(config.bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_estimateUserOperationGas",
        params: [userOp, config.contracts.entryPoint],
      }),
    });

    const data = (await response.json()) as {
      error?: { message: string };
      result?: { preVerificationGas: string; verificationGasLimit: string; callGasLimit: string };
    };

    if (data.error) {
      throw new Error(`Bundler estimation error: ${data.error.message}`);
    }

    return {
      preVerificationGas: BigInt(data.result!.preVerificationGas),
      verificationGasLimit: BigInt(data.result!.verificationGasLimit),
      callGasLimit: BigInt(data.result!.callGasLimit),
    };
  } catch (err) {
    console.error(
      "[Bundler] Gas estimation failed, using defaults:",
      err instanceof Error ? err.message : err
    );
    return {
      preVerificationGas: 50000n,
      verificationGasLimit: 500000n,
      callGasLimit: 300000n,
    };
  }
}

/**
 * Submit a UserOperation to the bundler via eth_sendUserOperation.
 */
async function sendToBundler(
  userOp: PackedUserOperation
): Promise<string> {
  if (!config.bundlerUrl) {
    throw new Error("Bundler URL not configured");
  }

  const response = await fetch(config.bundlerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendUserOperation",
      params: [userOp, config.contracts.entryPoint],
    }),
  });

  const data = (await response.json()) as {
    error?: { message: string };
    result?: string;
  };

  if (data.error) {
    throw new Error(`Bundler submission error: ${data.error.message}`);
  }

  return data.result as string; // userOpHash
}

/**
 * Create a sponsored UserOperation with paymaster data, estimate gas,
 * and submit to the bundler.
 */
export async function sponsorUserOp(
  req: UserOpRequest
): Promise<SponsorResult> {
  // Validate inputs
  if (!ethers.isAddress(req.sender)) {
    throw new Error("Invalid sender address");
  }
  if (!req.proof || !req.proof.startsWith("0x")) {
    throw new Error("Invalid proof format");
  }
  if (!req.nullifierHash || !req.nullifierHash.startsWith("0x")) {
    throw new Error("Invalid nullifierHash format");
  }

  // Check nullifier hasn't been used for sponsorship
  const existing = await query<{ id: string }>(
    "SELECT id FROM sponsorships WHERE nullifier_hash = $1 AND status NOT IN ('failed', 'rejected')",
    [req.nullifierHash]
  );
  if (existing.rows.length > 0) {
    throw new Error("Nullifier already used for sponsorship");
  }

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  // Get fee data
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? ethers.parseUnits("5", "gwei");
  const maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas ?? ethers.parseUnits("1", "gwei");

  // Get nonce from EntryPoint
  const entryPoint = new ethers.Contract(
    config.contracts.entryPoint,
    ENTRY_POINT_ABI,
    provider
  );
  const nonce = await entryPoint.getNonce(req.sender, 0);

  // Gas limits
  const verificationGasLimit = 500000n;
  const callGasLimit = 300000n;
  const postOpGasLimit = 100000n;
  const preVerificationGas = 50000n;

  // Build paymasterAndData
  const paymasterAndData = encodePaymasterData(
    config.contracts.privacyPaymaster,
    verificationGasLimit,
    postOpGasLimit,
    req.proof,
    req.merkleRoot,
    req.nullifierHash,
    req.aspRoot
  );

  // Pack gas fields
  const accountGasLimits = packUint128(verificationGasLimit, callGasLimit);
  const gasFees = packUint128(
    BigInt(maxFeePerGas.toString()),
    BigInt(maxPriorityFeePerGas.toString())
  );

  // Build UserOperation
  const userOp: PackedUserOperation = {
    sender: req.sender,
    nonce: ethers.toBeHex(nonce),
    initCode: req.initCode ?? "0x",
    callData: req.callData,
    accountGasLimits,
    preVerificationGas: ethers.toBeHex(preVerificationGas),
    gasFees,
    paymasterAndData,
    signature: req.signature ?? "0x",
  };

  // Estimate gas via bundler (may refine the defaults)
  try {
    const gasEstimate = await estimateGasViaBundler(userOp);
    userOp.preVerificationGas = ethers.toBeHex(gasEstimate.preVerificationGas);
    userOp.accountGasLimits = packUint128(
      gasEstimate.verificationGasLimit,
      gasEstimate.callGasLimit
    );
  } catch (err) {
    console.warn(
      "[Bundler] Using default gas estimates:",
      err instanceof Error ? err.message : err
    );
  }

  // Compute max gas cost for the sponsorship record
  const maxGasCost =
    (verificationGasLimit + callGasLimit + preVerificationGas + postOpGasLimit) *
    BigInt(maxFeePerGas.toString());

  // Persist sponsorship record
  await query(
    `INSERT INTO sponsorships
      (nullifier_hash, sender, paymaster_address, max_gas_cost, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [
      req.nullifierHash,
      req.sender,
      config.contracts.privacyPaymaster,
      maxGasCost.toString(),
    ]
  );

  // Submit to bundler
  let userOpHash: string;
  try {
    userOpHash = await sendToBundler(userOp);
  } catch (err) {
    // If no bundler, compute hash locally for tracking
    if (!config.bundlerUrl) {
      userOpHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "bytes", "bytes"],
          [userOp.sender, userOp.nonce, userOp.initCode, userOp.callData]
        )
      );
      console.warn(
        "[Bundler] No bundler URL configured, UserOp not submitted. Hash computed locally."
      );
    } else {
      await query(
        `UPDATE sponsorships SET status = 'failed', error_message = $1
         WHERE nullifier_hash = $2`,
        [
          err instanceof Error ? err.message : String(err),
          req.nullifierHash,
        ]
      );
      throw err;
    }
  }

  // Update sponsorship with UserOp hash
  await query(
    `UPDATE sponsorships SET user_op_hash = $1, status = 'submitted'
     WHERE nullifier_hash = $2`,
    [userOpHash, req.nullifierHash]
  );

  return {
    userOpHash,
    paymasterAndData,
    preVerificationGas: userOp.preVerificationGas,
    verificationGasLimit: ethers.toBeHex(verificationGasLimit),
    callGasLimit: ethers.toBeHex(callGasLimit),
    maxFeePerGas: ethers.toBeHex(maxFeePerGas),
    maxPriorityFeePerGas: ethers.toBeHex(maxPriorityFeePerGas),
  };
}
