import dotenv from "dotenv";

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  // Server
  port: parseInt(optionalEnv("PORT", "3001"), 10),
  nodeEnv: optionalEnv("NODE_ENV", "development"),

  // Blockchain
  rpcUrl: requireEnv("RPC_URL"),
  chainId: parseInt(optionalEnv("CHAIN_ID", "56"), 10),
  privateKey: requireEnv("RELAYER_PRIVATE_KEY"),

  // Database
  databaseUrl: requireEnv("DATABASE_URL"),

  // Contract addresses
  contracts: {
    privacyPoolBNB: requireEnv("PRIVACY_POOL_BNB_ADDRESS"),
    tokenPool: optionalEnv("TOKEN_POOL_ADDRESS", ""),
    aspRegistry: requireEnv("ASP_REGISTRY_ADDRESS"),
    privacyPaymaster: requireEnv("PRIVACY_PAYMASTER_ADDRESS"),
    entryPoint: optionalEnv(
      "ENTRY_POINT_ADDRESS",
      "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
    ),
  },

  // Bundler
  bundlerUrl: optionalEnv("BUNDLER_URL", ""),

  // Screening
  chainalysisSanctionsOracle: optionalEnv(
    "CHAINALYSIS_SANCTIONS_ORACLE",
    "0x40C57923924B5c5c5455c48D93317139ADDaC8fb"
  ),
  ofacListPath: optionalEnv("OFAC_LIST_PATH", "./data/sdn_list.json"),

  // Relayer tuning
  minWithdrawalDelayMs: parseInt(
    optionalEnv("MIN_WITHDRAWAL_DELAY_MS", "30000"),
    10
  ),
  maxWithdrawalDelayMs: parseInt(
    optionalEnv("MAX_WITHDRAWAL_DELAY_MS", "900000"),
    10
  ),
  relayerFeePercent: parseFloat(optionalEnv("RELAYER_FEE_PERCENT", "0.5")),

  // ASP
  aspUpdateIntervalMs: parseInt(
    optionalEnv("ASP_UPDATE_INTERVAL_MS", "300000"),
    10
  ),
  aspTreeDepth: parseInt(optionalEnv("ASP_TREE_DEPTH", "20"), 10),

  // Rate limiting
  rateLimitWindowMs: parseInt(
    optionalEnv("RATE_LIMIT_WINDOW_MS", "900000"),
    10
  ),
  rateLimitMaxRequests: parseInt(
    optionalEnv("RATE_LIMIT_MAX_REQUESTS", "100"),
    10
  ),

  // ZK proof artifacts
  withdrawCircuitWasm: optionalEnv(
    "WITHDRAW_CIRCUIT_WASM",
    "./circuits/withdraw.wasm"
  ),
  withdrawCircuitZkey: optionalEnv(
    "WITHDRAW_CIRCUIT_ZKEY",
    "./circuits/withdraw.zkey"
  ),
  membershipCircuitWasm: optionalEnv(
    "MEMBERSHIP_CIRCUIT_WASM",
    "./circuits/membership.wasm"
  ),
  membershipCircuitZkey: optionalEnv(
    "MEMBERSHIP_CIRCUIT_ZKEY",
    "./circuits/membership.zkey"
  ),
} as const;

export type Config = typeof config;
