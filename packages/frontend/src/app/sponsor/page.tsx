"use client";

import SponsorForm from "@/components/SponsorForm";

export default function SponsorPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="section-title">Sponsor Gas</h1>
        <p className="section-subtitle">
          Connect a fresh wallet and prove pool membership with a ZK proof. The
          ERC-4337 Privacy Paymaster sponsors gas for your transaction without
          linking to your deposit.
        </p>
      </div>

      {/* How it works */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            step: "1",
            title: "Fresh Wallet",
            desc: "Connect a new wallet with no history",
          },
          {
            step: "2",
            title: "Prove Membership",
            desc: "Generate a ZK membership proof from your note",
          },
          {
            step: "3",
            title: "Submit UserOp",
            desc: "Send a gas-free transaction via ERC-4337",
          },
        ].map((item) => (
          <div
            key={item.step}
            className="flex gap-3 rounded-lg border border-surface-300 bg-surface-100 p-4"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-900/50 text-xs font-bold text-primary-400">
              {item.step}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-300">{item.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Sponsor form */}
      <SponsorForm />
    </div>
  );
}
