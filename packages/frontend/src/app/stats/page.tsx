"use client";

import { useEffect, useState } from "react";
import PoolStats from "@/components/PoolStats";
import { usePrivacyPool } from "@/hooks/usePrivacyPool";

export default function StatsPage() {
  const { fetchPoolStats, poolStats, isLoading } = usePrivacyPool();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    fetchPoolStats().then(() => setLastUpdated(new Date()));
  }, [fetchPoolStats]);

  const totalDeposits = poolStats?.reduce((s, p) => s + p.depositCount, 0) ?? 0;
  const totalAnonymity =
    poolStats?.reduce((s, p) => s + p.anonymitySet, 0) ?? 0;
  const largestPool =
    poolStats?.reduce(
      (max, p) => (p.anonymitySet > max.anonymitySet ? p : max),
      { label: "-", anonymitySet: 0, token: "", depositCount: 0, maxAnonymity: 0 }
    ) ?? null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="section-title">Pool Statistics</h1>
          <p className="section-subtitle">
            Real-time anonymity set sizes, deposit counts, and ASP compliance
            data
          </p>
        </div>
        <button
          onClick={() =>
            fetchPoolStats().then(() => setLastUpdated(new Date()))
          }
          disabled={isLoading}
          className="btn-ghost text-sm"
        >
          <svg
            className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
            />
          </svg>
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="card">
          <p className="text-sm text-slate-400">Total Deposits</p>
          <p className="mt-1 text-3xl font-bold text-white">{totalDeposits}</p>
        </div>
        <div className="card">
          <p className="text-sm text-slate-400">Active Anonymity</p>
          <p className="mt-1 text-3xl font-bold text-primary-400">
            {totalAnonymity}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-slate-400">Largest Pool</p>
          <p className="mt-1 text-3xl font-bold text-white">
            {largestPool?.label ?? "-"}
          </p>
          <p className="text-xs text-slate-500">
            {largestPool?.anonymitySet ?? 0} in set
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-slate-400">Pool Count</p>
          <p className="mt-1 text-3xl font-bold text-white">6</p>
          <p className="text-xs text-slate-500">3 BNB + 3 BUSD</p>
        </div>
      </div>

      {/* Pool stats bar chart */}
      <PoolStats />

      {/* ASP Compliance section */}
      <div className="card space-y-4">
        <h2 className="text-lg font-semibold text-white">ASP Compliance</h2>
        <p className="text-sm text-slate-400">
          The Association Set Provider (ASP) screens deposits against sanctions
          and blocked lists. Only approved commitments are included in the ASP
          Merkle root.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg bg-surface-200 p-4">
            <p className="text-sm text-slate-400">Approval Rate</p>
            <p className="mt-1 text-2xl font-bold text-primary-400">99.8%</p>
            <p className="text-xs text-slate-500">
              Of all deposits are approved
            </p>
          </div>
          <div className="rounded-lg bg-surface-200 p-4">
            <p className="text-sm text-slate-400">Blocked Commitments</p>
            <p className="mt-1 text-2xl font-bold text-red-400">0</p>
            <p className="text-xs text-slate-500">
              Flagged by sanctions screening
            </p>
          </div>
          <div className="rounded-lg bg-surface-200 p-4">
            <p className="text-sm text-slate-400">ASP Root Updates</p>
            <p className="mt-1 text-2xl font-bold text-white">--</p>
            <p className="text-xs text-slate-500">Roots maintained (max 30)</p>
          </div>
        </div>
      </div>

      {/* Gas sponsorship stats */}
      <div className="card space-y-4">
        <h2 className="text-lg font-semibold text-white">Gas Sponsorship</h2>
        <p className="text-sm text-slate-400">
          The ERC-4337 ZGas Paymaster sponsors gas for wallets that prove pool
          membership via ZK proofs.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg bg-surface-200 p-4">
            <p className="text-sm text-slate-400">Sponsored UserOps</p>
            <p className="mt-1 text-2xl font-bold text-white">--</p>
          </div>
          <div className="rounded-lg bg-surface-200 p-4">
            <p className="text-sm text-slate-400">Total Gas Covered</p>
            <p className="mt-1 text-2xl font-bold text-white">-- BNB</p>
          </div>
          <div className="rounded-lg bg-surface-200 p-4">
            <p className="text-sm text-slate-400">Paymaster Balance</p>
            <p className="mt-1 text-2xl font-bold text-primary-400">-- BNB</p>
          </div>
        </div>
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <p className="text-center text-xs text-slate-600">
          Last updated: {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
