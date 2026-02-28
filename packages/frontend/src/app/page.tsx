"use client";

import Link from "next/link";
import { useEffect } from "react";
import PoolStats from "@/components/PoolStats";
import { usePrivacyPool } from "@/hooks/usePrivacyPool";

const FEATURES = [
  {
    title: "Private Deposits",
    description:
      "Deposit BNB or tokens into fixed-denomination pools. Your commitment is added to a Merkle tree with zero link to your identity.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
      />
    ),
    href: "/deposit",
  },
  {
    title: "ZK Withdrawals",
    description:
      "Generate a Groth16 proof in your browser to withdraw funds to any address. No one can link withdrawal to your deposit.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    ),
    href: "/withdraw",
  },
  {
    title: "Gas Sponsorship",
    description:
      "Use a fresh wallet and prove pool membership. The ERC-4337 paymaster covers gas costs without revealing your history.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
      />
    ),
    href: "/sponsor",
  },
  {
    title: "ASP Compliance",
    description:
      "Association Set Providers screen deposits against sanctions lists, ensuring the pool remains compliant while preserving privacy.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
      />
    ),
    href: "/stats",
  },
];

export default function HomePage() {
  const { fetchPoolStats } = usePrivacyPool();

  useEffect(() => {
    fetchPoolStats();
  }, [fetchPoolStats]);

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="relative overflow-hidden py-16 sm:py-24">
        {/* Background grid */}
        <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-surface/50 to-surface" />

        <div className="relative text-center">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-primary-800/50 bg-primary-900/20 px-4 py-1.5">
            <div className="h-2 w-2 animate-pulse-slow rounded-full bg-primary-400 shadow-[0_0_6px_rgba(0,255,163,0.5)]" />
            <span className="text-sm text-primary-400">
              Live on BNB Chain Testnet
            </span>
          </div>

          <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Private Gas Sponsorship{" "}
            <span className="gradient-text">with Zero-Knowledge Proofs</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
            Deposit into privacy pools, withdraw anonymously, and get gas
            sponsored for fresh wallets — all without revealing your on-chain
            identity. Powered by Groth16 proofs and ERC-4337 account
            abstraction.
          </p>

          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/deposit" className="btn-primary text-lg">
              Start Depositing
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              </svg>
            </Link>
            <Link href="/stats" className="btn-secondary text-lg">
              View Stats
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section>
        <div className="text-center">
          <h2 className="section-title">How It Works</h2>
          <p className="section-subtitle mx-auto max-w-2xl">
            A three-step process for private, gas-sponsored transactions on BNB
            Chain
          </p>
        </div>

        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {[
            {
              step: "01",
              title: "Deposit",
              description:
                "Choose a fixed denomination and deposit BNB or tokens. A cryptographic commitment is generated client-side and added to the Merkle tree.",
            },
            {
              step: "02",
              title: "Prove",
              description:
                "When ready to withdraw or request gas sponsorship, generate a zero-knowledge proof in your browser that verifies pool membership.",
            },
            {
              step: "03",
              title: "Transact",
              description:
                "Submit your proof to withdraw funds anonymously, or use it with a fresh wallet to get gas sponsored by the ERC-4337 paymaster.",
            },
          ].map((item) => (
            <div key={item.step} className="card-hover group">
              <div className="mb-4 text-4xl font-bold text-surface-400 transition-colors group-hover:text-primary-800">
                {item.step}
              </div>
              <h3 className="text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section>
        <div className="text-center">
          <h2 className="section-title">Core Features</h2>
          <p className="section-subtitle">
            Built for privacy, compliance, and usability
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <Link
              key={feature.title}
              href={feature.href}
              className="card-hover group"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-900/50 transition-all group-hover:bg-primary-900 group-hover:shadow-neon">
                  <svg
                    className="h-6 w-6 text-primary-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    {feature.icon}
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-white">{feature.title}</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    {feature.description}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Pool Stats Dashboard */}
      <section>
        <PoolStats />
      </section>

      {/* Architecture overview */}
      <section className="card">
        <div className="text-center">
          <h2 className="section-title">Architecture</h2>
          <p className="section-subtitle">
            Privacy-preserving infrastructure on BNB Chain
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Privacy Pool",
              desc: "Merkle tree of commitments with fixed denominations",
              color: "text-[#00ffa3]",
            },
            {
              label: "ASP Registry",
              desc: "Compliance screening via Association Set Providers",
              color: "text-[#00d4ff]",
            },
            {
              label: "Groth16 Prover",
              desc: "Client-side ZK proof generation in the browser",
              color: "text-[#ff00ea]",
            },
            {
              label: "ERC-4337 Paymaster",
              desc: "Gas sponsorship for wallets with valid membership proofs",
              color: "text-[#faff00]",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-surface-300 bg-surface-200 p-4"
            >
              <p className={`font-semibold ${item.color}`}>{item.label}</p>
              <p className="mt-1 text-xs text-slate-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
