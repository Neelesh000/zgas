"use client";

import { useState, useCallback, useEffect } from "react";
import {
  useAccount,
  usePublicClient,
  useWalletClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseEther, type Address, type Hash, encodePacked, keccak256 } from "viem";
import {
  CONTRACTS,
  ACTIVE_CHAIN_ID,
  DENOMINATIONS,
  PRIVACY_POOL_ABI,
  TOKEN_POOL_ABI,
  ASP_REGISTRY_ABI,
  ERC20_ABI,
  CIRCUIT_PATHS,
  RELAYER_URL,
  type DenominationOption,
} from "@/lib/constants";
import { poseidonHash2, poseidonHash1 } from "@/lib/poseidon";

/* -------------------------------------------------------------------------- */
/*                                  Types                                     */
/* -------------------------------------------------------------------------- */

export interface NoteData {
  secret: string;
  nullifier: string;
  commitment: string;
  denomination: string;
  poolKey: string;
  token: string;
  noteString: string;
}

export interface PoolStatEntry {
  label: string;
  token: string;
  depositCount: number;
  anonymitySet: number;
  maxAnonymity: number;
}

export interface WithdrawParams {
  noteString: string;
  recipientAddress: Address;
  useRelayer: boolean;
  proof?: string;
  merkleRoot?: string;
  nullifierHash?: string;
  fee?: string;
  refund?: string;
  aspRoot?: string;
  poolAddress?: string;
}

export interface SponsorParams {
  noteString: string;
  targetTxData: `0x${string}`;
  targetAddress: Address;
}

/* -------------------------------------------------------------------------- */
/*                       Note generation (client-side)                        */
/* -------------------------------------------------------------------------- */

const SNARK_FIELD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

function randomFieldElement(): bigint {
  const buf = new Uint8Array(31);
  crypto.getRandomValues(buf);
  let value = 0n;
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8n) | BigInt(buf[i]);
  }
  return value % SNARK_FIELD;
}

function toHex32(val: bigint): string {
  return "0x" + val.toString(16).padStart(64, "0");
}

const USE_MOCK_PROOFS = process.env.NEXT_PUBLIC_USE_MOCK_PROOFS === "true";

/**
 * Produces commitment = Poseidon(secret, nullifier).
 * Falls back to keccak256 in mock mode.
 */
export async function computeCommitmentAsync(secret: bigint, nullifier: bigint): Promise<string> {
  if (USE_MOCK_PROOFS) {
    return keccak256(encodePacked(["uint256", "uint256"], [secret, nullifier]));
  }
  const hash = await poseidonHash2(secret, nullifier);
  return toHex32(hash);
}

/**
 * Produces nullifierHash = Poseidon(nullifier).
 * Falls back to keccak256 in mock mode.
 */
export async function computeNullifierHashAsync(nullifier: bigint): Promise<string> {
  if (USE_MOCK_PROOFS) {
    return keccak256(encodePacked(["uint256"], [nullifier]));
  }
  const hash = await poseidonHash1(nullifier);
  return toHex32(hash);
}

/**
 * Produces sponsorship nullifierHash = Poseidon(nullifier, 2).
 * Falls back to keccak256 in mock mode.
 */
export async function computeSponsorshipNullifierHashAsync(nullifier: bigint): Promise<string> {
  if (USE_MOCK_PROOFS) {
    return keccak256(encodePacked(["uint256", "uint256"], [nullifier, 2n]));
  }
  const hash = await poseidonHash2(nullifier, 2n);
  return toHex32(hash);
}

// Synchronous versions for backward compatibility (mock mode only)
export function computeCommitment(secret: bigint, nullifier: bigint): string {
  return keccak256(encodePacked(["uint256", "uint256"], [secret, nullifier]));
}

export function computeNullifierHash(nullifier: bigint): string {
  return keccak256(encodePacked(["uint256"], [nullifier]));
}

export async function generateNoteAsync(
  denom: DenominationOption
): Promise<NoteData> {
  const secret = randomFieldElement();
  const nullifier = randomFieldElement();
  const commitment = await computeCommitmentAsync(secret, nullifier);

  const noteString = `pp-${denom.token.toLowerCase()}-${denom.displayAmount.replace(
    /,/g,
    ""
  )}-${toHex32(secret).slice(2)}${toHex32(nullifier).slice(2)}`;

  return {
    secret: toHex32(secret),
    nullifier: toHex32(nullifier),
    commitment,
    denomination: denom.value,
    poolKey: denom.poolKey,
    token: denom.token,
    noteString,
  };
}

export function generateNote(denom: DenominationOption): NoteData {
  const secret = randomFieldElement();
  const nullifier = randomFieldElement();

  // Sync version uses keccak256 — only for mock mode
  const commitmentHex = computeCommitment(secret, nullifier);

  const noteString = `pp-${denom.token.toLowerCase()}-${denom.displayAmount.replace(
    /,/g,
    ""
  )}-${toHex32(secret).slice(2)}${toHex32(nullifier).slice(2)}`;

  return {
    secret: toHex32(secret),
    nullifier: toHex32(nullifier),
    commitment: commitmentHex,
    denomination: denom.value,
    poolKey: denom.poolKey,
    token: denom.token,
    noteString,
  };
}

export function parseNote(noteString: string): {
  token: string;
  amount: string;
  secret: string;
  nullifier: string;
} | null {
  const match = noteString.match(
    /^pp-(\w+)-([\d.]+)-([0-9a-f]{64})([0-9a-f]{64})$/
  );
  if (!match) return null;
  return {
    token: match[1].toUpperCase(),
    amount: match[2],
    secret: "0x" + match[3],
    nullifier: "0x" + match[4],
  };
}

/* -------------------------------------------------------------------------- */
/*                               Main hook                                    */
/* -------------------------------------------------------------------------- */

export function usePrivacyPool() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
  } = useWriteContract();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  const [poolStats, setPoolStats] = useState<PoolStatEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const contracts = CONTRACTS[ACTIVE_CHAIN_ID];

  /* ---- Fetch pool stats (chunked for Alchemy free tier) ---- */
  const DEPLOY_BLOCK = 92962584n;
  const CHUNK = 9n;

  const fetchPoolStats = useCallback(async () => {
    if (!publicClient) return;
    setIsLoading(true);

    try {
      const latestBlock = await publicClient.getBlockNumber();
      const statEntries: PoolStatEntry[] = [];

      for (const denom of DENOMINATIONS) {
        const poolAddress = contracts[
          denom.poolKey as keyof typeof contracts
        ] as Address;

        try {
          // Chunked deposit log fetching
          const depositEvent = {
            type: "event" as const,
            name: "Deposit" as const,
            inputs: [
              { type: "bytes32" as const, name: "commitment" as const, indexed: true },
              { type: "uint32" as const, name: "leafIndex" as const, indexed: false },
              { type: "uint256" as const, name: "timestamp" as const, indexed: false },
              { type: "uint256" as const, name: "denomination" as const, indexed: false },
            ],
          };

          const withdrawEvent = {
            type: "event" as const,
            name: "Withdrawal" as const,
            inputs: [
              { type: "address" as const, name: "to" as const, indexed: false },
              { type: "bytes32" as const, name: "nullifierHash" as const, indexed: false },
              { type: "address" as const, name: "relayer" as const, indexed: true },
              { type: "uint256" as const, name: "fee" as const, indexed: false },
            ],
          };

          let allDepositLogs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
          let allWithdrawLogs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];

          let from = DEPLOY_BLOCK;
          while (from <= latestBlock) {
            const to = from + CHUNK > latestBlock ? latestBlock : from + CHUNK;
            try {
              const [dLogs, wLogs] = await Promise.all([
                publicClient.getLogs({ address: poolAddress, event: depositEvent, fromBlock: from, toBlock: to }),
                publicClient.getLogs({ address: poolAddress, event: withdrawEvent, fromBlock: from, toBlock: to }),
              ]);
              allDepositLogs.push(...dLogs);
              allWithdrawLogs.push(...wLogs);
            } catch { /* skip */ }
            from = to + 1n;
          }

          const depositCount = allDepositLogs.length;
          const anonymitySet = depositCount - allWithdrawLogs.length;

          statEntries.push({
            label: denom.label,
            token: denom.token,
            depositCount,
            anonymitySet: Math.max(anonymitySet, 0),
            maxAnonymity: 100,
          });
        } catch {
          statEntries.push({
            label: denom.label,
            token: denom.token,
            depositCount: 0,
            anonymitySet: 0,
            maxAnonymity: 100,
          });
        }
      }

      setPoolStats(statEntries);
    } catch (err) {
      console.error("Failed to fetch pool stats:", err);
    } finally {
      setIsLoading(false);
    }
  }, [publicClient, contracts]);

  /* ---- Deposit ---- */
  const deposit = useCallback(
    async (note: NoteData) => {
      if (!address || !walletClient) throw new Error("Wallet not connected");

      const poolAddress = contracts[
        note.poolKey as keyof typeof contracts
      ] as Address;

      if (note.token === "BNB") {
        writeContract({
          address: poolAddress,
          abi: PRIVACY_POOL_ABI,
          functionName: "deposit",
          args: [note.commitment as `0x${string}`],
          value: BigInt(note.denomination),
        });
      } else {
        const tokenInfo = DENOMINATIONS.find(
          (d) => d.poolKey === note.poolKey
        );
        if (!tokenInfo) throw new Error("Unknown pool");

        writeContract({
          address: poolAddress,
          abi: TOKEN_POOL_ABI,
          functionName: "deposit",
          args: [note.commitment as `0x${string}`],
        });
      }
    },
    [address, walletClient, contracts, writeContract]
  );

  /* ---- Withdraw via relayer ---- */
  const withdrawViaRelayer = useCallback(
    async (params: WithdrawParams) => {
      const parsed = parseNote(params.noteString);
      if (!parsed) throw new Error("Invalid note format");

      const response = await fetch(`${RELAYER_URL}/api/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proof: params.proof,
          merkleRoot: params.merkleRoot,
          nullifierHash: params.nullifierHash,
          recipient: params.recipientAddress,
          fee: params.fee || "0",
          refund: params.refund || "0",
          aspRoot: params.aspRoot,
          poolAddress: params.poolAddress,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Relayer request failed");
      }

      return response.json();
    },
    []
  );

  /* ---- Withdraw directly ---- */
  const withdrawDirect = useCallback(
    async (
      proof: `0x${string}`,
      root: `0x${string}`,
      nullifierHash: `0x${string}`,
      recipient: Address,
      aspRoot: `0x${string}`,
      poolKey: string
    ) => {
      const poolAddress = contracts[
        poolKey as keyof typeof contracts
      ] as Address;

      writeContract({
        address: poolAddress,
        abi: PRIVACY_POOL_ABI,
        functionName: "withdraw",
        args: [
          proof,
          root,
          nullifierHash,
          recipient,
          "0x0000000000000000000000000000000000000000" as Address,
          0n,
          0n,
          aspRoot,
        ],
      });
    },
    [contracts, writeContract]
  );

  /* ---- Fetch ASP root ---- */
  const getASPRoot = useCallback(async (): Promise<`0x${string}` | null> => {
    if (!publicClient) return null;
    try {
      const root = await publicClient.readContract({
        address: contracts.aspRegistry,
        abi: ASP_REGISTRY_ABI,
        functionName: "getLastASPRoot",
      });
      return root as `0x${string}`;
    } catch {
      return null;
    }
  }, [publicClient, contracts]);

  /* ---- Fetch pool Merkle root ---- */
  const getPoolRoot = useCallback(
    async (poolKey: string): Promise<`0x${string}` | null> => {
      if (!publicClient) return null;
      const poolAddress = contracts[poolKey as keyof typeof contracts] as Address;
      try {
        const root = await publicClient.readContract({
          address: poolAddress,
          abi: [
            {
              inputs: [],
              name: "getLastRoot",
              outputs: [{ name: "", type: "bytes32" }],
              stateMutability: "view",
              type: "function",
            },
          ] as const,
          functionName: "getLastRoot",
        });
        return root as `0x${string}`;
      } catch {
        return null;
      }
    },
    [publicClient, contracts]
  );

  /* ---- Check commitment exists on-chain ---- */
  const checkCommitmentOnChain = useCallback(
    async (commitment: `0x${string}`, poolKey: string): Promise<boolean> => {
      if (!publicClient) return false;
      const poolAddress = contracts[poolKey as keyof typeof contracts] as Address;
      try {
        const exists = await publicClient.readContract({
          address: poolAddress,
          abi: PRIVACY_POOL_ABI,
          functionName: "commitments",
          args: [commitment],
        });
        return exists as boolean;
      } catch {
        return false;
      }
    },
    [publicClient, contracts]
  );

  /* ---- Check nullifier already spent ---- */
  const checkNullifierSpent = useCallback(
    async (nullifierHash: `0x${string}`, poolKey: string): Promise<boolean> => {
      if (!publicClient) return false;
      const poolAddress = contracts[poolKey as keyof typeof contracts] as Address;
      try {
        const spent = await publicClient.readContract({
          address: poolAddress,
          abi: PRIVACY_POOL_ABI,
          functionName: "nullifierHashes",
          args: [nullifierHash],
        });
        return spent as boolean;
      } catch {
        return false;
      }
    },
    [publicClient, contracts]
  );

  return {
    // State
    address,
    isConnected,
    poolStats,
    isLoading,
    txHash,
    isWritePending,
    isTxConfirming,
    isTxConfirmed,
    writeError,

    // Actions
    fetchPoolStats,
    deposit,
    withdrawViaRelayer,
    withdrawDirect,
    getASPRoot,
    getPoolRoot,
    checkCommitmentOnChain,
    checkNullifierSpent,
    generateNote,
    generateNoteAsync,
    parseNote,
  };
}
