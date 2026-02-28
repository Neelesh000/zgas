"use client";

import { useState, useCallback } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  type Address,
  encodeAbiParameters,
  parseAbiParameters,
  encodePacked,
  keccak256,
} from "viem";
import {
  usePrivacyPool,
  parseNote,
  computeCommitmentAsync,
  computeSponsorshipNullifierHashAsync,
  computeCommitment,
  computeNullifierHash,
} from "@/hooks/usePrivacyPool";
import { usePaymaster } from "@/hooks/usePaymaster";
import {
  CONTRACTS,
  ACTIVE_CHAIN_ID,
  DENOMINATIONS,
  CIRCUIT_PATHS,
  RELAYER_URL,
} from "@/lib/constants";
import { buildPoolTree, buildASPTree } from "@/lib/merkleTree";
import ProofProgress from "./ProofProgress";

const USE_MOCK_PROOFS = process.env.NEXT_PUBLIC_USE_MOCK_PROOFS === "true";

type SponsorStep = "connect" | "input" | "proving" | "submit" | "done";

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

export default function SponsorForm() {
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const {
    getASPRoot,
    getPoolRoot,
    checkCommitmentOnChain,
  } = usePrivacyPool();
  const {
    getAccountAddress,
    isAccountDeployed,
    buildPaymasterAndData,
    buildDummyProofBytes,
    buildUserOp,
    buildInitCode,
    submitSponsoredTx,
  } = usePaymaster();

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
  const [txHash, setTxHash] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [paymasterAndData, setPaymasterAndData] = useState<`0x${string}` | null>(null);
  const [accountAddress, setAccountAddress] = useState<Address | null>(null);
  const [initCode, setInitCode] = useState<`0x${string}` | null>(null);

  const parsedNote = noteString ? parseNote(noteString.trim()) : null;
  const isNoteValid = parsedNote !== null;
  const isTargetValid =
    targetAddress.length === 42 && targetAddress.startsWith("0x");

  const handleGenerateMembershipProof = useCallback(async () => {
    if (!parsedNote || !isTargetValid || !address || !publicClient) return;

    setStep("proving");
    setProofError(null);
    setProofStep(0);

    try {
      // Step 0: Parse note, derive commitment + sponsorship nullifier
      const secret = BigInt(parsedNote.secret);
      const nullifier = BigInt(parsedNote.nullifier);

      const commitment = USE_MOCK_PROOFS
        ? computeCommitment(secret, nullifier) as `0x${string}`
        : (await computeCommitmentAsync(secret, nullifier)) as `0x${string}`;

      const denom = DENOMINATIONS.find(
        (d) =>
          d.token === parsedNote.token &&
          d.displayAmount.replace(/,/g, "") === parsedNote.amount
      );
      if (!denom) throw new Error("Unknown denomination in note");

      setProofStep(1);

      // Step 1: Validate commitment exists on-chain
      const exists = await checkCommitmentOnChain(commitment, denom.poolKey);
      if (!exists) throw new Error("Commitment not found on-chain. Did you deposit?");

      setProofStep(2);

      // Step 2: Fetch pool Merkle root + ASP root
      const [merkleRootOnChain, aspRoot] = await Promise.all([
        getPoolRoot(denom.poolKey),
        getASPRoot(),
      ]);
      if (!merkleRootOnChain) throw new Error("Failed to fetch pool Merkle root");
      if (!aspRoot) throw new Error("Failed to fetch ASP root");

      setProofStep(3);

      let proofBytes: `0x${string}`;
      let nullifierHash: `0x${string}`;
      let merkleRoot: `0x${string}`;

      let finalAspRoot = aspRoot;

      if (USE_MOCK_PROOFS) {
        // Mock mode: keccak-based domain-separated nullifier, dummy proof
        const rawNullifierHash = computeNullifierHash(nullifier) as `0x${string}`;
        nullifierHash = keccak256(
          encodePacked(["bytes32", "uint256"], [rawNullifierHash, 2n])
        );
        proofBytes = buildDummyProofBytes();
        merkleRoot = merkleRootOnChain;
      } else {
        // Real mode: Poseidon domain-separated nullifier, real Groth16 proof
        nullifierHash = (await computeSponsorshipNullifierHashAsync(nullifier)) as `0x${string}`;

        const contracts = CONTRACTS[ACTIVE_CHAIN_ID];
        const poolAddress = contracts[denom.poolKey as keyof typeof contracts] as Address;

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

        // Reconstruct pool Merkle tree
        const poolTree = await buildPoolTree(poolAddress, publicClient);
        const commitmentBigInt = BigInt(commitment);
        const leafIndex = poolTree.indexOf(commitmentBigInt);
        if (leafIndex === -1) {
          throw new Error("Commitment not found in reconstructed Merkle tree.");
        }

        const poolProof = poolTree.getProof(leafIndex);
        merkleRoot = toHex32(poolProof.root) as `0x${string}`;

        // Build real ASP tree from all pool deposits
        const aspTree = await buildASPTree(allPoolAddresses, publicClient);
        const aspLeafIndex = aspTree.indexOf(commitmentBigInt);
        if (aspLeafIndex === -1) {
          throw new Error("Commitment not found in ASP tree. ASP sync may have failed.");
        }
        const aspProof = aspTree.getProof(aspLeafIndex);
        finalAspRoot = toHex32(aspProof.root) as `0x${string}`;

        // Build circuit input for membership
        const input = {
          secret: secret.toString(),
          nullifier: nullifier.toString(),
          pathElements: poolProof.pathElements.map((e) => e.toString()),
          pathIndices: poolProof.pathIndices,
          aspPathElements: aspProof.pathElements.map((e) => e.toString()),
          aspPathIndices: aspProof.pathIndices,
          root: poolProof.root.toString(),
          nullifierHash: BigInt(nullifierHash).toString(),
          aspRoot: BigInt(finalAspRoot).toString(),
        };

        // Generate Groth16 proof
        const snarkjs = await import("snarkjs");
        const { proof } = await snarkjs.groth16.fullProve(
          input,
          CIRCUIT_PATHS.membership.wasm,
          CIRCUIT_PATHS.membership.zkey
        );

        proofBytes = encodeProofForContract(proof);
      }

      // Build paymasterAndData
      const pmData = buildPaymasterAndData(proofBytes, merkleRoot, nullifierHash, finalAspRoot!);
      setPaymasterAndData(pmData);

      // Step 4: Compute SimpleAccount address and check deployment
      const acctAddr = await getAccountAddress(address);
      setAccountAddress(acctAddr);

      const deployed = await isAccountDeployed(acctAddr);
      if (!deployed) {
        setInitCode(buildInitCode(address));
      } else {
        setInitCode(null);
      }

      setProofStep(4);
      setIsProofComplete(true);
      setStep("submit");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown error during proving";
      setProofError(message);
    }
  }, [
    parsedNote,
    isTargetValid,
    address,
    publicClient,
    checkCommitmentOnChain,
    getPoolRoot,
    getASPRoot,
    buildPaymasterAndData,
    buildDummyProofBytes,
    getAccountAddress,
    isAccountDeployed,
    buildInitCode,
  ]);

  const handleSubmitSponsoredTx = useCallback(async () => {
    if (!address || !accountAddress || !paymasterAndData) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const target = targetAddress as Address;
      const innerCallData = (callData || "0x") as `0x${string}`;

      const userOp = await buildUserOp(
        accountAddress,
        target,
        innerCallData,
        paymasterAndData,
        initCode || undefined
      );

      const result = await submitSponsoredTx(userOp);

      setUserOpHash(result.userOpHash);
      setTxHash(result.txHash);
      setStep("done");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Transaction failed";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    address,
    accountAddress,
    paymasterAndData,
    targetAddress,
    callData,
    initCode,
    buildUserOp,
    submitSponsoredTx,
  ]);

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
              {USE_MOCK_PROOFS
                ? "Membership proof prepared (mock mode). Ready to submit."
                : "Membership proof verified. Ready to submit sponsored transaction."}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
              <span className="text-sm text-slate-400">Smart Account</span>
              <span className="font-mono text-xs text-slate-300">
                {accountAddress?.slice(0, 10)}...{accountAddress?.slice(-8)}
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
            {initCode && (
              <div className="flex items-center justify-between rounded-lg bg-surface-200 p-4">
                <span className="text-sm text-slate-400">Account</span>
                <span className="text-xs text-yellow-400">
                  Will be deployed with this tx
                </span>
              </div>
            )}
          </div>

          {submitError && (
            <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-3">
              <p className="text-sm text-red-400">
                {submitError.slice(0, 200)}
              </p>
            </div>
          )}

          <button
            onClick={handleSubmitSponsoredTx}
            disabled={isSubmitting}
            className="btn-primary w-full"
          >
            {isSubmitting
              ? "Submitting to bundler..."
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
          {txHash && (
            <div className="mt-4">
              <p className="text-xs text-slate-500">Transaction Hash</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-300">
                {txHash}
              </p>
            </div>
          )}
          {userOpHash && (
            <div className="mt-3">
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
              setTxHash(null);
              setPaymasterAndData(null);
              setAccountAddress(null);
              setInitCode(null);
              setSubmitError(null);
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
