import { ethers } from "ethers";
import { config } from "../config";
import { query } from "../db";
import { processDeposit } from "../services/asp.service";

const PRIVACY_POOL_ABI = [
  "event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp, uint256 denomination)",
];

// Minimal ERC-20 pool ABI with token() getter
const TOKEN_POOL_ABI = [
  ...PRIVACY_POOL_ABI,
  "function token() view returns (address)",
];

interface PoolConfig {
  address: string;
  token: string | null; // null = native BNB
  abi: string[];
}

/**
 * Get the list of pool contracts to watch.
 */
function getPoolConfigs(): PoolConfig[] {
  const pools: PoolConfig[] = [];

  if (config.contracts.privacyPoolBNB) {
    pools.push({
      address: config.contracts.privacyPoolBNB,
      token: null,
      abi: PRIVACY_POOL_ABI,
    });
  }

  if (config.contracts.tokenPool) {
    pools.push({
      address: config.contracts.tokenPool,
      token: "erc20", // Will be resolved at runtime
      abi: TOKEN_POOL_ABI,
    });
  }

  return pools;
}

/**
 * Resolve the depositor address from a transaction hash.
 * Since the Deposit event does not include msg.sender, we must look
 * at the transaction itself.
 */
async function resolveDepositor(
  provider: ethers.JsonRpcProvider,
  txHash: string
): Promise<string> {
  const tx = await provider.getTransaction(txHash);
  if (!tx || !tx.from) {
    throw new Error(`Could not resolve depositor from tx ${txHash}`);
  }
  return tx.from;
}

/**
 * Get the last processed block from the database.
 */
async function getLastProcessedBlock(poolAddress: string): Promise<number> {
  const result = await query<{ max_block: string | null }>(
    "SELECT MAX(block_number) as max_block FROM deposits WHERE pool_address = $1",
    [poolAddress.toLowerCase()]
  );
  const maxBlock = result.rows[0]?.max_block;
  return maxBlock ? parseInt(maxBlock, 10) : 0;
}

/**
 * Process historical deposit events from a given block range.
 */
async function processHistoricalDeposits(
  provider: ethers.JsonRpcProvider,
  poolConfig: PoolConfig,
  fromBlock: number,
  toBlock: number
): Promise<number> {
  const contract = new ethers.Contract(
    poolConfig.address,
    poolConfig.abi,
    provider
  );

  let tokenAddress = poolConfig.token;
  if (tokenAddress === "erc20") {
    try {
      tokenAddress = await contract.token();
    } catch {
      tokenAddress = null;
    }
  }

  const filter = contract.filters.Deposit();
  const events = await contract.queryFilter(filter, fromBlock, toBlock);

  let processed = 0;
  for (const event of events) {
    if (!("args" in event)) continue;
    const log = event as ethers.EventLog;

    const commitment = log.args[0] as string;
    const leafIndex = Number(log.args[1]);
    const denomination = (log.args[3] as bigint).toString();

    try {
      const depositor = await resolveDepositor(
        provider,
        log.transactionHash
      );

      await processDeposit(
        commitment,
        leafIndex,
        depositor,
        poolConfig.address.toLowerCase(),
        tokenAddress,
        denomination,
        log.blockNumber,
        log.transactionHash
      );

      processed++;
    } catch (err) {
      console.error(
        `[DepositWatcher] Error processing deposit ${commitment.slice(0, 10)}...:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return processed;
}

/**
 * Start the deposit watcher.
 *
 * - On startup, syncs any missed historical deposits from the last processed block.
 * - Then subscribes to real-time Deposit events on each pool contract.
 */
export async function startDepositWatcher(): Promise<() => void> {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const pools = getPoolConfigs();
  const cleanupFns: (() => void)[] = [];

  console.log(
    `[DepositWatcher] Starting watcher for ${pools.length} pool(s)...`
  );

  for (const poolConfig of pools) {
    // Historical sync
    const lastBlock = await getLastProcessedBlock(poolConfig.address);
    const currentBlock = await provider.getBlockNumber();

    if (lastBlock < currentBlock) {
      const startBlock = lastBlock > 0 ? lastBlock + 1 : Math.max(currentBlock - 10000, 0);
      console.log(
        `[DepositWatcher] Syncing ${poolConfig.address.slice(0, 10)}... from block ${startBlock} to ${currentBlock}`
      );

      // Process in chunks to avoid RPC limits
      const CHUNK_SIZE = 2000;
      for (let from = startBlock; from <= currentBlock; from += CHUNK_SIZE) {
        const to = Math.min(from + CHUNK_SIZE - 1, currentBlock);
        const count = await processHistoricalDeposits(
          provider,
          poolConfig,
          from,
          to
        );
        if (count > 0) {
          console.log(
            `[DepositWatcher] Processed ${count} historical deposit(s) in blocks ${from}-${to}`
          );
        }
      }
    }

    // Real-time event subscription
    const contract = new ethers.Contract(
      poolConfig.address,
      poolConfig.abi,
      provider
    );

    let tokenAddress = poolConfig.token;
    if (tokenAddress === "erc20") {
      try {
        tokenAddress = await contract.token();
      } catch {
        tokenAddress = null;
      }
    }

    const listener = async (
      commitment: string,
      leafIndex: bigint,
      timestamp: bigint,
      denomination: bigint,
      event: ethers.EventLog
    ) => {
      console.log(
        `[DepositWatcher] New deposit detected: ${commitment.slice(0, 10)}... (leaf ${leafIndex})`
      );

      try {
        const depositor = await resolveDepositor(
          provider,
          event.transactionHash
        );

        await processDeposit(
          commitment,
          Number(leafIndex),
          depositor,
          poolConfig.address.toLowerCase(),
          tokenAddress,
          denomination.toString(),
          event.blockNumber,
          event.transactionHash
        );
      } catch (err) {
        console.error(
          `[DepositWatcher] Error processing real-time deposit:`,
          err instanceof Error ? err.message : err
        );
      }
    };

    contract.on("Deposit", listener);
    cleanupFns.push(() => {
      contract.off("Deposit", listener);
    });

    console.log(
      `[DepositWatcher] Listening for deposits on ${poolConfig.address.slice(0, 10)}...`
    );
  }

  // Return cleanup function
  return () => {
    console.log("[DepositWatcher] Stopping...");
    for (const cleanup of cleanupFns) {
      cleanup();
    }
  };
}
