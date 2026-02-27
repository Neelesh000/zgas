"use client";

import DepositForm from "@/components/DepositForm";

export default function DepositPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="section-title">Deposit</h1>
        <p className="section-subtitle">
          Deposit BNB or tokens into a fixed-denomination privacy pool. A
          cryptographic note will be generated client-side for later withdrawal.
        </p>
      </div>

      {/* Security info */}
      <div className="flex gap-3 rounded-lg border border-surface-300 bg-surface-100 p-4">
        <svg
          className="h-5 w-5 shrink-0 text-primary-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
        <div>
          <p className="text-sm font-medium text-slate-300">
            Client-Side Note Generation
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Your secret note is generated entirely in your browser using
            crypto.getRandomValues(). It never leaves your device. The contract
            only receives a hashed commitment.
          </p>
        </div>
      </div>

      {/* Deposit form */}
      <DepositForm />
    </div>
  );
}
