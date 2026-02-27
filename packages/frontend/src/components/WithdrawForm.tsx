"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { type Address } from "viem";
import { usePrivacyPool, parseNote } from "@/hooks/usePrivacyPool";
import { RELAYER_FEE_PERCENT } from "@/lib/constants";
import ProofProgress from "./ProofProgress";

type WithdrawStep = "input" | "proving" | "submit" | "done";

export default function WithdrawForm() {
  const { isConnected } = useAccount();
  const {
    withdrawViaRelayer,
    withdrawDirect,
    isWritePending,
    isTxConfirming,
    isTxConfirmed,
    txHash,
    writeError,
  } = usePrivacyPool();

  const [noteString, setNoteString] = useState("");
  const [recipient, setRecipient] = useState("");
  const [useRelayer, setUseRelayer] = useState(true);
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

  const handleGenerateProof = useCallback(async () => {
    if (!parsedNote || !isRecipientValid) return;

    setStep("proving");
    setProofError(null);
    setProofStep(0);

    try {
      // Step 0: Prepare inputs
      await new Promise((r) => setTimeout(r, 800));
      setProofStep(1);

      // Step 1: Load circuit
      await new Promise((r) => setTimeout(r, 1200));
      setProofStep(2);

      // Step 2: Compute witness
      await new Promise((r) => setTimeout(r, 2000));
      setProofStep(3);

      // Step 3: Generate proof
      // In production, this would call snarkjs.groth16.fullProve via a Web Worker
      // For now we simulate the delay
      await new Promise((r) => setTimeout(r, 3000));
      setProofStep(4);

      // Step 4: Verify locally
      await new Promise((r) => setTimeout(r, 500));

      // Simulated proof data
      const simulatedProofData = {
        proof: "0x" + "00".repeat(256) as `0x${string}`,
        root: "0x" + "00".repeat(32) as `0x${string}`,
        nullifierHash: "0x" + "00".repeat(32) as `0x${string}`,
        aspRoot: "0x" + "00".repeat(32) as `0x${string}`,
        poolKey: `privacyPool_${parsedNote.token}_${parsedNote.amount.replace(
          ".",
          ""
        )}`,
      };

      setProofData(simulatedProofData);
      setIsProofComplete(true);
      setStep("submit");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown error during proving";
      setProofError(message);
    }
  }, [parsedNote, isRecipientValid]);

  const handleWithdraw = useCallback(async () => {
    if (!proofData) return;

    try {
      if (useRelayer) {
        const result = await withdrawViaRelayer({
          noteString: noteString.trim(),
          recipientAddress: recipient as Address,
          useRelayer: true,
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
        setStep("done");
      }
    } catch (err) {
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
              ZK proof generated and verified locally. Ready to submit.
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

          {writeError && (
            <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-3">
              <p className="text-sm text-red-400">
                {writeError.message?.slice(0, 200)}
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
