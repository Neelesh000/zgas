"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  DENOMINATIONS,
  TOKENS,
  type DenominationOption,
} from "@/lib/constants";
import { usePrivacyPool, type NoteData, generateNoteAsync } from "@/hooks/usePrivacyPool";

export default function DepositForm() {
  const { isConnected } = useAccount();
  const {
    deposit,
    isWritePending,
    isTxConfirming,
    isTxConfirmed,
    txHash,
    writeError,
  } = usePrivacyPool();

  const [selectedToken, setSelectedToken] = useState<string>("BNB");
  const [selectedDenom, setSelectedDenom] = useState<DenominationOption | null>(
    null
  );
  const [note, setNote] = useState<NoteData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [step, setStep] = useState<"select" | "note" | "deposit" | "done">(
    "select"
  );

  const filteredDenoms = DENOMINATIONS.filter((d) => d.token === selectedToken);

  const handleGenerateNote = useCallback(async () => {
    if (!selectedDenom) return;
    setIsGenerating(true);
    try {
      const generated = await generateNoteAsync(selectedDenom);
      setNote(generated);
      setStep("note");
    } catch (err) {
      console.error("Note generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  }, [selectedDenom]);

  const handleDeposit = useCallback(async () => {
    if (!note) return;
    try {
      await deposit(note);
      setStep("done");
    } catch (err) {
      console.error("Deposit failed:", err);
    }
  }, [note, deposit]);

  const handleDownloadNote = useCallback(() => {
    if (!note) return;
    const blob = new Blob([note.noteString], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `privacy-paymaster-note-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setNoteSaved(true);
  }, [note]);

  const handleCopyNote = useCallback(async () => {
    if (!note) return;
    await navigator.clipboard.writeText(note.noteString);
    setNoteSaved(true);
  }, [note]);

  if (!isConnected) {
    return (
      <div className="card flex flex-col items-center gap-6 py-12 text-center">
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
            Connect Your Wallet
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            Connect your wallet to deposit into a privacy pool
          </p>
        </div>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {["Select", "Save Note", "Deposit"].map((label, i) => {
          const stepIndex =
            step === "select" ? 0 : step === "note" ? 1 : step === "deposit" || step === "done" ? 2 : 0;
          const isActive = i === stepIndex;
          const isDone = i < stepIndex;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && (
                <div
                  className={`h-px w-8 ${
                    isDone ? "bg-primary-500" : "bg-surface-400"
                  }`}
                />
              )}
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                  isDone
                    ? "bg-primary-600 text-white"
                    : isActive
                    ? "border-2 border-primary-500 text-primary-400"
                    : "border border-surface-400 text-slate-500"
                }`}
              >
                {isDone ? (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-sm ${
                  isActive ? "font-medium text-white" : "text-slate-500"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Step: Select token and denomination */}
      {step === "select" && (
        <div className="card space-y-6 animate-fade-in">
          {/* Token selector */}
          <div>
            <label className="label">Select Token</label>
            <div className="flex gap-3">
              {TOKENS.map((token) => (
                <button
                  key={token.symbol}
                  onClick={() => {
                    setSelectedToken(token.symbol);
                    setSelectedDenom(null);
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-3 transition-all ${
                    selectedToken === token.symbol
                      ? "border-primary-600 bg-primary-900/30 text-primary-400"
                      : "border-surface-300 bg-surface-200 text-slate-400 hover:border-surface-400"
                  }`}
                >
                  <span
                    className={`h-3 w-3 rounded-full ${
                      token.symbol === "BNB" ? "bg-yellow-400" : "bg-blue-400"
                    }`}
                  />
                  <span className="font-medium">{token.symbol}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Denomination cards */}
          <div>
            <label className="label">Select Denomination</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {filteredDenoms.map((denom) => (
                <button
                  key={denom.value}
                  onClick={() => setSelectedDenom(denom)}
                  className={`card-hover cursor-pointer text-left ${
                    selectedDenom?.value === denom.value
                      ? "!border-primary-600 !bg-primary-900/20"
                      : ""
                  }`}
                >
                  <div className="text-2xl font-bold text-white">
                    {denom.displayAmount}
                  </div>
                  <div className="mt-1 text-sm text-slate-400">
                    {denom.token}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleGenerateNote}
            disabled={!selectedDenom || isGenerating}
            className="btn-primary w-full"
          >
            {isGenerating ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Generating secure note...
              </span>
            ) : (
              "Generate Note"
            )}
          </button>
        </div>
      )}

      {/* Step: Display and save note */}
      {step === "note" && note && (
        <div className="card space-y-6 animate-fade-in">
          <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-4">
            <div className="flex gap-3">
              <svg
                className="h-5 w-5 shrink-0 text-yellow-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
              <div>
                <p className="font-semibold text-yellow-400">
                  Save this note securely!
                </p>
                <p className="mt-1 text-sm text-yellow-200/70">
                  This note is the only way to withdraw your funds. If you lose
                  it, your deposit is unrecoverable. Save it before proceeding.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="label">Your Private Note</label>
            <div className="note-display">{note.noteString}</div>
          </div>

          <div className="flex gap-3">
            <button onClick={handleCopyNote} className="btn-secondary flex-1">
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
                />
              </svg>
              Copy
            </button>
            <button
              onClick={handleDownloadNote}
              className="btn-secondary flex-1"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
              Download
            </button>
          </div>

          <button
            onClick={() => setStep("deposit")}
            disabled={!noteSaved}
            className="btn-primary w-full"
          >
            {noteSaved
              ? "Proceed to Deposit"
              : "Save your note first to continue"}
          </button>
        </div>
      )}

      {/* Step: Confirm deposit */}
      {(step === "deposit" || step === "done") && note && (
        <div className="card space-y-6 animate-fade-in">
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
              <span className="text-sm text-slate-400">Amount</span>
              <span className="font-semibold text-white">
                {DENOMINATIONS.find((d) => d.poolKey === note.poolKey)?.label}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
              <span className="text-sm text-slate-400">Commitment</span>
              <span className="max-w-[200px] truncate font-mono text-xs text-slate-300">
                {note.commitment}
              </span>
            </div>
          </div>

          {step === "done" && isTxConfirmed ? (
            <div className="rounded-lg border border-primary-800/50 bg-primary-900/20 p-4 text-center">
              <svg
                className="mx-auto h-12 w-12 text-primary-400"
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
              <p className="mt-3 font-semibold text-primary-400">
                Deposit Successful!
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Your funds are now in the privacy pool
              </p>
              {txHash && (
                <a
                  href={`https://testnet.bscscan.com/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-sm text-primary-400 hover:underline"
                >
                  View on BscScan
                </a>
              )}
            </div>
          ) : (
            <>
              {writeError && (
                <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-3">
                  <p className="text-sm text-red-400">
                    {writeError.message?.slice(0, 200)}
                  </p>
                </div>
              )}
              <button
                onClick={handleDeposit}
                disabled={isWritePending || isTxConfirming}
                className="btn-primary w-full"
              >
                {isWritePending
                  ? "Confirm in wallet..."
                  : isTxConfirming
                  ? "Waiting for confirmation..."
                  : `Deposit ${
                      DENOMINATIONS.find((d) => d.poolKey === note.poolKey)
                        ?.label
                    }`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
