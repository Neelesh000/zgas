"use client";

import { useCallback } from "react";
import { usePublicClient } from "wagmi";
import {
  type Address,
  encodeAbiParameters,
  parseAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
} from "viem";
import {
  CONTRACTS,
  ACTIVE_CHAIN_ID,
  SIMPLE_ACCOUNT_FACTORY_ABI,
  SIMPLE_ACCOUNT_ABI,
  ENTRY_POINT_ABI,
  RELAYER_URL,
} from "@/lib/constants";

/* -------------------------------------------------------------------------- */
/*                                  Types                                     */
/* -------------------------------------------------------------------------- */

export interface UserOp {
  sender: Address;
  nonce: string;
  initCode: `0x${string}`;
  callData: `0x${string}`;
  accountGasLimits: `0x${string}`;
  preVerificationGas: string;
  gasFees: `0x${string}`;
  paymasterAndData: `0x${string}`;
  signature: `0x${string}`;
}

export interface SponsorResult {
  userOpHash: string;
  txHash: string;
  status: string;
}

/* -------------------------------------------------------------------------- */
/*                               Hook                                         */
/* -------------------------------------------------------------------------- */

export function usePaymaster() {
  const publicClient = usePublicClient();
  const contracts = CONTRACTS[ACTIVE_CHAIN_ID];

  /** Get the counterfactual SimpleAccount address for an owner */
  const getAccountAddress = useCallback(
    async (owner: Address): Promise<Address> => {
      if (!publicClient) throw new Error("No public client");
      const addr = await publicClient.readContract({
        address: contracts.simpleAccountFactory,
        abi: SIMPLE_ACCOUNT_FACTORY_ABI,
        functionName: "getAddress",
        args: [owner, 0n],
      });
      return addr as Address;
    },
    [publicClient, contracts]
  );

  /** Check if a SimpleAccount is already deployed */
  const isAccountDeployed = useCallback(
    async (account: Address): Promise<boolean> => {
      if (!publicClient) return false;
      const code = await publicClient.getCode({ address: account });
      return !!code && code !== "0x";
    },
    [publicClient]
  );

  /**
   * Build the 352-byte paymasterData blob.
   * Layout: proof (256 bytes) + merkleRoot (32) + nullifierHash (32) + aspRoot (32)
   *
   * For MockVerifier, proof values don't matter — they're accepted regardless.
   */
  const buildPaymasterData = useCallback(
    (
      merkleRoot: `0x${string}`,
      nullifierHash: `0x${string}`,
      aspRoot: `0x${string}`
    ): `0x${string}` => {
      // Dummy proof (MockVerifier accepts anything)
      const dummyProof = encodeAbiParameters(
        parseAbiParameters("uint256[2], uint256[2][2], uint256[2]"),
        [
          [1n, 2n],
          [
            [3n, 4n],
            [5n, 6n],
          ],
          [7n, 8n],
        ]
      );

      // Concat: proof (256 bytes) + merkleRoot + nullifierHash + aspRoot
      const roots = encodePacked(
        ["bytes32", "bytes32", "bytes32"],
        [merkleRoot, nullifierHash, aspRoot]
      );

      return `${dummyProof}${roots.slice(2)}` as `0x${string}`;
    },
    []
  );

  /**
   * Build the full paymasterAndData field.
   * Layout: paymaster address (20) + verificationGasLimit (16) + postOpGasLimit (16) + paymasterData
   */
  const buildPaymasterAndData = useCallback(
    (
      merkleRoot: `0x${string}`,
      nullifierHash: `0x${string}`,
      aspRoot: `0x${string}`
    ): `0x${string}` => {
      const paymasterData = buildPaymasterData(merkleRoot, nullifierHash, aspRoot);

      // Pack: paymaster(20 bytes) + verificationGasLimit(16 bytes) + postOpGasLimit(16 bytes) + paymasterData
      const verificationGasLimit = 200_000n;
      const postOpGasLimit = 50_000n;

      const prefix = encodePacked(
        ["address", "uint128", "uint128"],
        [contracts.privacyPaymaster, verificationGasLimit, postOpGasLimit]
      );

      return `${prefix}${paymasterData.slice(2)}` as `0x${string}`;
    },
    [contracts, buildPaymasterData]
  );

  /** Build a complete UserOp struct */
  const buildUserOp = useCallback(
    async (
      sender: Address,
      target: Address,
      callDataInner: `0x${string}`,
      paymasterAndData: `0x${string}`,
      initCode?: `0x${string}`
    ): Promise<UserOp> => {
      if (!publicClient) throw new Error("No public client");

      // Get nonce from EntryPoint
      let nonce = 0n;
      try {
        nonce = (await publicClient.readContract({
          address: contracts.entryPoint,
          abi: ENTRY_POINT_ABI,
          functionName: "getNonce",
          args: [sender, 0n],
        })) as bigint;
      } catch {
        // Account doesn't exist yet, nonce = 0
      }

      // Encode the callData as SimpleAccount.execute(target, 0, innerCallData)
      const callData = encodeFunctionData({
        abi: SIMPLE_ACCOUNT_ABI,
        functionName: "execute",
        args: [target, 0n, callDataInner],
      });

      // Pack gas limits: verificationGasLimit (128 bits) || callGasLimit (128 bits)
      const accountGasLimits = encodePacked(
        ["uint128", "uint128"],
        [500_000n, 500_000n]
      );

      // Pack gas fees: maxPriorityFeePerGas (128 bits) || maxFeePerGas (128 bits)
      const gasFees = encodePacked(
        ["uint128", "uint128"],
        [1_000_000_000n, 1_000_000_000n]
      );

      return {
        sender,
        nonce: `0x${nonce.toString(16)}`,
        initCode: initCode || "0x",
        callData: callData as `0x${string}`,
        accountGasLimits: accountGasLimits as `0x${string}`,
        preVerificationGas: "100000",
        gasFees: gasFees as `0x${string}`,
        paymasterAndData,
        signature: "0x",
      };
    },
    [publicClient, contracts]
  );

  /** Build initCode for first-time account deployment */
  const buildInitCode = useCallback(
    (owner: Address): `0x${string}` => {
      const factoryCalldata = encodeFunctionData({
        abi: SIMPLE_ACCOUNT_FACTORY_ABI,
        functionName: "createAccount",
        args: [owner, 0n],
      });

      return `${contracts.simpleAccountFactory}${factoryCalldata.slice(2)}` as `0x${string}`;
    },
    [contracts]
  );

  /** Submit a UserOp to the devnet relayer's mini-bundler */
  const submitSponsoredTx = useCallback(
    async (userOp: UserOp): Promise<SponsorResult> => {
      const response = await fetch(`${RELAYER_URL}/api/sponsor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userOp),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Sponsor request failed");
      }

      return response.json();
    },
    []
  );

  /** Poll sponsor status */
  const getSponsorStatus = useCallback(
    async (
      userOpHash: string
    ): Promise<{ status: string; txHash?: string; error?: string }> => {
      const response = await fetch(
        `${RELAYER_URL}/api/sponsor/${userOpHash}/status`
      );
      if (!response.ok) {
        throw new Error("Status check failed");
      }
      return response.json();
    },
    []
  );

  /** Compute domain-separated nullifierHash for membership (domain = 2) */
  const computeMembershipNullifierHash = useCallback(
    (nullifier: `0x${string}`): `0x${string}` => {
      // Domain-separated: keccak256(abi.encodePacked(nullifier, uint256(2)))
      return keccak256(
        encodePacked(["bytes32", "uint256"], [nullifier as `0x${string}`, 2n])
      );
    },
    []
  );

  return {
    getAccountAddress,
    isAccountDeployed,
    buildPaymasterData,
    buildPaymasterAndData,
    buildUserOp,
    buildInitCode,
    submitSponsoredTx,
    getSponsorStatus,
    computeMembershipNullifierHash,
  };
}
