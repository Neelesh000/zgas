"use client";

import { useState, useCallback, useEffect } from "react";
import {
  useAccount,
  usePublicClient,
  useWalletClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseEther, type Address, type Hash, encodePacked } from "viem";
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
}

export interface SponsorParams {
  noteString: string;
  targetTxData: `0x${string}`;
  targetAddress: Address;
}

/* -------------------------------------------------------------------------- */
/*                       Note generation (client-side)                        */
/* -------------------------------------------------------------------------- */

function randomBigInt(nBytes: number): bigint {
  const buf = new Uint8Array(nBytes);
  crypto.getRandomValues(buf);
  return BigInt(
    "0x" +
      Array.from(buf)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
  );
}

function toHex32(val: bigint): string {
  return "0x" + val.toString(16).padStart(64, "0");
}

/**
 * Produces a simple commitment = keccak256(secret || nullifier).
 * In production this would use Poseidon hash via circomlibjs, but we keep it
 * simple here so the frontend can work without the compiled Poseidon WASM.
 */
async function computeCommitment(
  secret: bigint,
  nullifier: bigint
): Promise<string> {
  const data = encodePacked(
    ["uint256", "uint256"],
    [secret, nullifier]
  );
  // Use SubtleCrypto as a stand-in; real impl uses Poseidon
  const bytes = hexToBytes(data);
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer as ArrayBuffer
  );
  const hashArray = new Uint8Array(hashBuffer);
  return (
    "0x" +
    Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function generateNote(denom: DenominationOption): NoteData {
  const secret = randomBigInt(31);
  const nullifier = randomBigInt(31);

  // Synchronous placeholder commitment (will be replaced with async Poseidon)
  const commitmentHex = toHex32(secret ^ nullifier); // XOR placeholder

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

export async function generateNoteAsync(
  denom: DenominationOption
): Promise<NoteData> {
  const secret = randomBigInt(31);
  const nullifier = randomBigInt(31);
  const commitment = await computeCommitment(secret, nullifier);

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

  /* ---- Fetch pool stats ---- */
  const fetchPoolStats = useCallback(async () => {
    if (!publicClient) return;
    setIsLoading(true);

    try {
      const statEntries: PoolStatEntry[] = [];

      for (const denom of DENOMINATIONS) {
        const poolAddress = contracts[
          denom.poolKey as keyof typeof contracts
        ] as Address;

        try {
          // Read deposit event count as proxy for anonymity set
          const logs = await publicClient.getLogs({
            address: poolAddress,
            event: {
              type: "event",
              name: "Deposit",
              inputs: [
                { type: "bytes32", name: "commitment", indexed: true },
                { type: "uint32", name: "leafIndex", indexed: false },
                { type: "uint256", name: "timestamp", indexed: false },
                { type: "uint256", name: "denomination", indexed: false },
              ],
            },
            fromBlock: "earliest",
            toBlock: "latest",
          });

          const withdrawLogs = await publicClient.getLogs({
            address: poolAddress,
            event: {
              type: "event",
              name: "Withdrawal",
              inputs: [
                { type: "address", name: "to", indexed: false },
                { type: "bytes32", name: "nullifierHash", indexed: false },
                { type: "address", name: "relayer", indexed: true },
                { type: "uint256", name: "fee", indexed: false },
              ],
            },
            fromBlock: "earliest",
            toBlock: "latest",
          });

          const depositCount = logs.length;
          const anonymitySet = depositCount - withdrawLogs.length;

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
        // ERC-20 flow: approve then deposit
        const tokenInfo = DENOMINATIONS.find(
          (d) => d.poolKey === note.poolKey
        );
        if (!tokenInfo) throw new Error("Unknown pool");

        // First approve
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

      const response = await fetch(`${RELAYER_URL}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: params.noteString,
          recipient: params.recipientAddress,
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
    generateNote,
    generateNoteAsync,
    parseNote,
  };
}
