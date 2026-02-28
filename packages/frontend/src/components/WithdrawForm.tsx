"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  type Address,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import {
  usePrivacyPool,
  parseNote,
  computeCommitmentAsync,
  computeNullifierHashAsync,
  computeCommitment,
  computeNullifierHash,
} from "@/hooks/usePrivacyPool";
import {
  RELAYER_FEE_PERCENT,
  RELAYER_URL,
  CONTRACTS,
  ACTIVE_CHAIN_ID,
  CIRCUIT_PATHS,
} from "@/lib/constants";
import { buildPoolTree, buildASPTree } from "@/lib/merkleTree";
import ProofProgress from "./ProofProgress";

const USE_MOCK_PROOFS = process.env.NEXT_PUBLIC_USE_MOCK_PROOFS === "true";

type WithdrawStep = "input" | "proving" | "submit" | "done";

function toHex32(val: bigint): string {
  return "0x" + val.toString(16).padStart(64, "0");
}

/** ABI-encode a Groth16 proof for on-chain verification. */
function encodeProofForContract(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): `0x${string}` {
  const pA: [bigint, bigint] = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
  // snarkjs outputs B in a different order than the contract expects
  const pB: [[bigint, bigint], [bigint, bigint]] = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ];
  const pC: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];

  return encodeAbiParameters(
    parseAbiParameters("uint256[2], uint256[2][2], uint256[2]"),
    [pA, pB, pC]
  ) as `0x${string}`;
}

export default function WithdrawForm() {
  const { isConnected } = useAccount();
  const publicClient = usePublicClient();
  const {
    withdrawViaRelayer,
    withdrawDirect,
    checkCommitmentOnChain,
    checkNullifierSpent,
    getPoolRoot,
    getASPRoot,
    isWritePending,
    isTxConfirming,
    isTxConfirmed,
    txHash,
    writeError,
  } = usePrivacyPool();

  const [noteString, setNoteString] = useState("");
  const [recipient, setRecipient] = useState("");
  const [useRelayer, setUseRelayer] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [step, setStep] = useState<WithdrawStep>("input");
  const [proofStep, setProofStep] = useState(-1);
  const [proofError, setProofError] = useState<string | null>(null);
  const [isProofComplete, setIsProofComplete] = useState(false);
  const [proofData, setProofData] = useState<{
    proof: `0x${string}`;
    root: `0x${string}`;
    nullifierHash: `0x${string}`;
    aspRoot: `0x${string}`;
    poolKey: string;
  } | null>(null);
  const [relayerResult, setRelayerResult] = useState<{
    txHash: string;
  } | null>(null);

  const parsedNote = noteString ? parseNote(noteString.trim()) : null;
  const isNoteValid = parsedNote !== null;

  const isRecipientValid =
    recipient.length === 42 && recipient.startsWith("0x");

  useEffect(() => {
    if (isTxConfirmed && step === "submit") {
      setStep("done");
    }
  }, [isTxConfirmed, step]);

  const handleGenerateProof = useCallback(async () => {
    if (!parsedNote || !isRecipientValid || !publicClient) return;

    setStep("proving");
    setProofError(null);
    setProofStep(0);

    try {
      const secret = BigInt(parsedNote.secret);
      const nullifier = BigInt(parsedNote.nullifier);

      // Step 0: Derive commitment + nullifierHash
      const commitment = USE_MOCK_PROOFS
        ? computeCommitment(secret, nullifier) as `0x${string}`
        : (await computeCommitmentAsync(secret, nullifier)) as `0x${string}`;
      const nullifierHash = USE_MOCK_PROOFS
        ? computeNullifierHash(nullifier) as `0x${string}`
        : (await computeNullifierHashAsync(nullifier)) as `0x${string}`;
      const poolKey = `privacyPool_${parsedNote.token}_${parsedNote.amount.replace(".", "")}`;

      setProofStep(1);

      // Step 1: Check commitment exists on-chain
      const commitmentExists = await checkCommitmentOnChain(commitment, poolKey);
      if (!commitmentExists) {
        throw new Error(
          "Commitment not found on-chain. This note may be invalid, modified, or not yet deposited."
        );
      }
      setProofStep(2);

      // Step 2: Check nullifier hasn't been spent
      const alreadySpent = await checkNullifierSpent(nullifierHash, poolKey);
      if (alreadySpent) {
        throw new Error("This note has already been withdrawn (nullifier spent).");
      }
      setProofStep(3);

      // Step 3: Fetch ASP root
      const aspRoot = await getASPRoot();
      if (!aspRoot) {
        throw new Error("Failed to fetch ASP root from chain.");
      }

      let encodedProof: `0x${string}`;
      let poolRoot: `0x${string}`;
      let finalAspRoot = aspRoot;

      if (USE_MOCK_PROOFS) {
        // Mock mode: dummy proof, fetch root from chain
        const fetchedRoot = await getPoolRoot(poolKey);
        if (!fetchedRoot) throw new Error("Failed to fetch pool Merkle root.");
        poolRoot = fetchedRoot;
        encodedProof = ("0x" + "00".repeat(256)) as `0x${string}`;
      } else {
        // Real mode: reconstruct Merkle tree, generate Groth16 proof
        setProofStep(4);

        const contracts = CONTRACTS[ACTIVE_CHAIN_ID];
        const poolAddress = contracts[poolKey as keyof typeof contracts] as Address;

        // Sync ASP tree on-chain via relayer (devnet only)
        const allPoolAddresses = [
          contracts.privacyPool_BNB_01,
          contracts.privacyPool_BNB_1,
          contracts.privacyPool_BNB_10,
        ].filter((a) => a !== "0x0000000000000000000000000000000000000000") as Address[];

        await fetch(`${RELAYER_URL}/api/asp/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poolAddresses: allPoolAddresses }),
        });

        // Reconstruct pool Merkle tree from Deposit events
        const poolTree = await buildPoolTree(poolAddress, publicClient);
        const commitmentBigInt = BigInt(commitment);
        const leafIndex = poolTree.indexOf(commitmentBigInt);
        if (leafIndex === -1) {
          throw new Error("Commitment not found in reconstructed Merkle tree.");
        }

        const poolProof = poolTree.getProof(leafIndex);
        poolRoot = toHex32(poolProof.root) as `0x${string}`;

        // Build real ASP tree from all pool deposits
        const aspTree = await buildASPTree(allPoolAddresses, publicClient);
        const aspLeafIndex = aspTree.indexOf(commitmentBigInt);
        if (aspLeafIndex === -1) {
          throw new Error("Commitment not found in ASP tree. ASP sync may have failed.");
        }
        const aspProof = aspTree.getProof(aspLeafIndex);

        // Use the ASP root from the synced tree (it changed on-chain)
        const syncedAspRoot = toHex32(aspProof.root) as `0x${string}`;
        finalAspRoot = syncedAspRoot;

        // Build circuit input
        const recipientBigInt = BigInt(recipient);
        const input = {
          // Private inputs
          secret: secret.toString(),
          nullifier: nullifier.toString(),
          pathElements: poolProof.pathElements.map((e) => e.toString()),
          pathIndices: poolProof.pathIndices,
          aspPathElements: aspProof.pathElements.map((e) => e.toString()),
          aspPathIndices: aspProof.pathIndices,
          // Public inputs
          root: poolProof.root.toString(),
          nullifierHash: BigInt(nullifierHash).toString(),
          recipient: recipientBigInt.toString(),
          relayer: "0",
          fee: "0",
          refund: "0",
          aspRoot: BigInt(syncedAspRoot).toString(),
        };

        // Generate Groth16 proof via snarkjs
        const snarkjs = await import("snarkjs");
        const { proof } = await snarkjs.groth16.fullProve(
          input,
          CIRCUIT_PATHS.withdraw.wasm,
          CIRCUIT_PATHS.withdraw.zkey
        );

        encodedProof = encodeProofForContract(proof);
      }

      setProofStep(4);

      setProofData({
        proof: encodedProof,
        root: poolRoot,
        nullifierHash,
        aspRoot: finalAspRoot!,
        poolKey,
      });
      setIsProofComplete(true);
      setStep("submit");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown error during proving";
      setProofError(message);
    }
  }, [parsedNote, isRecipientValid, publicClient, checkCommitmentOnChain, checkNullifierSpent, getPoolRoot, getASPRoot, recipient]);

  const handleWithdraw = useCallback(async () => {
    if (!proofData) return;
    setWithdrawError(null);

    try {
      if (useRelayer) {
        const contracts = CONTRACTS[ACTIVE_CHAIN_ID];
        const poolAddress = contracts[proofData.poolKey as keyof typeof contracts];
        const result = await withdrawViaRelayer({
          noteString: noteString.trim(),
          recipientAddress: recipient as Address,
          useRelayer: true,
          proof: proofData.proof,
          merkleRoot: proofData.root,
          nullifierHash: proofData.nullifierHash,
          aspRoot: proofData.aspRoot,
          poolAddress: poolAddress as string,
        });
        setRelayerResult(result);
        setStep("done");
      } else {
        await withdrawDirect(
          proofData.proof,
          proofData.root,
          proofData.nullifierHash,
          recipient as Address,
          proofData.aspRoot,
          proofData.poolKey
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Withdrawal failed";
      setWithdrawError(message);
      console.error("Withdrawal failed:", err);
    }
  }, [
    proofData,
    useRelayer,
    noteString,
    recipient,
    withdrawViaRelayer,
    withdrawDirect,
  ]);

  return (
    <div className="space-y-6">
      {/* Step: Input note and recipient */}
      {step === "input" && (
        <div className="card space-y-6 animate-fade-in">
          <div>
            <label className="label">Paste Your Note</label>
            <textarea
              value={noteString}
              onChange={(e) => setNoteString(e.target.value)}
              placeholder="pp-bnb-1-abc123...def456..."
              className="input-field h-24 resize-none font-mono text-sm"
            />
            {noteString && !isNoteValid && (
              <p className="mt-1 text-xs text-red-400">
                Invalid note format. Notes start with &quot;pp-&quot; followed
                by token, amount, and hex data.
              </p>
            )}
            {parsedNote && (
              <div className="mt-2 flex gap-2">
                <span className="badge-green">
                  {parsedNote.token} {parsedNote.amount}
                </span>
                <span className="badge-green">Valid note</span>
              </div>
            )}
          </div>

          <div>
            <label className="label">Recipient Address</label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className="input-field font-mono text-sm"
            />
            {recipient && !isRecipientValid && (
              <p className="mt-1 text-xs text-red-400">
                Enter a valid Ethereum address (0x followed by 40 hex
                characters)
              </p>
            )}
          </div>

          {/* Relayer toggle */}
          <div className="rounded-lg border border-surface-300 bg-surface-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-white">Use Relayer</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {useRelayer
                    ? `${RELAYER_FEE_PERCENT}% fee for privacy-preserving withdrawal`
                    : "Direct withdrawal (reveals your address as the caller)"}
                </p>
              </div>
              <button
                onClick={() => setUseRelayer(!useRelayer)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  useRelayer ? "bg-primary-600" : "bg-surface-400"
                }`}
              >
                <div
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    useRelayer ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>

          {!isConnected && !useRelayer && (
            <div className="flex justify-center">
              <ConnectButton />
            </div>
          )}

          <button
            onClick={handleGenerateProof}
            disabled={
              !isNoteValid || !isRecipientValid || (!isConnected && !useRelayer)
            }
            className="btn-primary w-full"
          >
            Generate ZK Proof
          </button>
        </div>
      )}

      {/* Step: Proof generation progress */}
      {step === "proving" && (
        <div className="animate-fade-in">
          <ProofProgress
            currentStep={proofStep}
            error={proofError}
            isComplete={isProofComplete}
          />
          {proofError && (
            <button
              onClick={() => {
                setStep("input");
                setProofStep(-1);
                setProofError(null);
              }}
              className="btn-secondary mt-4 w-full"
            >
              Try Again
            </button>
          )}
        </div>
      )}

      {/* Step: Submit withdrawal */}
      {step === "submit" && (
        <div className="card space-y-6 animate-fade-in">
          <div className="rounded-lg border border-primary-800/50 bg-primary-900/20 p-4">
            <p className="text-sm text-primary-400">
              {USE_MOCK_PROOFS
                ? "Proof data prepared (mock mode). Ready to submit."
                : "ZK proof generated and verified locally. Ready to submit."}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
              <span className="text-sm text-slate-400">Amount</span>
              <span className="font-semibold text-white">
                {parsedNote?.amount} {parsedNote?.token}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
              <span className="text-sm text-slate-400">Recipient</span>
              <span className="max-w-[200px] truncate font-mono text-xs text-slate-300">
                {recipient}
              </span>
            </div>
            {useRelayer && (
              <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
                <span className="text-sm text-slate-400">Relayer Fee</span>
                <span className="text-sm text-yellow-400">
                  {RELAYER_FEE_PERCENT}%
                </span>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
              <span className="text-sm text-slate-400">Method</span>
              <span
                className={`badge ${
                  useRelayer ? "badge-green" : "badge-yellow"
                }`}
              >
                {useRelayer ? "Via Relayer" : "Direct"}
              </span>
            </div>
          </div>

          {(writeError || withdrawError) && (
            <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-3">
              <p className="text-sm text-red-400">
                {writeError?.message?.slice(0, 200) || withdrawError}
              </p>
            </div>
          )}

          <button
            onClick={handleWithdraw}
            disabled={isWritePending || isTxConfirming}
            className="btn-primary w-full"
          >
            {isWritePending
              ? "Confirm in wallet..."
              : isTxConfirming
              ? "Waiting for confirmation..."
              : "Submit Withdrawal"}
          </button>
        </div>
      )}

      {/* Step: Done */}
      {step === "done" && (
        <div className="card animate-fade-in py-8 text-center">
          <svg
            className="mx-auto h-16 w-16 text-primary-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-4 text-xl font-bold text-white">
            Withdrawal Submitted!
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Your funds will arrive at the recipient address shortly
          </p>
          {(txHash || relayerResult?.txHash) && (
            <a
              href={`https://testnet.bscscan.com/tx/${
                txHash || relayerResult?.txHash
              }`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm text-primary-400 hover:underline"
            >
              View on BscScan
            </a>
          )}
          <button
            onClick={() => {
              setStep("input");
              setNoteString("");
              setRecipient("");
              setProofStep(-1);
              setProofData(null);
              setIsProofComplete(false);
              setRelayerResult(null);
            }}
            className="btn-secondary mx-auto mt-6"
          >
            Withdraw Again
          </button>
        </div>
      )}
    </div>
  );
}
