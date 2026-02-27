import { config } from "../config";
import { publishASPRoot, getASPTree } from "../services/asp.service";

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Periodically publish the current ASP Merkle root on-chain.
 *
 * The interval is configured via ASP_UPDATE_INTERVAL_MS (default 5 minutes).
 * Each cycle:
 *   1. Checks if the ASP tree has any leaves.
 *   2. Attempts to publish the root on-chain (skips if root is already known).
 *   3. Logs success or failure.
 */
export async function startASPUpdater(): Promise<() => void> {
  const intervalMs = config.aspUpdateIntervalMs;

  console.log(
    `[ASPUpdater] Starting periodic ASP root updates every ${intervalMs / 1000}s`
  );

  async function tick(): Promise<void> {
    const tree = getASPTree();

    if (tree.leafCount === 0) {
      console.log("[ASPUpdater] ASP tree is empty, nothing to publish");
      return;
    }

    console.log(
      `[ASPUpdater] Publishing ASP root (${tree.leafCount} approved leaves)...`
    );

    try {
      const txHash = await publishASPRoot();
      if (txHash) {
        console.log(`[ASPUpdater] Root published, tx: ${txHash}`);
      } else {
        console.log("[ASPUpdater] Root already up-to-date on-chain");
      }
    } catch (err) {
      console.error(
        "[ASPUpdater] Failed to publish root:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Run immediately on start
  await tick();

  // Then run periodically
  intervalHandle = setInterval(() => {
    tick().catch((err) => {
      console.error(
        "[ASPUpdater] Unexpected error in tick:",
        err instanceof Error ? err.message : err
      );
    });
  }, intervalMs);

  return () => {
    console.log("[ASPUpdater] Stopping...");
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };
}
