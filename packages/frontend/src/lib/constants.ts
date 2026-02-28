import { type Address } from "viem";

/* -------------------------------------------------------------------------- */
/*                              Chain configuration                           */
/* -------------------------------------------------------------------------- */

export const BNB_MAINNET_ID = 56;
export const BNB_TESTNET_ID = 97;

/** Active chain – toggle for mainnet vs testnet */
export const ACTIVE_CHAIN_ID = BNB_TESTNET_ID;

export const RPC_URLS: Record<number, string> = {
  [BNB_MAINNET_ID]: "https://bsc-dataseed1.binance.org",
  [BNB_TESTNET_ID]: process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545",
};

/* -------------------------------------------------------------------------- */
/*                          Contract addresses (testnet)                      */
/* -------------------------------------------------------------------------- */

export const CONTRACTS = {
  [BNB_TESTNET_ID]: {
    privacyPool_BNB_01: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as Address,
    privacyPool_BNB_1: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" as Address,
    privacyPool_BNB_10: "0x0165878A594ca255338adfa4d48449f69242Eb8F" as Address,
    tokenPool_BUSD_100:
      "0x0000000000000000000000000000000000000000" as Address,
    tokenPool_BUSD_1000:
      "0x0000000000000000000000000000000000000000" as Address,
    tokenPool_BUSD_10000:
      "0x0000000000000000000000000000000000000000" as Address,
    privacyPaymaster:
      "0x0000000000000000000000000000000000000000" as Address,
    aspRegistry: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address,
    entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as Address,
  },
  [BNB_MAINNET_ID]: {
    privacyPool_BNB_01: "0x0000000000000000000000000000000000000000" as Address,
    privacyPool_BNB_1: "0x0000000000000000000000000000000000000000" as Address,
    privacyPool_BNB_10: "0x0000000000000000000000000000000000000000" as Address,
    tokenPool_BUSD_100:
      "0x0000000000000000000000000000000000000000" as Address,
    tokenPool_BUSD_1000:
      "0x0000000000000000000000000000000000000000" as Address,
    tokenPool_BUSD_10000:
      "0x0000000000000000000000000000000000000000" as Address,
    privacyPaymaster:
      "0x0000000000000000000000000000000000000000" as Address,
    aspRegistry: "0x0000000000000000000000000000000000000000" as Address,
    entryPoint: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as Address,
  },
};

/* -------------------------------------------------------------------------- */
/*                              Token metadata                                */
/* -------------------------------------------------------------------------- */

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  address: Address | null; // null = native BNB
  logoUrl: string;
}

export const TOKENS: TokenInfo[] = [
  {
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
    address: null,
    logoUrl: "/tokens/bnb.svg",
  },
  {
    symbol: "BUSD",
    name: "Binance USD",
    decimals: 18,
    address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56" as Address,
    logoUrl: "/tokens/busd.svg",
  },
];

/* -------------------------------------------------------------------------- */
/*                            Denomination options                            */
/* -------------------------------------------------------------------------- */

export interface DenominationOption {
  label: string;
  value: string; // wei value as string
  displayAmount: string;
  token: string;
  poolKey: string;
}

export const DENOMINATIONS: DenominationOption[] = [
  {
    label: "0.1 BNB",
    value: "100000000000000000",
    displayAmount: "0.1",
    token: "BNB",
    poolKey: "privacyPool_BNB_01",
  },
  {
    label: "1 BNB",
    value: "1000000000000000000",
    displayAmount: "1",
    token: "BNB",
    poolKey: "privacyPool_BNB_1",
  },
  {
    label: "10 BNB",
    value: "10000000000000000000",
    displayAmount: "10",
    token: "BNB",
    poolKey: "privacyPool_BNB_10",
  },
  {
    label: "100 BUSD",
    value: "100000000000000000000",
    displayAmount: "100",
    token: "BUSD",
    poolKey: "tokenPool_BUSD_100",
  },
  {
    label: "1,000 BUSD",
    value: "1000000000000000000000",
    displayAmount: "1,000",
    token: "BUSD",
    poolKey: "tokenPool_BUSD_1000",
  },
  {
    label: "10,000 BUSD",
    value: "10000000000000000000000",
    displayAmount: "10,000",
    token: "BUSD",
    poolKey: "tokenPool_BUSD_10000",
  },
];

/* -------------------------------------------------------------------------- */
/*                             ZK circuit paths                               */
/* -------------------------------------------------------------------------- */

export const CIRCUIT_PATHS = {
  withdraw: {
    wasm: "/circuits/withdraw.wasm",
    zkey: "/circuits/withdraw_final.zkey",
  },
  membership: {
    wasm: "/circuits/membership.wasm",
    zkey: "/circuits/membership_final.zkey",
  },
};

/* -------------------------------------------------------------------------- */
/*                              Relayer config                                */
/* -------------------------------------------------------------------------- */

export const RELAYER_URL =
  process.env.NEXT_PUBLIC_RELAYER_URL || "http://localhost:4000";

export const RELAYER_FEE_PERCENT = 0.5; // 0.5% relayer fee

/* -------------------------------------------------------------------------- */
/*                               ABI fragments                                */
/* -------------------------------------------------------------------------- */

export const PRIVACY_POOL_ABI = [
  {
    inputs: [{ name: "commitment", type: "bytes32" }],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "_proof", type: "bytes" },
      { name: "_root", type: "bytes32" },
      { name: "_nullifierHash", type: "bytes32" },
      { name: "_recipient", type: "address" },
      { name: "_relayer", type: "address" },
      { name: "_fee", type: "uint256" },
      { name: "_refund", type: "uint256" },
      { name: "_aspRoot", type: "bytes32" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "denomination",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "bytes32" }],
    name: "nullifierHashes",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "bytes32" }],
    name: "commitments",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "commitment", type: "bytes32" },
      { indexed: false, name: "leafIndex", type: "uint32" },
      { indexed: false, name: "timestamp", type: "uint256" },
      { indexed: false, name: "denomination", type: "uint256" },
    ],
    name: "Deposit",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, name: "to", type: "address" },
      { indexed: false, name: "nullifierHash", type: "bytes32" },
      { indexed: true, name: "relayer", type: "address" },
      { indexed: false, name: "fee", type: "uint256" },
    ],
    name: "Withdrawal",
    type: "event",
  },
] as const;

export const TOKEN_POOL_ABI = [
  {
    inputs: [{ name: "commitment", type: "bytes32" }],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_proof", type: "bytes" },
      { name: "_root", type: "bytes32" },
      { name: "_nullifierHash", type: "bytes32" },
      { name: "_recipient", type: "address" },
      { name: "_relayer", type: "address" },
      { name: "_fee", type: "uint256" },
      { name: "_refund", type: "uint256" },
      { name: "_aspRoot", type: "bytes32" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "denomination",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const ASP_REGISTRY_ABI = [
  {
    inputs: [],
    name: "getLastASPRoot",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "root", type: "bytes32" }],
    name: "isKnownASPRoot",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "commitment", type: "bytes32" }],
    name: "isBlocked",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
