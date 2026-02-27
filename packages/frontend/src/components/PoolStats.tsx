"use client";

import { usePrivacyPool } from "@/hooks/usePrivacyPool";

interface PoolStatEntry {
  label: string;
  token: string;
  depositCount: number;
  anonymitySet: number;
  maxAnonymity: number;
}

export default function PoolStats() {
  const { poolStats, isLoading } = usePrivacyPool();

  const stats: PoolStatEntry[] = poolStats ?? [
    {
      label: "0.1 BNB",
      token: "BNB",
      depositCount: 0,
      anonymitySet: 0,
      maxAnonymity: 100,
    },
    {
      label: "1 BNB",
      token: "BNB",
      depositCount: 0,
      anonymitySet: 0,
      maxAnonymity: 100,
    },
    {
      label: "10 BNB",
      token: "BNB",
      depositCount: 0,
      anonymitySet: 0,
      maxAnonymity: 100,
    },
    {
      label: "100 BUSD",
      token: "BUSD",
      depositCount: 0,
      anonymitySet: 0,
      maxAnonymity: 100,
    },
    {
      label: "1K BUSD",
      token: "BUSD",
      depositCount: 0,
      anonymitySet: 0,
      maxAnonymity: 100,
    },
    {
      label: "10K BUSD",
      token: "BUSD",
      depositCount: 0,
      anonymitySet: 0,
      maxAnonymity: 100,
    },
  ];

  const maxAnonymity = Math.max(...stats.map((s) => s.anonymitySet), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="section-title">Anonymity Sets</h2>
          <p className="section-subtitle">
            Larger sets provide stronger privacy guarantees
          </p>
        </div>
        {isLoading && (
          <div className="badge-yellow">
            <div className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
            Syncing
          </div>
        )}
      </div>

      {/* Bar chart */}
      <div className="card">
        <div className="space-y-4">
          {stats.map((pool) => {
            const barWidth =
              maxAnonymity > 0
                ? (pool.anonymitySet / maxAnonymity) * 100
                : 0;

            return (
              <div key={pool.label} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        pool.token === "BNB" ? "bg-yellow-400" : "bg-blue-400"
                      }`}
                    />
                    <span className="text-sm font-medium text-slate-300">
                      {pool.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-500">
                      {pool.depositCount} deposits
                    </span>
                    <span className="min-w-[3rem] text-right text-sm font-semibold text-primary-400">
                      {pool.anonymitySet}
                    </span>
                  </div>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-surface-300">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      pool.token === "BNB"
                        ? "bg-gradient-to-r from-yellow-600 to-yellow-400"
                        : "bg-gradient-to-r from-blue-600 to-blue-400"
                    }`}
                    style={{ width: `${Math.max(barWidth, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-6 flex items-center gap-6 border-t border-surface-300 pt-4">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
            <span className="text-xs text-slate-400">BNB Pools</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />
            <span className="text-xs text-slate-400">BUSD Pools</span>
          </div>
        </div>
      </div>
    </div>
  );
}
