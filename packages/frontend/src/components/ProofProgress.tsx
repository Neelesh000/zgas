"use client";

interface ProofStep {
  id: string;
  label: string;
  description: string;
}

const PROOF_STEPS: ProofStep[] = [
  {
    id: "prepare",
    label: "Preparing inputs",
    description: "Computing commitment and Merkle path",
  },
  {
    id: "wasm",
    label: "Loading circuit",
    description: "Downloading WASM witness generator",
  },
  {
    id: "witness",
    label: "Computing witness",
    description: "Evaluating circuit constraints",
  },
  {
    id: "prove",
    label: "Generating proof",
    description: "Running Groth16 prover (~15-30s)",
  },
  {
    id: "verify",
    label: "Verifying locally",
    description: "Checking proof validity before submission",
  },
];

interface ProofProgressProps {
  currentStep: number; // 0-indexed, -1 means not started
  error?: string | null;
  isComplete?: boolean;
}

export default function ProofProgress({
  currentStep,
  error,
  isComplete,
}: ProofProgressProps) {
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-900/50">
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
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
            />
          </svg>
        </div>
        <div>
          <h3 className="font-semibold text-white">ZK Proof Generation</h3>
          <p className="text-xs text-slate-400">
            {isComplete
              ? "Proof generated successfully"
              : currentStep >= 0
              ? "This may take 15-30 seconds"
              : "Waiting to start"}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {PROOF_STEPS.map((step, index) => {
          const isActive = index === currentStep;
          const isDone = index < currentStep || isComplete;
          const isError = error && isActive;

          return (
            <div key={step.id} className="flex items-start gap-3">
              {/* Step indicator */}
              <div className="relative flex flex-col items-center">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                    isError
                      ? "border-red-500 bg-red-500/20"
                      : isDone
                      ? "border-primary-500 bg-primary-500"
                      : isActive
                      ? "border-primary-500 bg-primary-500/20"
                      : "border-surface-400 bg-surface-200"
                  }`}
                >
                  {isError ? (
                    <svg
                      className="h-3.5 w-3.5 text-red-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  ) : isDone ? (
                    <svg
                      className="h-3.5 w-3.5 text-white"
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
                  ) : isActive ? (
                    <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary-400" />
                  ) : (
                    <span className="text-xs text-slate-500">{index + 1}</span>
                  )}
                </div>
                {/* Connector line */}
                {index < PROOF_STEPS.length - 1 && (
                  <div
                    className={`mt-1 h-4 w-0.5 ${
                      isDone ? "bg-primary-500" : "bg-surface-400"
                    }`}
                  />
                )}
              </div>

              {/* Step content */}
              <div className="pb-4">
                <p
                  className={`text-sm font-medium ${
                    isError
                      ? "text-red-400"
                      : isDone
                      ? "text-primary-400"
                      : isActive
                      ? "text-white"
                      : "text-slate-500"
                  }`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-slate-500">{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Progress bar */}
      {currentStep >= 0 && !isComplete && !error && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-300">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary-600 to-primary-400 transition-all duration-500"
            style={{
              width: `${((currentStep + 1) / PROOF_STEPS.length) * 100}%`,
            }}
          />
        </div>
      )}

      {isComplete && (
        <div className="rounded-lg border border-primary-800/50 bg-primary-900/20 p-3">
          <p className="text-sm text-primary-400">
            Proof verified successfully. Ready to submit transaction.
          </p>
        </div>
      )}
    </div>
  );
}
