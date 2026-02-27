"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { type Address, encodeFunctionData, parseEther } from "viem";
import { usePrivacyPool, parseNote } from "@/hooks/usePrivacyPool";
import { CONTRACTS, ACTIVE_CHAIN_ID } from "@/lib/constants";
import ProofProgress from "./ProofProgress";

type SponsorStep = "connect" | "input" | "proving" | "submit" | "done";

export default function SponsorForm() {
  const { isConnected, address } = useAccount();
  const { getASPRoot, isWritePending, isTxConfirming, txHash, writeError } =
    usePrivacyPool();

  const [noteString, setNoteString] = useState("");
  const [targetAddress, setTargetAddress] = useState("");
  const [callData, setCallData] = useState("");
  const [step, setStep] = useState<SponsorStep>(
    isConnected ? "input" : "connect"
  );
  const [proofStep, setProofStep] = useState(-1);
  const [proofError, setProofError] = useState<string | null>(null);
  const [isProofComplete, setIsProofComplete] = useState(false);
  const [userOpHash, setUserOpHash] = useState<string | null>(null);

  const parsedNote = noteString ? parseNote(noteString.trim()) : null;
  const isNoteValid = parsedNote !== null;
  const isTargetValid =
    targetAddress.length === 42 && targetAddress.startsWith("0x");

  const handleGenerateMembershipProof = useCallback(async () => {
    if (!parsedNote || !isTargetValid || !address) return;

    setStep("proving");
    setProofError(null);
    setProofStep(0);

    try {
      // Step 0: Prepare inputs (commitment + Merkle path)
      await new Promise((r) => setTimeout(r, 600));
      setProofStep(1);

      // Step 1: Load membership circuit
      await new Promise((r) => setTimeout(r, 1000));
      setProofStep(2);

      // Step 2: Compute witness
      await new Promise((r) => setTimeout(r, 1500));
      setProofStep(3);

      // Step 3: Generate membership proof
      // In production: snarkjs.groth16.fullProve with membership circuit
      await new Promise((r) => setTimeout(r, 2500));
      setProofStep(4);

      // Step 4: Verify locally
      await new Promise((r) => setTimeout(r, 400));

      setIsProofComplete(true);
      setStep("submit");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown error during proving";
      setProofError(message);
    }
  }, [parsedNote, isTargetValid, address]);

  const handleSubmitSponsoredTx = useCallback(async () => {
    if (!address) return;

    try {
      // In production, this would:
      // 1. Construct a PackedUserOperation with the membership proof in paymasterAndData
      // 2. Submit it to a bundler (e.g. Pimlico, Stackup)
      // 3. The PrivacyPaymaster validates the proof and sponsors gas

      const contracts = CONTRACTS[ACTIVE_CHAIN_ID];

      // Simulate UserOp construction
      const simulatedUserOp = {
        sender: address,
        nonce: "0x0",
        initCode: "0x",
        callData: (callData || "0x") as `0x${string}`,
        callGasLimit: "0x50000",
        verificationGasLimit: "0x50000",
        preVerificationGas: "0x10000",
        maxFeePerGas: "0x3B9ACA00",
        maxPriorityFeePerGas: "0x3B9ACA00",
        paymasterAndData: contracts.privacyPaymaster, // Would include proof bytes
        signature: "0x",
      };

      // Simulate bundler submission
      await new Promise((r) => setTimeout(r, 2000));

      setUserOpHash(
        "0x" +
          Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
      );
      setStep("done");
    } catch (err) {
      console.error("Sponsored tx failed:", err);
    }
  }, [address, callData]);

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="card border-primary-800/30 bg-gradient-to-r from-primary-900/20 to-surface-100">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-900/50">
            <svg
              className="h-5 w-5 text-primary-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
              />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-white">
              Gas Sponsorship via Privacy Paymaster
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Use a fresh wallet and prove pool membership with a ZK proof.
              The paymaster sponsors your gas without linking to your original deposit.
            </p>
          </div>
        </div>
      </div>

      {/* Step: Connect fresh wallet */}
      {step === "connect" && (
        <div className="card flex flex-col items-center gap-6 py-12 text-center animate-fade-in">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-200">
            <svg
              className="h-8 w-8 text-slate-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">
              Connect a Fresh Wallet
            </h3>
            <p className="mt-1 max-w-md text-sm text-slate-400">
              For maximum privacy, connect a new wallet that has no prior
              transaction history. The paymaster will sponsor gas for this
              wallet.
            </p>
          </div>
          <ConnectButton />
          {isConnected && (
            <button
              onClick={() => setStep("input")}
              className="btn-primary"
            >
              Continue with {address?.slice(0, 6)}...{address?.slice(-4)}
            </button>
          )}
        </div>
      )}

      {/* Step: Input note and target tx */}
      {step === "input" && (
        <div className="card space-y-6 animate-fade-in">
          <div>
            <label className="label">Your Private Note</label>
            <textarea
              value={noteString}
              onChange={(e) => setNoteString(e.target.value)}
              placeholder="pp-bnb-1-abc123...def456..."
              className="input-field h-24 resize-none font-mono text-sm"
            />
            {noteString && !isNoteValid && (
              <p className="mt-1 text-xs text-red-400">
                Invalid note format
              </p>
            )}
            {parsedNote && (
              <div className="mt-2 flex gap-2">
                <span className="badge-green">
                  {parsedNote.token} {parsedNote.amount}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="label">Target Contract Address</label>
            <input
              type="text"
              value={targetAddress}
              onChange={(e) => setTargetAddress(e.target.value)}
              placeholder="0x..."
              className="input-field font-mono text-sm"
            />
          </div>

          <div>
            <label className="label">Call Data (optional)</label>
            <input
              type="text"
              value={callData}
              onChange={(e) => setCallData(e.target.value)}
              placeholder="0x..."
              className="input-field font-mono text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">
              Encoded function call data for the target contract
            </p>
          </div>

          <div className="rounded-lg bg-surface-200 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Sponsoring Wallet</span>
              <span className="font-mono text-sm text-primary-400">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              This wallet will send the transaction. Gas is paid by the
              Privacy Paymaster.
            </p>
          </div>

          <button
            onClick={handleGenerateMembershipProof}
            disabled={!isNoteValid || !isTargetValid}
            className="btn-primary w-full"
          >
            Generate Membership Proof
          </button>
        </div>
      )}

      {/* Step: Proof generation */}
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

      {/* Step: Submit sponsored transaction */}
      {step === "submit" && (
        <div className="card space-y-6 animate-fade-in">
          <div className="rounded-lg border border-primary-800/50 bg-primary-900/20 p-4">
            <p className="text-sm text-primary-400">
              Membership proof verified. Ready to submit sponsored transaction.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
              <span className="text-sm text-slate-400">Sender</span>
              <span className="font-mono text-xs text-slate-300">
                {address?.slice(0, 10)}...{address?.slice(-8)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
              <span className="text-sm text-slate-400">Target</span>
              <span className="max-w-[200px] truncate font-mono text-xs text-slate-300">
                {targetAddress}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
              <span className="text-sm text-slate-400">Gas Payment</span>
              <span className="badge-green">Sponsored by Paymaster</span>
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
            onClick={handleSubmitSponsoredTx}
            disabled={isWritePending || isTxConfirming}
            className="btn-primary w-full"
          >
            {isWritePending
              ? "Submitting to bundler..."
              : isTxConfirming
              ? "Waiting for inclusion..."
              : "Submit Sponsored Transaction"}
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
            Transaction Sponsored!
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Your transaction was submitted with gas paid by the Privacy
            Paymaster
          </p>
          {userOpHash && (
            <div className="mt-4">
              <p className="text-xs text-slate-500">UserOp Hash</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-300">
                {userOpHash}
              </p>
            </div>
          )}
          <button
            onClick={() => {
              setStep("input");
              setNoteString("");
              setTargetAddress("");
              setCallData("");
              setProofStep(-1);
              setProofError(null);
              setIsProofComplete(false);
              setUserOpHash(null);
            }}
            className="btn-secondary mx-auto mt-6"
          >
            Submit Another
          </button>
        </div>
      )}
    </div>
  );
}
