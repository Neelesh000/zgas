import { getDueWithdrawals, submitWithdrawal } from "../services/relayer.service";

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const POLL_INTERVAL_MS = 5000; // Check for due withdrawals every 5 seconds
const MAX_CONCURRENT = 3; // Max concurrent withdrawal submissions

let activeSubmissions = 0;

/**
 * Process a single withdrawal, managing the concurrency counter.
 */
async function processOne(withdrawalId: string): Promise<void> {
  activeSubmissions++;
  try {
    await submitWithdrawal(withdrawalId);
  } catch (err) {
    console.error(
      `[WithdrawalProcessor] Failed to process withdrawal ${withdrawalId}:`,
      err instanceof Error ? err.message : err
    );
  } finally {
    activeSubmissions--;
  }
}

/**
 * Poll for due withdrawals and process them.
 *
 * Withdrawals are queued with a randomized delay (jitter) by the relayer
 * service. This worker checks every POLL_INTERVAL_MS for withdrawals whose
 * scheduled_at timestamp has passed, then submits them on-chain one by one
 * (with limited concurrency).
 */
async function tick(): Promise<void> {
  if (activeSubmissions >= MAX_CONCURRENT) {
    return; // Skip this tick, already at capacity
  }

  try {
    const dueIds = await getDueWithdrawals();

    if (dueIds.length === 0) return;

    console.log(
      `[WithdrawalProcessor] ${dueIds.length} withdrawal(s) due for processing`
    );

    const slotsAvailable = MAX_CONCURRENT - activeSubmissions;
    const toProcess = dueIds.slice(0, slotsAvailable);

    // Process in parallel up to concurrency limit
    await Promise.allSettled(toProcess.map((id) => processOne(id)));
  } catch (err) {
    console.error(
      "[WithdrawalProcessor] Error fetching due withdrawals:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Start the withdrawal processor worker.
 */
export async function startWithdrawalProcessor(): Promise<() => void> {
  console.log(
    `[WithdrawalProcessor] Starting (poll interval: ${POLL_INTERVAL_MS}ms, max concurrent: ${MAX_CONCURRENT})`
  );

  // Run immediately
  await tick();

  // Then poll
  intervalHandle = setInterval(() => {
    tick().catch((err) => {
      console.error(
        "[WithdrawalProcessor] Unexpected error:",
        err instanceof Error ? err.message : err
      );
    });
  }, POLL_INTERVAL_MS);

  return () => {
    console.log("[WithdrawalProcessor] Stopping...");
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };
}
